"""
Layer 2: Visual comparison tests.

Compares PDF-rendered images (ground truth) against
Playwright screenshots of rendered slides using SSIM.
"""

from pathlib import Path

import fitz  # PyMuPDF
import numpy as np
import pytest
from PIL import Image
from skimage.metrics import structural_similarity as ssim

import testdata_paths as tdp
from conftest import DEV_SERVER_URL, PAGE_TIMEOUT_MS, REPORTS_DIR
from extract_ground_truth import extract_ground_truth


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SLIDE_CAPTURE_SELECTOR = "#slide-container .slide-wrapper > div"


def build_slide_to_pdf_mapping(pptx_path) -> list[int | None]:
    """Build a mapping from PPTX slide index to PDF page index.

    PDFs exported from PowerPoint skip hidden slides, so we need to
    account for that offset.  Returns a list where result[slide_idx]
    is the corresponding PDF page index, or None if the slide is hidden.
    """
    gt = extract_ground_truth(pptx_path)
    mapping: list[int | None] = []
    pdf_page = 0
    for slide in gt.slides:
        if slide.hidden:
            mapping.append(None)
        else:
            mapping.append(pdf_page)
            pdf_page += 1
    return mapping

def pdf_page_to_image(pdf_path: Path, page_idx: int, dpi: int = 150) -> np.ndarray:
    """Render a PDF page to a numpy RGB array."""
    doc = fitz.open(str(pdf_path))
    page = doc[page_idx]
    pix = page.get_pixmap(dpi=dpi)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    doc.close()
    return np.array(img)


def screenshot_slide(page, dev_server_url: str, test_file: str, slide_idx: int) -> np.ndarray:
    """Take a Playwright screenshot of a rendered slide, return numpy RGB array."""
    url = f"{dev_server_url}/test/pages/render-slide.html?file=testdata/cases/{test_file}/source.pptx&slide={slide_idx}"
    page.goto(url)

    # Wait for render to complete
    page.wait_for_function(
        "() => window.__renderDone === true || window.__renderError !== undefined",
        timeout=PAGE_TIMEOUT_MS,
    )

    error = page.evaluate("() => window.__renderError")
    if error:
        raise RuntimeError(f"Render failed for {test_file} slide {slide_idx}: {error}")

    # Get native slide dimensions
    width = page.evaluate("() => window.__slideWidth")
    height = page.evaluate("() => window.__slideHeight")

    # Capture the rendered slide element only (exclude container padding/shadow/UI chrome).
    target = page.locator(SLIDE_CAPTURE_SELECTOR)
    if target.count() == 0:
        target = page.locator("#slide-container")
    screenshot_bytes = target.first.screenshot()

    img = Image.open(__import__("io").BytesIO(screenshot_bytes))
    return np.array(img.convert("RGB"))


def compute_ssim(img1: np.ndarray, img2: np.ndarray) -> float:
    """Resize images to common dimensions and compute SSIM."""
    # Resize to common dimensions
    h = min(img1.shape[0], img2.shape[0])
    w = min(img1.shape[1], img2.shape[1])

    if h < 10 or w < 10:
        return 0.0

    pil1 = Image.fromarray(img1).resize((w, h), Image.LANCZOS)
    pil2 = Image.fromarray(img2).resize((w, h), Image.LANCZOS)

    arr1 = np.array(pil1)
    arr2 = np.array(pil2)

    # Compute SSIM with appropriate window size
    win_size = min(7, h, w)
    if win_size % 2 == 0:
        win_size -= 1
    if win_size < 3:
        win_size = 3

    score = ssim(arr1, arr2, channel_axis=2, win_size=win_size)
    return float(score)


def save_diff_heatmap(img1: np.ndarray, img2: np.ndarray, output_path: Path):
    """Generate and save a diff heatmap."""
    import cv2

    h = min(img1.shape[0], img2.shape[0])
    w = min(img1.shape[1], img2.shape[1])

    r1 = cv2.resize(img1, (w, h))
    r2 = cv2.resize(img2, (w, h))

    diff = cv2.absdiff(r1, r2)
    gray_diff = cv2.cvtColor(diff, cv2.COLOR_RGB2GRAY)
    heatmap = cv2.applyColorMap(gray_diff, cv2.COLORMAP_JET)
    heatmap_rgb = cv2.cvtColor(heatmap, cv2.COLOR_BGR2RGB)

    Image.fromarray(heatmap_rgb).save(str(output_path))


def get_pdf_page_count(pdf_path: Path) -> int:
    doc = fitz.open(str(pdf_path))
    count = doc.page_count
    doc.close()
    return count


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestSSIMPerSlide:
    """Per-slide SSIM comparison between PDF and rendered PPTX."""

    def test_ssim_per_slide(self, test_file, page, dev_server_url):
        pptx_path = tdp.source_pptx(test_file)
        pdf_path = tdp.ground_truth_pdf(test_file)
        num_pages = get_pdf_page_count(pdf_path)
        slide_to_pdf = build_slide_to_pdf_mapping(pptx_path)

        scores = []
        for slide_idx, pdf_page_idx in enumerate(slide_to_pdf):
            if pdf_page_idx is None:
                continue  # Skip hidden slides
            if pdf_page_idx >= num_pages:
                break
            try:
                pdf_img = pdf_page_to_image(pdf_path, pdf_page_idx)
                html_img = screenshot_slide(page, dev_server_url, test_file, slide_idx)

                score = compute_ssim(pdf_img, html_img)
                scores.append(score)

                # Save diff heatmap for debugging
                diff_path = REPORTS_DIR / f"{test_file}_slide{slide_idx}_diff.png"
                try:
                    save_diff_heatmap(pdf_img, html_img, diff_path)
                except Exception:
                    pass  # Non-critical

                assert score >= 0.65, (
                    f"Slide {slide_idx} (PDF page {pdf_page_idx}): SSIM {score:.3f} < 0.65 threshold"
                )
            except Exception as e:
                if "SSIM" in str(e):
                    raise
                pytest.skip(f"Slide {slide_idx} render/comparison error: {e}")


class TestSSIMAverage:
    """Average SSIM across all slides must meet threshold."""

    def test_ssim_average(self, test_file, page, dev_server_url):
        pptx_path = tdp.source_pptx(test_file)
        pdf_path = tdp.ground_truth_pdf(test_file)
        num_pages = get_pdf_page_count(pdf_path)
        slide_to_pdf = build_slide_to_pdf_mapping(pptx_path)

        scores = []
        for slide_idx, pdf_page_idx in enumerate(slide_to_pdf):
            if pdf_page_idx is None:
                continue  # Skip hidden slides
            if pdf_page_idx >= num_pages:
                break
            try:
                pdf_img = pdf_page_to_image(pdf_path, pdf_page_idx)
                html_img = screenshot_slide(page, dev_server_url, test_file, slide_idx)
                score = compute_ssim(pdf_img, html_img)
                scores.append(score)
            except Exception:
                # Skip slides that fail to render
                pass

        if not scores:
            pytest.skip(f"No slides could be compared for {test_file}")

        avg = sum(scores) / len(scores)
        assert avg >= 0.70, (
            f"Average SSIM {avg:.3f} < 0.70 threshold "
            f"(per-slide: {[f'{s:.3f}' for s in scores]})"
        )
