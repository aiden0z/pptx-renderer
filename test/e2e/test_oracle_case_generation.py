import json
import subprocess
from pathlib import Path

from oracle.generate_cases import generate_all_cases, generate_all_cases_resilient


def test_generate_all_cases_creates_named_pairs(tmp_path: Path):
    cases_dir = tmp_path / "cases"
    cases_dir.mkdir()

    case_a = {
        "name": "case-a",
        "slides": [{"nodes": [{"kind": "shape", "shape": "RECTANGLE", "left": 10, "top": 10, "width": 100, "height": 60}]}],
    }
    case_b = {
        "name": "case-b",
        "slides": [{"nodes": [{"kind": "textbox", "text": "hello", "left": 10, "top": 10, "width": 200, "height": 60}]}],
    }
    (cases_dir / "case-a.json").write_text(json.dumps(case_a), encoding="utf-8")
    (cases_dir / "case-b.json").write_text(json.dumps(case_b), encoding="utf-8")

    calls = []

    def fake_run_macro(*, macro_host_pptm, macro_name, output_pdf, macro_params, export_after_macro):
        calls.append((macro_host_pptm, macro_name, output_pdf, macro_params))
        assert export_after_macro is False
        spec = Path(macro_params[0]).read_text(encoding="utf-8")
        out_pptx_line = next(line for line in spec.splitlines() if line.startswith("OUT_PPTX|"))
        out_pptx = Path(out_pptx_line.split("|", 1)[1])
        out_pptx.parent.mkdir(parents=True, exist_ok=True)
        out_pptx.write_bytes(b"pptx")
        Path(output_pdf).write_bytes(b"%PDF-1.4\n")

    macro_host = tmp_path / "host.pptm"
    macro_host.write_bytes(b"pptm")

    out = generate_all_cases(
        macro_host=macro_host,
        cases_dir=cases_dir,
        testdata_dir=tmp_path / "testdata",
        run_macro_fn=fake_run_macro,
    )

    assert len(out) == 2
    # Output paths are testdata/cases/{stem}/source.pptx — use parent dir name as case name
    assert {p.parent.name for p in out} == {"case-a", "case-b"}
    assert len(calls) == 2
    for pptx_path in out:
        assert pptx_path.exists()
        assert pptx_path.name == "source.pptx"
        assert (pptx_path.parent / "ground-truth.pdf").exists()


def test_generate_all_cases_resilient_collects_failures(tmp_path: Path):
    cases_dir = tmp_path / "cases"
    cases_dir.mkdir()

    for name in ("case-a", "case-b", "case-c"):
        case = {
            "name": name,
            "slides": [{"nodes": [{"kind": "shape", "shape": "RECTANGLE", "left": 10, "top": 10, "width": 100, "height": 60}]}],
        }
        (cases_dir / f"{name}.json").write_text(json.dumps(case), encoding="utf-8")

    call_idx = {"n": 0}

    def fake_run_macro(*, macro_host_pptm, macro_name, output_pdf, macro_params, export_after_macro):
        call_idx["n"] += 1
        spec = Path(macro_params[0]).read_text(encoding="utf-8")
        if call_idx["n"] == 2:
            raise RuntimeError("layout not available")
        out_pptx_line = next(line for line in spec.splitlines() if line.startswith("OUT_PPTX|"))
        out_pptx = Path(out_pptx_line.split("|", 1)[1])
        out_pptx.parent.mkdir(parents=True, exist_ok=True)
        out_pptx.write_bytes(b"pptx")
        Path(output_pdf).write_bytes(b"%PDF-1.4\n")

    macro_host = tmp_path / "host.pptm"
    macro_host.write_bytes(b"pptm")

    generated, failures = generate_all_cases_resilient(
        macro_host=macro_host,
        cases_dir=cases_dir,
        testdata_dir=tmp_path / "testdata",
        run_macro_fn=fake_run_macro,
    )

    assert {p.parent.name for p in generated} == {"case-a", "case-c"}
    assert len(failures) == 1
    assert failures[0]["case"] == "case-b"
    assert "layout not available" in failures[0]["error"]


