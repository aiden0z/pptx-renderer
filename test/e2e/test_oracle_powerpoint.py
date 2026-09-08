import sys
from pathlib import Path
import subprocess

import pytest

from oracle.powerpoint_oracle import (
    PowerPointExportError,
    export_pptx_to_pdf_mac,
    run_macro_only_mac,
    run_macro_export_mac,
)

pytestmark = pytest.mark.skipif(
    sys.platform == "win32",
    reason="AppleScript-based tests are macOS-only",
)


def test_export_invokes_osascript_with_expected_args(tmp_path: Path):
    calls = []

    def fake_runner(cmd, **kwargs):
        calls.append((cmd, kwargs))
        Path(cmd[3]).write_bytes(b"%PDF-1.4\n")

    pptx = tmp_path / "sample.pptx"
    pptx.write_bytes(b"pptx")
    pdf = tmp_path / "out" / "sample.pdf"

    result = export_pptx_to_pdf_mac(
        pptx_path=pptx,
        pdf_path=pdf,
        runner=fake_runner,
        retries=0,
    )

    assert result.attempts == 1
    assert result.output_pdf == pdf
    assert len(calls) == 1

    cmd, kwargs = calls[0]
    assert cmd[0] == "osascript"
    assert cmd[2] == str(pptx)
    assert cmd[3] == str(pdf)
    assert kwargs["check"] is True
    assert kwargs["capture_output"] is True
    assert kwargs["text"] is True


def test_export_stages_powerpoint_io_in_one_fixed_runtime_directory(tmp_path: Path):
    calls = []

    def fake_runner(cmd, **kwargs):
        calls.append((cmd, kwargs))
        staged_input = Path(cmd[2])
        staged_output = Path(cmd[3])
        assert staged_input.read_bytes() == b"source-pptx"
        staged_output.write_bytes(b"%PDF-staged\n")

    pptx = tmp_path / "cases" / "case-a" / "source.pptx"
    pptx.parent.mkdir(parents=True)
    pptx.write_bytes(b"source-pptx")
    pdf = tmp_path / "cases" / "case-a" / "ground-truth.pdf"
    runtime_dir = tmp_path / "oracle-runtime"

    result = export_pptx_to_pdf_mac(
        pptx_path=pptx,
        pdf_path=pdf,
        runner=fake_runner,
        retries=0,
        runtime_dir=runtime_dir,
    )

    cmd, _kwargs = calls[0]
    assert cmd[2] == str((runtime_dir / "_pptx-input.pptx").resolve())
    assert cmd[3] == str((runtime_dir / "_pptx-output.pdf").resolve())
    assert pdf.read_bytes() == b"%PDF-staged\n"
    assert result.output_pdf == pdf.resolve()


def test_export_timeout_identifies_interactive_powerpoint_block(tmp_path: Path):
    attempts = {"count": 0}

    def timeout_runner(cmd, **kwargs):
        attempts["count"] += 1
        raise subprocess.TimeoutExpired(cmd=cmd, timeout=kwargs["timeout"])

    pptx = tmp_path / "sample.pptx"
    pptx.write_bytes(b"pptx")

    with pytest.raises(PowerPointExportError) as exc_info:
        export_pptx_to_pdf_mac(
            pptx_path=pptx,
            pdf_path=tmp_path / "sample.pdf",
            runner=timeout_runner,
            retries=2,
            backoff_sec=0,
            timeout_sec=7,
        )

    message = str(exc_info.value)
    assert attempts["count"] == 1
    assert "timed out after 7" in message
    assert "unlocked" in message
    assert "Grant File Access" in message


def test_export_does_not_accept_a_stale_direct_output(tmp_path: Path):
    pptx = tmp_path / "sample.pptx"
    pptx.write_bytes(b"pptx")
    pdf = tmp_path / "sample.pdf"
    pdf.write_bytes(b"%PDF-stale\n")

    with pytest.raises(PowerPointExportError, match="missing/empty"):
        export_pptx_to_pdf_mac(
            pptx_path=pptx,
            pdf_path=pdf,
            runner=lambda _cmd, **_kwargs: None,
            retries=0,
        )

    assert not pdf.exists()


def test_export_retries_once_then_succeeds(tmp_path: Path):
    attempts = {"n": 0}

    def flaky_runner(cmd, **kwargs):
        attempts["n"] += 1
        if attempts["n"] == 1:
            raise RuntimeError("transient powerpoint automation failure")
        Path(cmd[3]).write_bytes(b"%PDF-1.4\n")

    pptx = tmp_path / "sample.pptx"
    pptx.write_bytes(b"pptx")
    pdf = tmp_path / "sample.pdf"

    result = export_pptx_to_pdf_mac(
        pptx_path=pptx,
        pdf_path=pdf,
        runner=flaky_runner,
        retries=1,
        backoff_sec=0,
    )

    assert attempts["n"] == 2
    assert result.attempts == 2


