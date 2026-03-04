"""Central path resolver for the testdata/cases/ directory structure.

All test artifacts live under testdata/cases/{stem}/:
    source.pptx          — the PowerPoint file
    ground-truth.pdf     — PDF export
    slides/slide{N}.png  — PNG per slide (1-based)

Windows-generated cases live under testdata/windows-cases/{stem}/ with the
same layout.  Pass ``source="windows"`` to any function below to resolve
against that directory instead of the default ``cases/``.
"""
from __future__ import annotations

from pathlib import Path

TESTDATA_DIR = Path(__file__).resolve().parent / "testdata"
CASES_DIR = TESTDATA_DIR / "cases"
WINDOWS_CASES_DIR = TESTDATA_DIR / "windows-cases"


def _resolve_cases_dir(source: str | None = None) -> Path:
    if source == "windows":
        return WINDOWS_CASES_DIR
    return CASES_DIR


def case_dir(stem: str, source: str | None = None) -> Path:
    return _resolve_cases_dir(source) / stem


def source_pptx(stem: str, source: str | None = None) -> Path:
    return _resolve_cases_dir(source) / stem / "source.pptx"


def ground_truth_pdf(stem: str, source: str | None = None) -> Path:
    return _resolve_cases_dir(source) / stem / "ground-truth.pdf"


def slide_png(stem: str, slide_num: int, source: str | None = None) -> Path:
    """slide_num is 1-based."""
    return _resolve_cases_dir(source) / stem / "slides" / f"slide{slide_num}.png"


def has_png_ground_truth(stem: str, source: str | None = None) -> bool:
    return slide_png(stem, 1, source).exists()


def list_cases(source: str | None = None) -> list[str]:
    """List all case stems that have at least source.pptx."""
    cases_dir = _resolve_cases_dir(source)
    if not cases_dir.exists():
        return []
    return sorted(
        d.name for d in cases_dir.iterdir()
        if d.is_dir() and (d / "source.pptx").exists()
    )


def list_cases_with_ground_truth(source: str | None = None) -> list[str]:
    """List case stems that have both source.pptx and ground-truth.pdf (for E2E tests)."""
    return sorted(
        stem for stem in list_cases(source)
        if ground_truth_pdf(stem, source).exists()
    )
