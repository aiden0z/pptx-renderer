from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

import server


RUN_ALL_PATH = Path(__file__).resolve().parent / "scripts" / "run_all_shapes_eval.py"


def _load_run_all_module():
    spec = importlib.util.spec_from_file_location("run_all_shapes_eval", RUN_ALL_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_render_slide_url_includes_explicit_font_profile(monkeypatch):
    monkeypatch.setenv("PPTX_E2E_FONT_PROFILE", "font-profiles/office-zh.json")

    url = server._render_slide_url("sample", 2, None)

    assert "file=testdata/cases/sample/source.pptx" in url
    assert "slide=2" in url
    assert "fontProfile=font-profiles%2Foffice-zh.json" in url


def test_render_slide_url_omits_font_profile_by_default(monkeypatch):
    monkeypatch.delenv("PPTX_E2E_FONT_PROFILE", raising=False)

    assert "fontProfile=" not in server._render_slide_url("sample", 0, None)


@pytest.mark.parametrize(
    "profile_ref",
    ["../escape.json", "/absolute.json", "https://example.com/profile.json", r"..\escape.json"],
)
def test_render_slide_url_rejects_non_local_font_profile(monkeypatch, profile_ref: str):
    monkeypatch.setenv("PPTX_E2E_FONT_PROFILE", profile_ref)

    with pytest.raises(ValueError, match="testdata-relative"):
        server._render_slide_url("sample", 0, None)


def test_batch_result_preserves_case_provenance():
    run_all = _load_run_all_module()
    provenance = {
        "schemaVersion": 1,
        "inputs": {"sourcePptx": {"sha256": "abc"}},
        "runtime": {"browser": {"name": "chromium", "version": "140"}},
    }

    result = run_all._result_from_evaluate_response(
        "sample",
        {
            "avgSsim": 0.9,
            "avgColorHistCorr": 0.99,
            "slideCount": 1,
            "visibleSlideCount": 1,
            "supported": False,
            "quality": {"needsReview": True},
            "provenance": provenance,
        },
    )

    assert result["provenance"] == provenance
