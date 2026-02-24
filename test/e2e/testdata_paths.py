"""Central path resolver for the testdata/cases/ directory structure.

All test artifacts live under testdata/cases/{stem}/:
    source.pptx          — the PowerPoint file
    ground-truth.pdf     — PDF export
    slides/slide{N}.png  — PNG per slide (1-based)
"""
from __future__ import annotations

from pathlib import Path

TESTDATA_DIR = Path(__file__).resolve().parent / "testdata"
CASES_DIR = TESTDATA_DIR / "cases"


def case_dir(stem: str) -> Path:
    return CASES_DIR / stem


def source_pptx(stem: str) -> Path:
    return CASES_DIR / stem / "source.pptx"


def ground_truth_pdf(stem: str) -> Path:
    return CASES_DIR / stem / "ground-truth.pdf"


def slide_png(stem: str, slide_num: int) -> Path:
    """slide_num is 1-based."""
    return CASES_DIR / stem / "slides" / f"slide{slide_num}.png"


def has_png_ground_truth(stem: str) -> bool:
    return slide_png(stem, 1).exists()


def list_cases() -> list[str]:
    """List all case stems that have at least source.pptx."""
    if not CASES_DIR.exists():
        return []
    return sorted(
        d.name for d in CASES_DIR.iterdir()
        if d.is_dir() and (d / "source.pptx").exists()
    )


def list_cases_with_ground_truth() -> list[str]:
    """List case stems that have both source.pptx and ground-truth.pdf (for E2E tests)."""
    return sorted(
        stem for stem in list_cases()
        if ground_truth_pdf(stem).exists()
    )