def test_generate_all_cases_reuses_existing_pairs_when_cached(tmp_path: Path):
    cases_dir = tmp_path / "cases"
    cases_dir.mkdir()
    for name in ("case-a", "case-b"):
        case = {
            "name": name,
            "slides": [{"nodes": [{"kind": "shape", "shape": "RECTANGLE", "left": 10, "top": 10, "width": 100, "height": 60}]}],
        }
        (cases_dir / f"{name}.json").write_text(json.dumps(case), encoding="utf-8")

    # Pre-populate cache in nested layout: testdata/cases/{stem}/source.pptx + ground-truth.pdf
    testdata_dir = tmp_path / "testdata"
    cached_case_dir = testdata_dir / "cases" / "case-a"
    cached_case_dir.mkdir(parents=True)
    cached_pptx = cached_case_dir / "source.pptx"
    cached_pdf = cached_case_dir / "ground-truth.pdf"
    cached_pptx.write_bytes(b"cached-pptx")
    cached_pdf.write_bytes(b"cached-pdf")

    calls = []

    def fake_run_macro(*, macro_host_pptm, macro_name, output_pdf, macro_params, export_after_macro):
        calls.append((macro_host_pptm, macro_name, output_pdf, macro_params))
        spec = Path(macro_params[0]).read_text(encoding="utf-8")
        out_pptx_line = next(line for line in spec.splitlines() if line.startswith("OUT_PPTX|"))
        out_pptx = Path(out_pptx_line.split("|", 1)[1])
        out_pptx.parent.mkdir(parents=True, exist_ok=True)
        out_pptx.write_bytes(b"generated-pptx")
        Path(output_pdf).write_bytes(b"generated-pdf")

    macro_host = tmp_path / "host.pptm"
    macro_host.write_bytes(b"pptm")

    out = generate_all_cases(
        macro_host=macro_host,
        cases_dir=cases_dir,
        testdata_dir=testdata_dir,
        run_macro_fn=fake_run_macro,
        reuse_existing=True,
    )

    assert {p.parent.name for p in out} == {"case-a", "case-b"}
    assert len(calls) == 1  # Only case-b was generated; case-a was cached
    assert cached_pptx.read_bytes() == b"cached-pptx"
    assert cached_pdf.read_bytes() == b"cached-pdf"


def test_generate_all_cases_filters_to_selected_names(tmp_path: Path):
    cases_dir = tmp_path / "cases"
    cases_dir.mkdir()
    for name in ("case-a", "case-b", "case-c"):
        case = {
            "name": name,
            "slides": [{"nodes": [{"kind": "shape", "shape": "RECTANGLE", "left": 10, "top": 10, "width": 100, "height": 60}]}],
        }
        (cases_dir / f"{name}.json").write_text(json.dumps(case), encoding="utf-8")

    calls = []

    def fake_run_macro(*, macro_host_pptm, macro_name, output_pdf, macro_params, export_after_macro):
        calls.append((macro_host_pptm, macro_name, output_pdf, macro_params))
        spec = Path(macro_params[0]).read_text(encoding="utf-8")
        out_pptx_line = next(line for line in spec.splitlines() if line.startswith("OUT_PPTX|"))
        out_pptx = Path(out_pptx_line.split("|", 1)[1])
        out_pptx.parent.mkdir(parents=True, exist_ok=True)
        out_pptx.write_bytes(b"pptx")
        Path(output_pdf).write_bytes(b"%PDF-1.4\n")

    macro_host = tmp_path / "host.pptm"
    macro_host.write_bytes(b"pptm")

    out = generate_all_cases(
        macro_host=macro_host,
        cases_dir=cases_dir,
        testdata_dir=tmp_path / "testdata",
        run_macro_fn=fake_run_macro,
        case_names={"case-b"},
        reuse_existing=False,
    )

    assert [p.parent.name for p in out] == ["case-b"]
    assert len(calls) == 1


def test_generate_all_cases_resilient_includes_stderr_for_called_process_error(tmp_path: Path):
    cases_dir = tmp_path / "cases"
    cases_dir.mkdir()
    case = {
        "name": "case-a",
        "slides": [{"nodes": [{"kind": "shape", "shape": "RECTANGLE", "left": 10, "top": 10, "width": 100, "height": 60}]}],
    }
    (cases_dir / "case-a.json").write_text(json.dumps(case), encoding="utf-8")

    def fake_run_macro(*, macro_host_pptm, macro_name, output_pdf, macro_params, export_after_macro):
        raise subprocess.CalledProcessError(
            returncode=1,
            cmd=["osascript"],
            stderr="Not authorized to send Apple events to Microsoft PowerPoint. (-1743)",
        )

    macro_host = tmp_path / "host.pptm"
    macro_host.write_bytes(b"pptm")

    generated, failures = generate_all_cases_resilient(
        macro_host=macro_host,
        cases_dir=cases_dir,
        testdata_dir=tmp_path / "testdata",
        run_macro_fn=fake_run_macro,
    )

    assert generated == []
    assert len(failures) == 1
    assert failures[0]["case"] == "case-a"
    assert "-1743" in failures[0]["error"]
