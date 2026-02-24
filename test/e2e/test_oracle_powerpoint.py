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
        Path(cmd[-1]).write_bytes(b"%PDF-1.4\n")

    host = tmp_path / "host.pptm"
    host.write_bytes(b"pptm")
    out = tmp_path / "out.pdf"

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
    assert cmd[-4:] == ["GenerateProbeDeck_FromSpec", "/tmp/spec.txt", "arg2", str(out)]
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
    assert cmd[-2:] == ["ExportSmartArtLayouts_ToFile", "/tmp/layouts.txt"]
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
    assert any("save active presentation in outPdf as save as PDF" in arg for arg in second_cmd)


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
