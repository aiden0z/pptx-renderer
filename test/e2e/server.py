"""
FastAPI dev server for PPTX renderer E2E evaluation.

Serves static files, proxies to Vite for HMR, and provides
evaluation APIs that use Playwright + scikit-image for server-side
visual comparison (avoiding browser canvas taint issues).

Usage:
    cd e2e && python server.py
    # Requires Vite running on port 5173: npx vite (from project root)
"""

import asyncio
import io
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import cv2
import fitz  # PyMuPDF
import httpx
import numpy as np
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from PIL import Image
from playwright.async_api import async_playwright
from pydantic import BaseModel, Field
from skimage.metrics import structural_similarity as ssim

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

E2E_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = E2E_DIR.parent.parent
TESTDATA_DIR = E2E_DIR / "testdata"
REPORTS_DIR = E2E_DIR / "reports"
REPORTS_DIR.mkdir(parents=True, exist_ok=True)
ORACLE_REPORTS_DIR = REPORTS_DIR / "oracle-failures"
ORACLE_REPORTS_DIR.mkdir(parents=True, exist_ok=True)
MANUAL_REVIEW_PATH = ORACLE_REPORTS_DIR / "manual-review.json"
SUPPORT_CATALOG_PATH = ORACLE_REPORTS_DIR / "support-catalog.json"
ORACLE_CASES_DIR = E2E_DIR / "oracle" / "cases-full"

# Add e2e dir to path so we can import local modules
sys.path.insert(0, str(E2E_DIR))

import testdata_paths as tdp  # noqa: E402
from extract_ground_truth import extract_ground_truth  # noqa: E402
from oracle.metrics import (  # noqa: E402
    compute_foreground_shape_metrics,
    compute_visual_metrics,
)
from oracle.support_catalog import (  # noqa: E402
    load_or_init_support_catalog,
    merge_case_results_into_catalog,
    save_support_catalog,
)
from oracle.triage import classify_case_outcome  # noqa: E402
from test_visual import build_slide_to_pdf_mapping  # noqa: E402

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

PYTHON_SERVER_PORT = 8080
VITE_SERVER_URL = "http://localhost:5173"
VISUAL_EVAL_THRESHOLDS = {
    "ssim": 0.95,
    "color_hist_corr": 0.80,
}
# Warning threshold: shapes below this SSIM are flagged for human review
# but do NOT auto-fail.  Catches subtle dark-on-dark internal detail bugs
# (e.g. action button shrunken icons) that pixel metrics cannot reliably
# distinguish from correct-but-complex renders (3D gradients, etc.).
SSIM_WARNING_THRESHOLD = 0.99

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="PPTX Renderer Dev Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Singleton Playwright browser (lazy init)
# ---------------------------------------------------------------------------

_browser = None
_playwright = None


async def get_browser():
    global _browser, _playwright
    if _browser is None:
        _playwright = await async_playwright().start()
        _browser = await _playwright.chromium.launch(headless=True)
    return _browser


async def close_browser():
    global _browser, _playwright
    if _browser:
        await _browser.close()
        _browser = None
    if _playwright:
        await _playwright.stop()
        _playwright = None


# ---------------------------------------------------------------------------
# Evaluation cache
# ---------------------------------------------------------------------------

_eval_cache: dict[str, dict] = {}
MANUAL_REVIEW_ALLOWED_VERDICTS = {"supported", "unsupported", "unsure"}