def test_export_raises_after_exhausting_retries(tmp_path: Path):
    def always_fail(_cmd, **_kwargs):
        raise RuntimeError("powerpoint is busy")

    pptx = tmp_path / "sample.pptx"
    pptx.write_bytes(b"pptx")

    with pytest.raises(PowerPointExportError):
        export_pptx_to_pdf_mac(
            pptx_path=pptx,
            pdf_path=tmp_path / "sample.pdf",
            runner=always_fail,
            retries=1,
            backoff_sec=0,
        )


def test_export_error_includes_osascript_stderr(tmp_path: Path):
    def fail_with_powerpoint_code(cmd, **_kwargs):
        raise subprocess.CalledProcessError(
            returncode=1,
            cmd=cmd,
            stderr="Microsoft PowerPoint error -9074",
        )

    pptx = tmp_path / "sample.pptx"
    pptx.write_bytes(b"pptx")

    with pytest.raises(PowerPointExportError, match="-9074"):
        export_pptx_to_pdf_mac(
            pptx_path=pptx,
            pdf_path=tmp_path / "sample.pdf",
            runner=fail_with_powerpoint_code,
            retries=0,
        )


def test_export_applescript_targets_only_the_requested_presentation_by_full_name():
    script_path = (
        Path(__file__).resolve().parent
        / "oracle"
        / "scripts"
        / "export_pptx_to_pdf.applescript"
    )
    script = script_path.read_text(encoding="utf-8")

    assert "set inputPosixPath to item 1 of argv" in script
    assert "set presentationPaths to (get full name of every presentation)" in script
    assert "repeat with presentationIndex from 1 to count of presentationPaths" in script
    assert "set openedPresentation to presentation presentationIndex" in script
    assert "set openedPresentation to active presentation" not in script
    assert "on error errorMessage number errorNumber" in script
    assert "close openedPresentation saving no" in script
    assert "error errorMessage number errorNumber" in script


@pytest.mark.parametrize(
    "script_name",
    ["run_macro_export.applescript", "run_macro_only.applescript"],
)
def test_macro_applescripts_target_only_the_requested_macro_host(script_name: str):
    script_path = Path(__file__).resolve().parent / "oracle" / "scripts" / script_name
    script = script_path.read_text(encoding="utf-8")

    assert "set inputPosixPath to item 1 of argv" in script
    assert "set presentationPaths to (get full name of every presentation)" in script
    assert "set openedPresentation to presentation presentationIndex" in script
    assert "active presentation" not in script
    assert 'if macroName does not contain "!" then' in script
    assert 'set macroInvocationName to (name of openedPresentation) & "!" & macroName' in script
    assert "run VB macro macro name macroInvocationName" in script
    assert "close openedPresentation saving no" in script


def test_export_validates_input_file_exists(tmp_path: Path):
    with pytest.raises(FileNotFoundError):
        export_pptx_to_pdf_mac(
            pptx_path=tmp_path / "missing.pptx",
            pdf_path=tmp_path / "out.pdf",
        )


def test_run_macro_export_builds_command_with_parameters(tmp_path: Path):
    calls = []

    def fake_runner(cmd, **kwargs):
        calls.append((cmd, kwargs))
        assert not out.exists()
        Path(cmd[-1]).write_bytes(b"%PDF-1.4\n")

    host = tmp_path / "host.pptm"
    host.write_bytes(b"pptm")
    out = tmp_path / "out.pdf"
    out.write_bytes(b"%PDF-stale\n")

    result = run_macro_export_mac(
        macro_host_pptm=host,
        macro_name="GenerateProbeDeck_FromSpec",
        output_pdf=out,
        macro_params=["/tmp/spec.txt", "arg2"],
        runner=fake_runner,
    )

    assert result == out
    cmd, kwargs = calls[0]
    assert cmd[0] == "osascript"
    assert cmd[-4:] == ["host.pptm!GenerateProbeDeck_FromSpec", "/tmp/spec.txt", "arg2", str(out)]
    assert kwargs["check"] is True
    assert kwargs["capture_output"] is True
    assert kwargs["text"] is True


def test_run_macro_export_no_post_export_uses_macro_only_script(tmp_path: Path):
    calls = []

    def fake_runner(cmd, **kwargs):
        calls.append((cmd, kwargs))
        # Simulate macro-generated PDF already existing
        (tmp_path / "out.pdf").write_bytes(b"%PDF-1.4\n")

    host = tmp_path / "host.pptm"
    host.write_bytes(b"pptm")

    run_macro_export_mac(
        macro_host_pptm=host,
        macro_name="GenerateProbeDeck_FromSpec",
        output_pdf=tmp_path / "out.pdf",
        macro_params=["/tmp/spec.txt"],
        export_after_macro=False,
        runner=fake_runner,
    )

    cmd, _ = calls[0]
    assert cmd[0] == "osascript"
    assert cmd[1].endswith("run_macro_only.applescript")
    assert cmd[2:4] == [str(host.resolve()), "host.pptm!GenerateProbeDeck_FromSpec"]
    assert cmd[-1] == "/tmp/spec.txt"


