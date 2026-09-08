from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from oracle.provenance import (
    collect_evaluation_provenance,
    detect_renderer_git_state,
    fingerprint_file,
    load_font_profile,
)


def test_collect_evaluation_provenance_fingerprints_inputs_and_font_profile(tmp_path: Path):
    project_root = tmp_path / "repo"
    testdata_dir = project_root / "test/e2e/testdata"
    case_dir = testdata_dir / "cases/sample"
    profile_dir = testdata_dir / "font-profiles"
    case_dir.mkdir(parents=True)
    profile_dir.mkdir(parents=True)

    pptx_path = case_dir / "source.pptx"
    pdf_path = case_dir / "ground-truth.pdf"
    font_path = testdata_dir / "sample-font.woff2"
    profile_path = profile_dir / "sample.json"
    pptx_path.write_bytes(b"pptx-input")
    pdf_path.write_bytes(b"pdf-ground-truth")
    font_path.write_bytes(b"font-input")
    profile_path.write_text(
        json.dumps(
            {
                "version": 1,
                "id": "sample-font-profile",
                "fontFaces": [
                    {
                        "family": "Sample Face",
                        "path": "sample-font.woff2",
                        "descriptors": {"weight": "400"},
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    provenance = collect_evaluation_provenance(
        project_root=project_root,
        testdata_dir=testdata_dir,
        pptx_path=pptx_path,
        ground_truth_paths=[pdf_path],
        ground_truth_kind="pdf",
        browser_name="chromium",
        browser_version="140.0.0.0",
        font_profile_ref="font-profiles/sample.json",
        renderer_revision="abc123",
        renderer_dirty=False,
    )

    assert provenance["schemaVersion"] == 1
    assert provenance["inputs"]["sourcePptx"]["sha256"]
    assert provenance["inputs"]["sourcePptx"]["path"] == "test/e2e/testdata/cases/sample/source.pptx"
    assert provenance["inputs"]["groundTruth"]["kind"] == "pdf"
    assert provenance["runtime"]["browser"] == {
        "name": "chromium",
        "version": "140.0.0.0",
    }
    assert provenance["runtime"]["fontProfile"]["id"] == "sample-font-profile"
    assert provenance["runtime"]["fontProfile"]["faces"][0]["file"]["sha256"]
    assert provenance["renderer"] == {"revision": "abc123", "dirty": False}
    assert str(tmp_path) not in json.dumps(provenance)


def test_load_font_profile_rejects_paths_outside_testdata(tmp_path: Path):
    testdata_dir = tmp_path / "testdata"
    testdata_dir.mkdir()
    outside = tmp_path / "outside.woff2"
    outside.write_bytes(b"font")
    profile = testdata_dir / "escape.json"
    profile.write_text(
        json.dumps(
            {
                "version": 1,
                "id": "escape",
                "fontFaces": [{"family": "Escape", "path": "../outside.woff2"}],
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="outside testdata"):
        load_font_profile(testdata_dir, "escape.json")


def test_load_font_profile_fingerprints_a_local_symlink_to_an_installed_font(tmp_path: Path):
    testdata_dir = tmp_path / "testdata"
    testdata_dir.mkdir()
    installed_font = tmp_path / "installed-font.woff2"
    installed_font.write_bytes(b"licensed-local-font")
    (testdata_dir / "font.woff2").symlink_to(installed_font)
    (testdata_dir / "profile.json").write_text(
        json.dumps(
            {
                "version": 1,
                "id": "local-installed-font",
                "fontFaces": [{"family": "Local Face", "path": "font.woff2"}],
            }
        ),
        encoding="utf-8",
    )

    profile = load_font_profile(testdata_dir, "profile.json")

    assert profile["faces"][0]["file"]["path"] == "font.woff2"
    assert profile["faces"][0]["file"]["sha256"]


def test_fingerprint_file_keeps_logical_case_path_through_local_corpus_symlink(tmp_path: Path):
    project_root = tmp_path / "repo"
    testdata_dir = project_root / "test/e2e/testdata"
    external_cases = tmp_path / "local-corpus"
    source_path = external_cases / "sample/source.pptx"
    testdata_dir.mkdir(parents=True)
    source_path.parent.mkdir(parents=True)
    source_path.write_bytes(b"pptx")
    (testdata_dir / "cases").symlink_to(external_cases, target_is_directory=True)

    fingerprint = fingerprint_file(testdata_dir / "cases/sample/source.pptx", project_root)

    assert fingerprint["path"] == "test/e2e/testdata/cases/sample/source.pptx"


def test_detect_renderer_git_state_refreshes_between_evaluations(monkeypatch, tmp_path: Path):
    state = {"revision": "first", "dirty": ""}

    def fake_run(command, **_kwargs):
        stdout = state["revision"] if command[1:3] == ["rev-parse", "HEAD"] else state["dirty"]
        return SimpleNamespace(stdout=stdout)

    monkeypatch.setattr("oracle.provenance.subprocess.run", fake_run)

    assert detect_renderer_git_state(tmp_path) == ("first", False)
    state.update(revision="second", dirty=" M src/file.ts")
    assert detect_renderer_git_state(tmp_path) == ("second", True)