class ManualReviewPayload(BaseModel):
    test_file: str = Field(min_length=1)
    slide_idx: int = Field(ge=0)
    verdict: str = Field(min_length=1)
    note: str = ""


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _load_manual_review_store() -> dict:
    if MANUAL_REVIEW_PATH.exists():
        try:
            data = json.loads(MANUAL_REVIEW_PATH.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                data.setdefault("entries", {})
                return data
        except json.JSONDecodeError:
            pass
    return {"version": 1, "entries": {}}


def _save_manual_review_store(store: dict) -> Path:
    MANUAL_REVIEW_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = dict(store)
    payload["updated_at"] = _utc_now_iso()
    MANUAL_REVIEW_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return MANUAL_REVIEW_PATH


def _manual_entries_for_test_file(store: dict, test_file: str) -> list[dict]:
    rows = []
    for entry in (store.get("entries", {}) or {}).values():
        if not isinstance(entry, dict):
            continue
        if entry.get("test_file") != test_file:
            continue
        rows.append(entry)
    rows.sort(key=lambda row: int(row.get("slide_idx", 0)))
    return rows


def _sync_support_catalog_from_manual_feedback(test_file: str, verdict: str, note: str) -> str | None:
    if verdict not in {"supported", "unsupported"}:
        return None
    if not (ORACLE_CASES_DIR / f"{test_file}.json").exists():
        return None

    catalog = load_or_init_support_catalog(SUPPORT_CATALOG_PATH, ORACLE_CASES_DIR)
    merge_case_results_into_catalog(
        catalog,
        [
            {
                "case": test_file,
                "passed": verdict == "supported",
                "reasons": [f"manual:{verdict}" + (f":{note}" if note else "")],
            }
        ],
    )
    save_support_catalog(SUPPORT_CATALOG_PATH, catalog)
    return "supported" if verdict == "supported" else "unsupported"

# ---------------------------------------------------------------------------
# Reusable helpers (async wrappers around test_visual functions)
# ---------------------------------------------------------------------------

PAGE_TIMEOUT_MS = 120_000
SLIDE_CAPTURE_SELECTOR = "#slide-container .slide-wrapper > div"


def pdf_page_to_image(pdf_path: Path, page_idx: int, dpi: int = 150) -> np.ndarray:
    doc = fitz.open(str(pdf_path))
    page = doc[page_idx]
    pix = page.get_pixmap(dpi=dpi)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    doc.close()
    return np.array(img)


def png_slide_to_image(png_path: Path) -> np.ndarray:
    """Load a PNG ground-truth image exported directly by PowerPoint via Slide.Export."""
    img = Image.open(png_path).convert("RGB")
    return np.array(img)


async def screenshot_slide(browser, test_file: str, slide_idx: int) -> np.ndarray:
    ctx = await browser.new_context(viewport={"width": 1920, "height": 1080})
    page = await ctx.new_page()
    page.set_default_timeout(PAGE_TIMEOUT_MS)
    try:
        url = f"{VITE_SERVER_URL}/test/pages/render-slide.html?file=testdata/cases/{test_file}/source.pptx&slide={slide_idx}"
        await page.goto(url)
        await page.wait_for_function(
            "() => window.__renderDone === true || window.__renderError !== undefined",
            timeout=PAGE_TIMEOUT_MS,
        )
        error = await page.evaluate("() => window.__renderError")
        if error:
            raise RuntimeError(f"Render failed for {test_file} slide {slide_idx}: {error}")
        # Capture rendered slide only; avoid container padding/shadows that pollute SSIM.
        target = page.locator(SLIDE_CAPTURE_SELECTOR)
        if await target.count() == 0:
            target = page.locator("#slide-container")
        screenshot_bytes = await target.first.screenshot()
        img = Image.open(io.BytesIO(screenshot_bytes))
        return np.array(img.convert("RGB"))
    finally:
        await page.close()
        await ctx.close()


def compute_ssim(img1: np.ndarray, img2: np.ndarray) -> float:
    h = min(img1.shape[0], img2.shape[0])
    w = min(img1.shape[1], img2.shape[1])
    if h < 10 or w < 10:
        return 0.0
    pil1 = Image.fromarray(img1).resize((w, h), Image.LANCZOS)
    pil2 = Image.fromarray(img2).resize((w, h), Image.LANCZOS)
    arr1 = np.array(pil1)
    arr2 = np.array(pil2)
    win_size = min(7, h, w)
    if win_size % 2 == 0:
        win_size -= 1
    if win_size < 3:
        win_size = 3
    score = ssim(arr1, arr2, channel_axis=2, win_size=win_size)
    return float(score)


def make_diff_heatmap(img1: np.ndarray, img2: np.ndarray) -> np.ndarray:
    h = min(img1.shape[0], img2.shape[0])
    w = min(img1.shape[1], img2.shape[1])
    r1 = cv2.resize(img1, (w, h))
    r2 = cv2.resize(img2, (w, h))
    diff = cv2.absdiff(r1, r2)
    gray_diff = cv2.cvtColor(diff, cv2.COLOR_RGB2GRAY)
    heatmap = cv2.applyColorMap(gray_diff, cv2.COLORMAP_JET)
    return cv2.cvtColor(heatmap, cv2.COLOR_BGR2RGB)


def numpy_to_png(arr: np.ndarray) -> bytes:
    img = Image.fromarray(arr)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _save_image(arr: np.ndarray, path: Path):
    Image.fromarray(arr).save(str(path))


def get_test_files() -> list[str]:
    return [s for s in tdp.list_cases() if tdp.ground_truth_pdf(s).exists()]


def get_pdf_page_count(pdf_path: Path) -> int:
    doc = fitz.open(str(pdf_path))
    count = doc.page_count
    doc.close()
    return count


# ---------------------------------------------------------------------------
# Vite Proxy — reverse proxy strategy:
#   /api/*      → handled by FastAPI routes
#   /testdata/* → served directly (large binaries)
#   everything else → proxy to Vite (HTML transform, HMR, TS, bare imports)
# ---------------------------------------------------------------------------

_http_client: httpx.AsyncClient | None = None


async def get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None:
        # trust_env=False: skip system/env proxy (e.g. Stash on macOS)
        _http_client = httpx.AsyncClient(timeout=60.0, trust_env=False)
    return _http_client


# Paths that Python server handles directly (not proxied)
PYTHON_HANDLED_PREFIXES = ("/api/", "/testdata/")


@app.middleware("http")
async def vite_proxy_middleware(request, call_next):
    path = request.url.path
    # Let FastAPI handle API and testdata routes
    if any(path.startswith(prefix) for prefix in PYTHON_HANDLED_PREFIXES):
        return await call_next(request)

    # Everything else → proxy to Vite
    client = await get_http_client()
    target_url = f"{VITE_SERVER_URL}{path}"
    if request.url.query:
        target_url += f"?{request.url.query}"
    try:
        resp = await client.get(target_url)
        # Filter out hop-by-hop headers
        headers = {
            k: v for k, v in resp.headers.items()
            if k.lower() not in ("transfer-encoding", "connection")
        }
        return Response(
            content=resp.content,
            status_code=resp.status_code,
            headers=headers,
        )
    except httpx.ConnectError:
        return JSONResponse(
            {"error": "Vite server not running. Start it with: npx vite"},
            status_code=502,
        )


# ---------------------------------------------------------------------------
# API: Evaluation
# ---------------------------------------------------------------------------

@app.post("/api/evaluate/{test_file}")
async def evaluate_file(test_file: str):
    pptx_path = tdp.source_pptx(test_file)
    pdf_path = tdp.ground_truth_pdf(test_file)

    if not pptx_path.exists():
        raise HTTPException(404, f"PPTX not found: {test_file}")

    # Check for PNG ground truth (preferred over PDF)
    has_png = tdp.has_png_ground_truth(test_file)

    if not has_png and not pdf_path.exists():
        raise HTTPException(404, f"Ground truth not found for {test_file}: need ground-truth.pdf or slides/slide1.png")

    browser = await get_browser()
    slide_to_pdf = await asyncio.to_thread(build_slide_to_pdf_mapping, pptx_path)
    num_pages = (
        await asyncio.to_thread(get_pdf_page_count, pdf_path)
        if pdf_path.exists()
        else len(slide_to_pdf)
    )

    per_slide = []
    ssim_scores = []
    mae_scores = []
    fg_iou_scores = []
    fg_iou_tolerant_scores = []
    chamfer_scores = []
    color_hist_corr_scores = []

    for slide_idx, pdf_page_idx in enumerate(slide_to_pdf):
        if pdf_page_idx is None:
            per_slide.append({
                "slideIdx": slide_idx,
                "pdfPage": None,
                "ssim": None,
                "hidden": True,
            })
            continue
        if pdf_page_idx >= num_pages:
            break

        try:
            # Prefer PNG ground truth (direct PowerPoint export, no PDF intermediate)
            png_gt_path = tdp.slide_png(test_file, slide_idx + 1)
            if png_gt_path.exists():
                gt_img = await asyncio.to_thread(png_slide_to_image, png_gt_path)
            else:
                gt_img = await asyncio.to_thread(pdf_page_to_image, pdf_path, pdf_page_idx)
            html_img = await screenshot_slide(browser, test_file, slide_idx)
            visual = compute_visual_metrics(gt_img, html_img)
            fg = compute_foreground_shape_metrics(gt_img, html_img)

            score = float(visual["ssim"])
            mae = float(visual["mae"])
            color_hist_corr = float(visual["color_hist_corr"])
            fg_iou = float(fg["fg_iou"])
            fg_iou_tolerant = float(fg["fg_iou_tolerant"])
            chamfer = float(fg["chamfer_score"])

            ssim_scores.append(score)
            mae_scores.append(mae)
            color_hist_corr_scores.append(color_hist_corr)
            fg_iou_scores.append(fg_iou)
            fg_iou_tolerant_scores.append(fg_iou_tolerant)
            chamfer_scores.append(chamfer)

            # Save diff heatmap
            diff_img = make_diff_heatmap(gt_img, html_img)
            diff_path = REPORTS_DIR / f"{test_file}_slide{slide_idx}_diff.png"
            _save_image(diff_img, diff_path)

            # Save screenshots for serving via API
            html_path = REPORTS_DIR / f"{test_file}_slide{slide_idx}_html.png"
            pdf_img_path = REPORTS_DIR / f"{test_file}_slide{slide_idx}_pdf.png"
            _save_image(html_img, html_path)
            _save_image(gt_img, pdf_img_path)

            per_slide.append({
                "slideIdx": slide_idx,
                "pdfPage": pdf_page_idx,
                "ssim": round(score, 4),
                "mae": round(mae, 4),
                "colorHistCorr": round(color_hist_corr, 4),
                "fgIou": round(fg_iou, 4),
                "fgIouTolerant": round(fg_iou_tolerant, 4),
                "chamferScore": round(chamfer, 4),
                "needsReview": score < SSIM_WARNING_THRESHOLD,
                "hidden": False,
            })
        except Exception as e:
            per_slide.append({
                "slideIdx": slide_idx,
                "pdfPage": pdf_page_idx,
                "ssim": None,
                "mae": None,
                "colorHistCorr": None,
                "fgIou": None,
                "needsReview": None,
                "hidden": False,
                "error": str(e),
            })

    avg_ssim = sum(ssim_scores) / len(ssim_scores) if ssim_scores else 0.0
    avg_mae = sum(mae_scores) / len(mae_scores) if mae_scores else 0.0
    avg_color_hist_corr = sum(color_hist_corr_scores) / len(color_hist_corr_scores) if color_hist_corr_scores else 0.0
    avg_fg_iou = sum(fg_iou_scores) / len(fg_iou_scores) if fg_iou_scores else 0.0
    avg_fg_iou_tolerant = sum(fg_iou_tolerant_scores) / len(fg_iou_tolerant_scores) if fg_iou_tolerant_scores else 0.0
    avg_chamfer = sum(chamfer_scores) / len(chamfer_scores) if chamfer_scores else 0.0

    summary = {
        "ssim": avg_ssim,
        "color_hist_corr": avg_color_hist_corr,
        "fg_iou": avg_fg_iou,
    }
    triage_reasons = classify_case_outcome(
        summary,
        {"ssim": VISUAL_EVAL_THRESHOLDS["ssim"]},
    )
    # --- Pass/fail: only SSIM + color_hist_corr (conservative, zero false positives) ---
    metric_reasons = []
    if avg_ssim < VISUAL_EVAL_THRESHOLDS["ssim"]:
        metric_reasons.append("metric:ssim")
    if avg_color_hist_corr < VISUAL_EVAL_THRESHOLDS["color_hist_corr"]:
        metric_reasons.append("metric:color_hist_corr")

    hard_reasons: list[str] = []
    for reason in [*metric_reasons, *triage_reasons]:
        if reason.startswith("warn:"):
            continue
        if reason not in hard_reasons:
            hard_reasons.append(reason)

    # --- Warning layer: flag for human review (does NOT auto-fail) ---
    warning_reasons = [reason for reason in triage_reasons if reason.startswith("warn:")]
    needs_review = avg_ssim < SSIM_WARNING_THRESHOLD
    if needs_review:
        warning_reasons.append("warn:ssim_below_review_threshold")

    passed = len(hard_reasons) == 0

    result = {
        "testFile": test_file,
        "slideCount": len(slide_to_pdf),
        "visibleSlideCount": sum(1 for s in slide_to_pdf if s is not None),
        "avgSsim": round(avg_ssim, 4),
        "avgMae": round(avg_mae, 4),
        "avgColorHistCorr": round(avg_color_hist_corr, 4),
        "avgFgIou": round(avg_fg_iou, 4),
        "avgFgIouTolerant": round(avg_fg_iou_tolerant, 4),
        "avgChamferScore": round(avg_chamfer, 4),
        "supported": passed,
        "quality": {
            "status": "supported" if passed else "unsupported",
            "passed": passed,
            "thresholds": VISUAL_EVAL_THRESHOLDS,
            "reasons": hard_reasons,
            "warnings": warning_reasons,
            "needsReview": needs_review,
        },
        "perSlide": per_slide,
    }
    _eval_cache[test_file] = result
    return result


@app.post("/api/evaluate-all")
async def evaluate_all():
    test_files = get_test_files()
    results = []
    for name in test_files:
        try:
            result = await evaluate_file(name)
            results.append(result)
        except Exception as e:
            results.append({"testFile": name, "error": str(e)})
    return {"files": results}


# ---------------------------------------------------------------------------
# API: Screenshots and Diff Images
# ---------------------------------------------------------------------------

@app.get("/api/screenshot/html/{test_file}/{slide_idx}")
async def screenshot_html(test_file: str, slide_idx: int):
    path = REPORTS_DIR / f"{test_file}_slide{slide_idx}_html.png"
    if not path.exists():
        # Try generating on the fly
        browser = await get_browser()
        try:
            html_img = await screenshot_slide(browser, test_file, slide_idx)
            _save_image(html_img, path)
        except Exception as e:
            raise HTTPException(404, f"Screenshot failed: {e}")
    return FileResponse(path, media_type="image/png")


@app.get("/api/screenshot/pdf/{test_file}/{slide_idx}")
async def screenshot_pdf(test_file: str, slide_idx: int):
    path = REPORTS_DIR / f"{test_file}_slide{slide_idx}_pdf.png"
    if not path.exists():
        # Generate on the fly — prefer PNG ground truth over PDF rasterization
        png_gt_path = tdp.slide_png(test_file, slide_idx + 1)
        if png_gt_path.exists():
            gt_img = await asyncio.to_thread(png_slide_to_image, png_gt_path)
        else:
            pptx_path = tdp.source_pptx(test_file)
            pdf_path = tdp.ground_truth_pdf(test_file)
            if not pdf_path.exists():
                raise HTTPException(404, f"Ground truth not found: {test_file}")
            slide_to_pdf = await asyncio.to_thread(build_slide_to_pdf_mapping, pptx_path)
            if slide_idx >= len(slide_to_pdf) or slide_to_pdf[slide_idx] is None:
                raise HTTPException(404, f"Slide {slide_idx} is hidden or out of range")
            pdf_page_idx = slide_to_pdf[slide_idx]
            gt_img = await asyncio.to_thread(pdf_page_to_image, pdf_path, pdf_page_idx)
        _save_image(gt_img, path)
    return FileResponse(path, media_type="image/png")


@app.get("/api/diff/{test_file}/{slide_idx}")
async def diff_image(test_file: str, slide_idx: int):
    path = REPORTS_DIR / f"{test_file}_slide{slide_idx}_diff.png"
    if not path.exists():
        raise HTTPException(404, "Run evaluation first to generate diff images")
    return FileResponse(path, media_type="image/png")


# ---------------------------------------------------------------------------
# API: Baselines
# ---------------------------------------------------------------------------

@app.get("/api/baselines")
async def get_baselines():
    import json
    baselines_dir = E2E_DIR / "baselines"
    result = {}
    if baselines_dir.exists():
        for f in baselines_dir.glob("*.json"):
            result[f.stem] = json.loads(f.read_text())
    return result


@app.post("/api/baselines/update")
async def update_baselines():
    import json
    baselines_dir = E2E_DIR / "baselines"
    baselines_dir.mkdir(parents=True, exist_ok=True)

    updated = []
    for test_file, result in _eval_cache.items():
        if "error" in result:
            continue
        baseline = {
            "slide_count": result["slideCount"],
            "ssim_scores": [s["ssim"] for s in result["perSlide"] if s["ssim"] is not None],
        }
        path = baselines_dir / f"{test_file}.json"
        path.write_text(json.dumps(baseline, indent=2))
        updated.append(test_file)

    return {"updated": updated}


# ---------------------------------------------------------------------------
# API: Test file listing
# ---------------------------------------------------------------------------

@app.get("/api/test-files")
async def list_test_files():
    return {"files": get_test_files()}


@app.get("/api/testdata-files")
async def list_testdata_files():
    # Vite dev page expects a plain array response for the select options.
    return get_test_files()


# ---------------------------------------------------------------------------
# API: Manual review feedback
# ---------------------------------------------------------------------------

@app.get("/api/manual-review")
async def list_manual_review(test_file: str | None = None):
    store = _load_manual_review_store()
    if test_file:
        return {"test_file": test_file, "entries": _manual_entries_for_test_file(store, test_file)}
    return {"entries": list((store.get("entries", {}) or {}).values())}


@app.get("/api/manual-review/{test_file}")
async def list_manual_review_for_file(test_file: str):
    store = _load_manual_review_store()
    return {"test_file": test_file, "entries": _manual_entries_for_test_file(store, test_file)}


@app.post("/api/manual-review")
async def upsert_manual_review(payload: ManualReviewPayload):
    try:
        verdict = payload.verdict.strip().lower()
        if verdict not in MANUAL_REVIEW_ALLOWED_VERDICTS:
            raise HTTPException(400, f"invalid verdict: {payload.verdict}")

        test_file = payload.test_file.strip()
        key = f"{test_file}#{payload.slide_idx}"
        note = payload.note.strip()

        store = _load_manual_review_store()
        entries = store.setdefault("entries", {})
        entry = {
            "key": key,
            "test_file": test_file,
            "slide_idx": int(payload.slide_idx),
            "verdict": verdict,
            "note": note,
            "updated_at": _utc_now_iso(),
        }
        entries[key] = entry
        _save_manual_review_store(store)

        case_status = _sync_support_catalog_from_manual_feedback(test_file, verdict, note)
        return {"ok": True, "entry": entry, "case_status": case_status}
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"manual review save failed: {exc}") from exc


# ---------------------------------------------------------------------------
# Static file serving
# ---------------------------------------------------------------------------

# Serve testdata files
@app.get("/testdata/{file_path:path}")
async def serve_testdata(file_path: str):
    full_path = TESTDATA_DIR / file_path
    if not full_path.exists():
        raise HTTPException(404, f"Not found: {file_path}")
    return FileResponse(full_path)


# Note: all non-API, non-testdata requests are proxied to Vite by the middleware.
# No catch-all static route needed — Vite serves HTML, JS, CSS, assets, etc.


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------

@app.on_event("shutdown")
async def shutdown():
    await close_browser()
    global _http_client
    if _http_client:
        await _http_client.aclose()
        _http_client = None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print(f"Starting PPTX Renderer Dev Server on http://localhost:{PYTHON_SERVER_PORT}")
    print(f"Vite proxy target: {VITE_SERVER_URL}")
    print(f"Project root: {PROJECT_ROOT}")
    print(f"Test data: {TESTDATA_DIR}")
    print()
    print("Make sure Vite is running: npx vite (from project root)")
    print()
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=PYTHON_SERVER_PORT,
        reload=True,
        reload_dirs=[str(E2E_DIR)],
    )