def test_run_macro_only_builds_command_without_output_check(tmp_path: Path):
    calls = []

    def fake_runner(cmd, **kwargs):
        calls.append((cmd, kwargs))

    host = tmp_path / "host.pptm"
    host.write_bytes(b"pptm")

    run_macro_only_mac(
        macro_host_pptm=host,
        macro_name="ExportSmartArtLayouts_ToFile",
        macro_params=["/tmp/layouts.txt"],
        runner=fake_runner,
    )

    cmd, kwargs = calls[0]
    assert cmd[0] == "osascript"
    assert cmd[1].endswith("run_macro_only.applescript")
    assert cmd[-2:] == ["host.pptm!ExportSmartArtLayouts_ToFile", "/tmp/layouts.txt"]
    assert kwargs["check"] is True


def test_run_macro_export_falls_back_to_inline_osascript_on_parse_error(tmp_path: Path):
    calls = []

    def flaky_runner(cmd, **kwargs):
        calls.append((cmd, kwargs))
        if len(calls) == 1:
            raise subprocess.CalledProcessError(
                returncode=1,
                cmd=cmd,
                stderr="script error: Expected end of line but found identifier. (-2741)",
            )
        out.write_bytes(b"%PDF-1.4\n")

    host = tmp_path / "host.pptm"
    host.write_bytes(b"pptm")
    out = tmp_path / "out.pdf"

    result = run_macro_export_mac(
        macro_host_pptm=host,
        macro_name="GenerateProbeDeck_FromSpec",
        output_pdf=out,
        macro_params=["/tmp/spec.txt"],
        runner=flaky_runner,
    )

    assert result == out
    assert len(calls) == 2
    first_cmd, _ = calls[0]
    second_cmd, _ = calls[1]
    assert first_cmd[1].endswith("run_macro_export.applescript")
    assert second_cmd[0] == "osascript"
    assert "-e" in second_cmd
    assert any("run VB macro macro name macroName" in arg for arg in second_cmd)
    assert any("host.pptm!GenerateProbeDeck_FromSpec" in arg for arg in second_cmd)
    assert any("save openedPresentation in outPdf as save as PDF" in arg for arg in second_cmd)
    assert not any("active presentation" in arg for arg in second_cmd)


def test_run_macro_only_falls_back_to_inline_osascript_on_parse_error(tmp_path: Path):
    calls = []

    def flaky_runner(cmd, **kwargs):
        calls.append((cmd, kwargs))
        if len(calls) == 1:
            raise subprocess.CalledProcessError(
                returncode=1,
                cmd=cmd,
                stderr="script error: Expected end of line but found identifier. (-2741)",
            )
        return None

    host = tmp_path / "host.pptm"
    host.write_bytes(b"pptm")

    run_macro_only_mac(
        macro_host_pptm=host,
        macro_name="GenerateProbeDeck_FromSpec",
        macro_params=["/tmp/spec.txt"],
        runner=flaky_runner,
    )

    assert len(calls) == 2
    first_cmd, _ = calls[0]
    second_cmd, _ = calls[1]
    assert first_cmd[1].endswith("run_macro_only.applescript")
    assert second_cmd[0] == "osascript"
    assert "-e" in second_cmd
    assert any("run VB macro macro name macroName" in arg for arg in second_cmd)
    assert any("host.pptm!GenerateProbeDeck_FromSpec" in arg for arg in second_cmd)


def test_run_macro_only_reports_clear_message_when_automation_not_authorized(tmp_path: Path):
    def fake_runner(cmd, **kwargs):
        raise subprocess.CalledProcessError(
            returncode=1,
            cmd=cmd,
            stderr="execution error: Not authorized to send Apple events to Microsoft PowerPoint. (-1743)",
        )

    host = tmp_path / "host.pptm"
    host.write_bytes(b"pptm")

    with pytest.raises(PowerPointExportError) as exc_info:
        run_macro_only_mac(
            macro_host_pptm=host,
            macro_name="GenerateProbeDeck_FromSpec",
            macro_params=["/tmp/spec.txt"],
            runner=fake_runner,
        )

    message = str(exc_info.value)
    assert "-1743" in message
    assert "Automation" in message
    assert "Microsoft PowerPoint" in message


def test_run_macro_only_timeout_identifies_interactive_powerpoint_block(tmp_path: Path):
    calls = []

    def timeout_runner(cmd, **kwargs):
        calls.append((cmd, kwargs))
        raise subprocess.TimeoutExpired(cmd=cmd, timeout=kwargs["timeout"])

    host = tmp_path / "host.pptm"
    host.write_bytes(b"pptm")

    with pytest.raises(PowerPointExportError) as exc_info:
        run_macro_only_mac(
            macro_host_pptm=host,
            macro_name="ExportSmartArtLayouts_ToFile",
            macro_params=["/tmp/layouts.txt"],
            runner=timeout_runner,
            timeout_sec=9,
        )

    assert len(calls) == 1
    assert calls[0][1]["timeout"] == 9
    message = str(exc_info.value)
    assert "timed out after 9" in message
    assert "unlocked" in message
    assert "Grant File Access" in message
