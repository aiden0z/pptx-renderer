from __future__ import annotations

import subprocess
import shutil
from pathlib import Path
from typing import Callable

from oracle.case_compiler import compile_case_to_spec
from oracle.powerpoint_oracle import run_macro_export


def _default_macro_runner(**kwargs):
    return run_macro_export(**kwargs)


def _format_generation_error(exc: Exception) -> str:
    if isinstance(exc, subprocess.CalledProcessError):
        parts = [str(exc)]
        stderr = (exc.stderr or "").strip()
        stdout = (exc.stdout or "").strip()
        if stderr:
            parts.append(f"stderr: {stderr}")
        if stdout:
            parts.append(f"stdout: {stdout}")
        return " | ".join(parts)
    return str(exc)


def _run_case_generation(
    *,
    case_json: Path,
    stem: str,
    macro_host: Path,
    testdata_dir: Path,
    run_macro_fn: Callable[..., object],
    reuse_existing: bool,
    export_png: bool = False,
    png_width: int = 0,
    png_height: int = 0,
) -> Path:
    case_d = testdata_dir / "cases" / stem
    pptx_path = case_d / "source.pptx"
    pdf_path = case_d / "ground-truth.pdf"
    slides_d = case_d / "slides"
    png_slide1 = slides_d / "slide1.png"
    if reuse_existing and pptx_path.exists() and pdf_path.exists():
        # If PNG export requested but not yet generated, regenerate
        if export_png and not png_slide1.exists():
            pass  # fall through to regenerate
        else:
            return pptx_path

    runtime_dir = testdata_dir / "oracle-runtime"
    spec_path = runtime_dir / "_macro-spec.txt"
    runtime_dir.mkdir(parents=True, exist_ok=True)
    case_d.mkdir(parents=True, exist_ok=True)

    # Keep PowerPoint write targets fixed to avoid per-file permission prompts on macOS.
    sink_pptx = runtime_dir / "_macro-output.pptx"
    sink_pdf = runtime_dir / "_macro-output.pdf"
    sink_png_prefix = runtime_dir / "_macro-output"
    if sink_pptx.exists():
        sink_pptx.unlink()
    if sink_pdf.exists():
        sink_pdf.unlink()
    # Clean up any leftover PNG sinks
    for old_png in runtime_dir.glob("_macro-output_slide*.png"):
        old_png.unlink()

    compile_case_to_spec(
        case_json,
        spec_path,
        sink_pptx,
        sink_pdf,
        output_png_prefix=sink_png_prefix if export_png else None,
        png_width=png_width,
        png_height=png_height,
    )

    run_macro_fn(
        macro_host_pptm=macro_host,
        macro_name="GenerateProbeDeck_FromSpec",
        output_pdf=sink_pdf,
        macro_params=[str(spec_path)],
        export_after_macro=False,
    )

    if not sink_pptx.exists() or not sink_pdf.exists():
        raise RuntimeError(f"Failed to generate macro sink output for {stem}")

    shutil.copy2(sink_pptx, pptx_path)
    shutil.copy2(sink_pdf, pdf_path)

    # Copy PNG ground-truth files if generated
    for sink_png in sorted(runtime_dir.glob("_macro-output_slide*.png")):
        slides_d.mkdir(parents=True, exist_ok=True)
        # _macro-output_slide1.png → slide1.png
        num = sink_png.stem.split("_slide")[1]
        dest_png = slides_d / f"slide{num}.png"
        shutil.copy2(sink_png, dest_png)

    if not pptx_path.exists() or not pdf_path.exists():
        raise RuntimeError(f"Failed to materialize pair for {stem}")

    return pptx_path


def _iter_case_json_paths(cases_dir: Path, case_names: set[str] | None) -> list[Path]:
    all_cases = sorted(cases_dir.glob("*.json"))
    if not case_names:
        return all_cases
    selected = {name.strip() for name in case_names if name and name.strip()}
    if not selected:
        return []
    return [p for p in all_cases if p.stem in selected]


def generate_all_cases(
    macro_host: Path,
    cases_dir: Path,
    testdata_dir: Path,
    run_macro_fn: Callable[..., object] = _default_macro_runner,
    case_names: set[str] | None = None,
    reuse_existing: bool = True,
    export_png: bool = False,
    png_width: int = 0,
    png_height: int = 0,
) -> list[Path]:
    """Generate PPTX/PDF pairs in testdata for all JSON cases in cases_dir.

    If export_png is True, also exports each slide as PNG via Slide.Export.
    """
    cases_dir = Path(cases_dir)
    testdata_dir = Path(testdata_dir)
    testdata_dir.mkdir(parents=True, exist_ok=True)

    generated: list[Path] = []

    for case_json in _iter_case_json_paths(cases_dir, case_names):
        stem = case_json.stem
        generated.append(
            _run_case_generation(
                case_json=case_json,
                stem=stem,
                macro_host=macro_host,
                testdata_dir=testdata_dir,
                run_macro_fn=run_macro_fn,
                reuse_existing=reuse_existing,
                export_png=export_png,
                png_width=png_width,
                png_height=png_height,
            )
        )

    return generated


def generate_all_cases_resilient(
    macro_host: Path,
    cases_dir: Path,
    testdata_dir: Path,
    run_macro_fn: Callable[..., object] = _default_macro_runner,
    case_names: set[str] | None = None,
    reuse_existing: bool = True,
    export_png: bool = False,
    png_width: int = 0,
    png_height: int = 0,
) -> tuple[list[Path], list[dict[str, str]]]:
    """Generate all cases and collect per-case failures without aborting the whole batch."""
    cases_dir = Path(cases_dir)
    testdata_dir = Path(testdata_dir)
    testdata_dir.mkdir(parents=True, exist_ok=True)

    generated: list[Path] = []
    failures: list[dict[str, str]] = []

    for case_json in _iter_case_json_paths(cases_dir, case_names):
        stem = case_json.stem
        try:
            generated.append(
                _run_case_generation(
                    case_json=case_json,
                    stem=stem,
                    macro_host=macro_host,
                    testdata_dir=testdata_dir,
                    run_macro_fn=run_macro_fn,
                    reuse_existing=reuse_existing,
                    export_png=export_png,
                    png_width=png_width,
                    png_height=png_height,
                )
            )
        except Exception as exc:  # noqa: BLE001
            spec_path = testdata_dir / "oracle-runtime" / "_macro-spec.txt"
            failures.append(
                {
                    "case": stem,
                    "error": _format_generation_error(exc),
                    "spec_path": str(spec_path),
                }
            )

    return generated, failures
