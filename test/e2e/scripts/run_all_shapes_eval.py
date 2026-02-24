#!/usr/bin/env python3
"""
Evaluate all shapes and SmartArt in testdata: SSIM and fg_iou per case.

Prerequisites:
  - pnpm dev:e2e running (Vite on 5173, Python API on 8080)
  - testdata/cases/ contains per-case dirs with source.pptx + ground-truth.pdf

Modes (can combine):
  1) Shape ID range: scan cases dir for oracle-full-shapeid-{id:04d}*.json, POST /api/evaluate/{stem} for each.
  2) SmartArt from cases dir: scan dir for oracle-full-smartart-*.json, POST /api/evaluate/{stem} for each.
  3) All testdata: POST /api/evaluate-all (default when neither --shape-id-min nor --smartart-cases-dir).

Usage:
  cd test/e2e
  # Shapes 1..500 + SmartArt from oracle/cases-full
  .venv/bin/python scripts/run_all_shapes_eval.py --shape-id-min 1 --shape-id-max 500 --smartart-cases-dir oracle/cases-full
  # Shapes only
  .venv/bin/python scripts/run_all_shapes_eval.py --shape-id-min 1 --shape-id-max 500
  # SmartArt only (all oracle-full-smartart-*.json in dir)
  .venv/bin/python scripts/run_all_shapes_eval.py --smartart-cases-dir oracle/cases-full
  # Everything in testdata (one evaluate-all call)
  .venv/bin/python scripts/run_all_shapes_eval.py

Output:
  - JSON report with results[].summary.ssim, results[].summary.fg_iou, etc.
  - CSV with case, ssim, fg_iou for quick sort.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx

E2E_DIR = Path(__file__).resolve().parents[1]
if str(E2E_DIR) not in sys.path:
    sys.path.insert(0, str(E2E_DIR))

REPORTS_DIR = E2E_DIR / "reports"
ORACLE_REPORTS_DIR = REPORTS_DIR / "oracle-failures"
DEFAULT_OUT_JSON = ORACLE_REPORTS_DIR / "all-shapes-eval.json"

DEFAULT_CONCURRENCY = 8


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _result_from_evaluate_response(name: str, data: dict) -> dict:
    avg_ssim = data.get("avgSsim") or 0.0
    avg_fg_iou = data.get("avgFgIou") or 0.0
    avg_fg_iou_tolerant = data.get("avgFgIouTolerant") or 0.0
    avg_chamfer = data.get("avgChamferScore") or 0.0
    color_hist_corr = data.get("avgColorHistCorr") or 0.0
    summary = {
        "text_coverage": 1.0,
        "shape_recall": 1.0,
        "ssim": float(avg_ssim),
        "color_hist_corr": float(color_hist_corr),
        "fg_iou": float(avg_fg_iou),
        "fg_iou_tolerant": float(avg_fg_iou_tolerant),
        "chamfer_score": float(avg_chamfer),
        "slide_count": data.get("slideCount", 1),
        "visible_slide_count": data.get("visibleSlideCount", 1),
    }
    quality = data.get("quality") or {}
    return {
        "case": name,
        "label": name,
        "passed": data.get("supported", True),
        "needs_review": quality.get("needsReview", False),
        "summary": summary,
        "reasons": quality.get("reasons") or [],
        "warnings": quality.get("warnings") or [],
    }


async def _eval_one(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    api_base: str,
    case: str,
) -> tuple[dict | None, dict | None]:
    """Evaluate a single case. Returns (result, error) — exactly one is non-None."""
    async with sem:
        try:
            r = await client.post(f"{api_base}/api/evaluate/{case}")
            if r.status_code == 404:
                return None, {"case": case, "error": "not found (no .pptx+.pdf in testdata)"}
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            return None, {"case": case, "error": str(e)}
        if "error" in data:
            return None, {"case": case, "error": data["error"]}
        return _result_from_evaluate_response(case, data), None


async def _eval_batch(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    api_base: str,
    cases: list[str],
    label: str,
) -> tuple[list[dict], list[dict]]:
    """Evaluate a batch of cases concurrently. Returns (results, errors)."""
    if not cases:
        return [], []
    print(f"{label}: evaluating {len(cases)} cases (concurrency={sem._value})...", file=sys.stderr)
    tasks = [_eval_one(client, sem, api_base, c) for c in cases]
    outcomes = await asyncio.gather(*tasks)
    results = []
    errors = []
    for result, error in outcomes:
        if result is not None:
            results.append(result)
        if error is not None:
            errors.append(error)
    print(f"  {label}: {len(results)} ok, {len(errors)} errors", file=sys.stderr)
    return results, errors


async def async_main(args: argparse.Namespace) -> int:
    api_base = args.api_base.rstrip("/")
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    concurrency = args.concurrency

    results: list[dict] = []
    errors: list[dict] = []
    used_shape_range = False
    used_smartart_dir: str | None = None

    sem = asyncio.Semaphore(concurrency)

    async with httpx.AsyncClient(timeout=120.0) as client:
        # Collect all case names to evaluate, then fire them all concurrently
        shape_cases_to_eval: list[str] = []
        smartart_cases_to_eval: list[str] = []
        extra_cases_to_eval: list[str] = []

        # --- Shapes ---
        if args.shape_id_min is not None:
            id_min = args.shape_id_min
            id_max = args.shape_id_max if args.shape_id_max is not None else 500
            if id_max < id_min:
                id_max = id_min
            used_shape_range = True

            # Build a lookup of shape ID → actual case name from cases dir
            shape_case_lookup: dict[int, str] = {}
            _scan_dir = Path(args.smartart_cases_dir or args.cases_dir or "oracle/cases-full")
            if not _scan_dir.is_absolute():
                _scan_dir = (E2E_DIR / _scan_dir).resolve()
            if _scan_dir.is_dir():
                for p in _scan_dir.glob("oracle-full-shapeid-*.json"):
                    m = re.match(r"oracle-full-shapeid-(\d{4})", p.stem)
                    if m:
                        shape_case_lookup[int(m.group(1))] = p.stem

            for shape_id in range(id_min, id_max + 1):
                case = shape_case_lookup.get(shape_id, f"oracle-full-shapeid-{shape_id:04d}")
                shape_cases_to_eval.append(case)

        # --- SmartArt ---
        if args.smartart_cases_dir:
            cases_dir = Path(args.smartart_cases_dir)
            if not cases_dir.is_absolute():
                cases_dir = (E2E_DIR / cases_dir).resolve()
            if not cases_dir.is_dir():
                print(f"SmartArt: not a directory: {cases_dir}", file=sys.stderr)
            else:
                smartart_jsons = sorted(cases_dir.glob("oracle-full-smartart-*.json"))
                used_smartart_dir = str(cases_dir)
                smartart_cases_to_eval = [p.stem for p in smartart_jsons]

        # --- Extra cases (charts, tables, connectors, fillstroke, etc.) ---
        if args.cases_dir:
            cases_dir = Path(args.cases_dir)
            if not cases_dir.is_absolute():
                cases_dir = (E2E_DIR / cases_dir).resolve()
            if not cases_dir.is_dir():
                print(f"Cases dir: not a directory: {cases_dir}", file=sys.stderr)
            else:
                already_seen = set(shape_cases_to_eval) | set(smartart_cases_to_eval)
                all_case_jsons = sorted(cases_dir.glob("oracle-full-*.json"))
                extra_cases_to_eval = [p.stem for p in all_case_jsons if p.stem not in already_seen]

        # --- Evaluate all concurrently ---
        all_cases = shape_cases_to_eval + smartart_cases_to_eval + extra_cases_to_eval
        if all_cases:
            print(f"Total: {len(all_cases)} cases to evaluate (shapes={len(shape_cases_to_eval)}, "
                  f"smartart={len(smartart_cases_to_eval)}, other={len(extra_cases_to_eval)}), "
                  f"concurrency={concurrency}", file=sys.stderr)
            batch_results, batch_errors = await _eval_batch(
                client, sem, api_base, all_cases, "All cases",
            )
            results.extend(batch_results)
            errors.extend(batch_errors)

        # --- Fallback: evaluate-all endpoint ---
        if not all_cases:
            try:
                r = await client.get(f"{api_base}/api/testdata-files")
                r.raise_for_status()
                test_files = r.json()
            except Exception as e:
                print(f"Failed to get test files from {api_base}: {e}", file=sys.stderr)
                print("Ensure pnpm dev:e2e is running (Vite + Python API).", file=sys.stderr)
                return 1

            if not test_files:
                print("No test files (no .pptx+.pdf pairs in testdata).", file=sys.stderr)
            else:
                print(f"Evaluating {len(test_files)} cases via POST /api/evaluate-all...", file=sys.stderr)
                try:
                    r = await client.post(f"{api_base}/api/evaluate-all")
                    r.raise_for_status()
                    body = r.json()
                except Exception as e:
                    print(f"evaluate-all failed: {e}", file=sys.stderr)
                    return 1
                files_result = body.get("files") or []
                for data in files_result:
                    if "error" in data:
                        errors.append({"case": data.get("testFile", "?"), "error": data["error"]})
                        continue
                    name = data.get("testFile", "?")
                    results.append(_result_from_evaluate_response(name, data))

    shape_results = [r for r in results if "shapeid" in r["case"].lower() or ("oracle-shape-" in r["case"] and "smartart" not in r["case"])]
    smartart_results = [r for r in results if "smartart" in r["case"].lower()]
    chart_results = [r for r in results if "chart" in r["case"].lower() and "smartart" not in r["case"].lower()]
    table_results = [r for r in results if "table" in r["case"].lower()]
    connector_results = [r for r in results if "connector" in r["case"].lower()]
    fillstroke_results = [r for r in results if "fillstroke" in r["case"].lower()]
    if not shape_results and not smartart_results and not chart_results and not table_results and not connector_results and not fillstroke_results:
        shape_results = results
        smartart_results = []

    report = {
        "generated_at": _utc_now_iso(),
        "api_base": api_base,
        "concurrency": concurrency,
        "total_cases": len(results),
        "shape_cases": len(shape_results),
        "smartart_cases": len(smartart_results),
        "chart_cases": len(chart_results),
        "table_cases": len(table_results),
        "connector_cases": len(connector_results),
        "fillstroke_cases": len(fillstroke_results),
        "errors": errors,
        "results": results,
    }
    if used_shape_range:
        report["shape_id_range"] = [args.shape_id_min, args.shape_id_max if args.shape_id_max is not None else 500]
    if used_smartart_dir:
        report["smartart_cases_dir"] = used_smartart_dir
    out_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(results)} results to {out_path}")

    if args.csv:
        csv_path = out_path.with_suffix(".csv")
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["case", "ssim", "color_hist_corr", "fg_iou_tolerant", "chamfer_score", "fg_iou", "passed", "needs_review"])
            for r in results:
                s = r["summary"]
                w.writerow([
                    r["case"],
                    round(s["ssim"], 4),
                    round(s.get("color_hist_corr", 0), 4),
                    round(s.get("fg_iou_tolerant", 0), 4),
                    round(s.get("chamfer_score", 0), 4),
                    round(s["fg_iou"], 4),
                    r["passed"],
                    r.get("needs_review", False),
                ])
        print(f"Wrote CSV to {csv_path}")

    if errors:
        print(f"Errors ({len(errors)}):", [e["case"] for e in errors], file=sys.stderr)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate all testdata cases: SSIM and fg_iou")
    parser.add_argument(
        "--api-base",
        default="http://localhost:8080",
        help="Base URL of Python E2E API server (default: http://localhost:8080)",
    )
    parser.add_argument(
        "--out",
        default=str(DEFAULT_OUT_JSON),
        help="Output JSON report path",
    )
    parser.add_argument(
        "--shape-id-min",
        type=int,
        default=None,
        metavar="N",
        help="If set, evaluate oracle-full-shapeid-{id} cases from this id (inclusive)",
    )
    parser.add_argument(
        "--shape-id-max",
        type=int,
        default=None,
        metavar="N",
        help="With --shape-id-min, iterate up to this id (inclusive). Default 500.",
    )
    parser.add_argument(
        "--smartart-cases-dir",
        type=str,
        default=None,
        metavar="DIR",
        help="If set, iterate oracle-full-smartart-*.json in DIR and call POST /api/evaluate/{stem} for each (404 skipped).",
    )
    parser.add_argument(
        "--cases-dir",
        type=str,
        default=None,
        metavar="DIR",
        help="Scan all oracle-full-*.json in DIR and POST /api/evaluate/{stem} for each. "
        "Subsumes --smartart-cases-dir and covers charts, tables, connectors, etc.",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=DEFAULT_CONCURRENCY,
        metavar="N",
        help=f"Max parallel requests (default: {DEFAULT_CONCURRENCY})",
    )
    parser.add_argument(
        "--csv",
        action="store_true",
        default=True,
        help="Also write a CSV with case, ssim, fg_iou (default: True)",
    )
    parser.add_argument(
        "--no-csv",
        action="store_false",
        dest="csv",
        help="Do not write CSV",
    )
    args = parser.parse_args()
    return asyncio.run(async_main(args))


if __name__ == "__main__":
    sys.exit(main())
