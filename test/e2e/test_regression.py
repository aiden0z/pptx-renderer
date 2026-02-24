"""
Layer 3: Regression detection.

Compares current scores against stored baselines.
Run with --update-baselines to save new baselines.
"""

import json
from pathlib import Path

import fitz
import numpy as np
import pytest
from PIL import Image

import testdata_paths as tdp
from conftest import BASELINES_DIR, REPORTS_DIR
from extract_ground_truth import extract_ground_truth
from test_structural import _collect_all_nodes, _extract_words, renderer_to_structure
from test_visual import (
    build_slide_to_pdf_mapping,
    compute_ssim,
    get_pdf_page_count,
    pdf_page_to_image,
    screenshot_slide,
)


# ---------------------------------------------------------------------------
# Baseline I/O
# ---------------------------------------------------------------------------

def load_baseline(test_file: str) -> dict | None:
    path = BASELINES_DIR / f"{test_file}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text())


def save_baseline(test_file: str, data: dict):
    path = BASELINES_DIR / f"{test_file}.json"
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False))


# ---------------------------------------------------------------------------
# Score Collection
# ---------------------------------------------------------------------------

def collect_scores(
    test_file: str,
    export_presentation,
    page,
    dev_server_url: str,
) -> dict:
    """Collect all metrics for a test file."""
    pptx_path = tdp.source_pptx(test_file)
    pdf_path = tdp.ground_truth_pdf(test_file)

    # Structural
    ground_truth = extract_ground_truth(pptx_path)
    renderer_data = export_presentation(test_file)
    renderer = renderer_to_structure(renderer_data)

    slide_count = ground_truth.slide_count
    text_coverages = []
    shape_counts_gt = []
    shape_counts_rn = []

    for i in range(slide_count):
        gt_words = _extract_words(ground_truth, i)
        rn_words = _extract_words(renderer, i)
        if gt_words:
            matched = len(gt_words & rn_words)
            text_coverages.append(matched / len(gt_words))
        else:
            text_coverages.append(1.0)

        gt_count = len(ground_truth.slides[i].nodes) if i < len(ground_truth.slides) else 0
        rn_count = len(renderer.slides[i].nodes) if i < len(renderer.slides) else 0
        shape_counts_gt.append(gt_count)
        shape_counts_rn.append(rn_count)

    # Visual (with hidden slide mapping)
    num_pages = get_pdf_page_count(pdf_path)
    slide_to_pdf = build_slide_to_pdf_mapping(pptx_path)
    ssim_scores = []
    for i in range(slide_count):
        pdf_page_idx = slide_to_pdf[i] if i < len(slide_to_pdf) else None
        if pdf_page_idx is None or pdf_page_idx >= num_pages:
            ssim_scores.append(None)
            continue
        try:
            pdf_img = pdf_page_to_image(pdf_path, pdf_page_idx)
            html_img = screenshot_slide(page, dev_server_url, test_file, i)
            score = compute_ssim(pdf_img, html_img)
            ssim_scores.append(score)
        except Exception:
            ssim_scores.append(None)

    return {
        "slide_count": slide_count,
        "text_coverages": text_coverages,
        "shape_counts_gt": shape_counts_gt,
        "shape_counts_rn": shape_counts_rn,
        "ssim_scores": ssim_scores,
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestRegression:
    def test_no_regression(self, test_file, export_presentation, page, dev_server_url, request):
        update = request.config.getoption("--update-baselines")
        scores = collect_scores(test_file, export_presentation, page, dev_server_url)

        if update:
            save_baseline(test_file, scores)
            pytest.skip(f"Baseline updated for {test_file}")
            return

        baseline = load_baseline(test_file)
        if baseline is None:
            save_baseline(test_file, scores)
            pytest.skip(f"No baseline found — created initial baseline for {test_file}")
            return

        # --- Check SSIM regression ---
        for i, (current, base) in enumerate(
            zip(scores["ssim_scores"], baseline.get("ssim_scores", []))
        ):
            if current is None or base is None:
                continue
            drop = base - current
            assert drop <= 0.02, (
                f"Slide {i}: SSIM dropped {drop:.3f} "
                f"(baseline={base:.3f}, current={current:.3f})"
            )

        # --- Check text coverage regression ---
        for i, (current, base) in enumerate(
            zip(scores["text_coverages"], baseline.get("text_coverages", []))
        ):
            drop = base - current
            assert drop <= 0.02, (
                f"Slide {i}: text coverage dropped {drop:.1%} "
                f"(baseline={base:.1%}, current={current:.1%})"
            )

        # --- Check shape count regression ---
        for i, (current, base) in enumerate(
            zip(scores["shape_counts_rn"], baseline.get("shape_counts_rn", []))
        ):
            assert current >= base, (
                f"Slide {i}: shape count decreased "
                f"(baseline={base}, current={current})"
            )
