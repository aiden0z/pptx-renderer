from __future__ import annotations

import gc
import subprocess
import sys
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Generator


class PowerPointExportError(RuntimeError):
    """Raised when PowerPoint automation export fails after retries."""


@dataclass(frozen=True)
class ExportResult:
    output_pdf: Path
    attempts: int


def _default_runner(cmd: list[str], **kwargs):
    return subprocess.run(cmd, **kwargs)


def _as_osascript_literal(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def _build_macro_inline_cmd(
    *,
    macro_host_pptm: Path,
    macro_name: str,
    macro_params: list[str] | None = None,
    output_pdf: Path | None = None,
) -> list[str]:
    params = macro_params or []
    params_literal = ", ".join(_as_osascript_literal(param) for param in params)

    lines = [
        f"set inPptmPath to {_as_osascript_literal(str(macro_host_pptm))}",
        f"set macroName to {_as_osascript_literal(macro_name)}",
        f"set macroParams to {{{params_literal}}}",
    ]
    if output_pdf is not None:
        lines.append(f"set outPdfPath to {_as_osascript_literal(str(output_pdf))}")

    lines.extend(
        [
            'tell application "Microsoft PowerPoint"',
            "set inPptm to POSIX file inPptmPath",
            "open inPptm",
            "run VB macro macro name macroName list of parameters macroParams",
        ]
    )

    if output_pdf is not None:
        lines.extend(
            [
                "set outPdf to POSIX file outPdfPath",
                "save active presentation in outPdf as save as PDF",
            ]
        )

    lines.extend(
        [
            "close active presentation saving no",
            "end tell",
        ]
    )

    cmd = ["osascript"]
    for line in lines:
        cmd.extend(["-e", line])
    return cmd


def _is_applescript_parse_error(exc: Exception) -> bool:
    if not isinstance(exc, subprocess.CalledProcessError):
        return False
    text = _called_process_text(exc)
    return "(-2741)" in text or "Expected end of line" in text


def _called_process_text(exc: subprocess.CalledProcessError) -> str:
    return "\n".join(
        [
            str(exc),
            exc.stderr or "",
            exc.stdout or "",
        ]
    )


def _is_automation_auth_error(exc: Exception) -> bool:
    if not isinstance(exc, subprocess.CalledProcessError):
        return False
    text = _called_process_text(exc)
    return "(-1743)" in text or "Not authorized to send Apple events" in text


def _raise_automation_auth_error(exc: subprocess.CalledProcessError):
    details = _called_process_text(exc).strip()
    raise PowerPointExportError(
        "PowerPoint Automation was blocked by macOS (-1743). "
        "Enable permission in System Settings > Privacy & Security > Automation, "
        "allow your terminal app to control Microsoft PowerPoint, then rerun.\n"
        f"Underlying error: {details}"
    ) from exc


def _run_with_parse_fallback(
    *,
    runner: Callable[..., object],
    primary_cmd: list[str],
    fallback_cmd: list[str],
):
    try:
        runner(primary_cmd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as exc:
        if _is_applescript_parse_error(exc):
            try:
                runner(fallback_cmd, check=True, capture_output=True, text=True)
                return
            except subprocess.CalledProcessError as fallback_exc:
                if _is_automation_auth_error(fallback_exc):
                    _raise_automation_auth_error(fallback_exc)
                raise
        if _is_automation_auth_error(exc):
            _raise_automation_auth_error(exc)
        raise


def export_pptx_to_pdf_mac(
    pptx_path: Path,
    pdf_path: Path,
    runner: Callable[..., object] = _default_runner,
    retries: int = 2,
    backoff_sec: float = 1.0,
) -> ExportResult:
    """Export a PPTX to PDF using Microsoft PowerPoint on macOS via AppleScript."""
    src = Path(pptx_path)
    out = Path(pdf_path)

    if not src.exists():
        raise FileNotFoundError(f"PPTX not found: {src}")

    out.parent.mkdir(parents=True, exist_ok=True)

    script_path = Path(__file__).resolve().parent / "scripts" / "export_pptx_to_pdf.applescript"
    cmd = ["osascript", str(script_path), str(src), str(out)]

    last_error: Exception | None = None
    for attempt in range(1, retries + 2):
        try:
            runner(cmd, check=True, capture_output=True, text=True)
            if not out.exists() or out.stat().st_size == 0:
                raise PowerPointExportError(f"PowerPoint reported success but PDF missing/empty: {out}")
            return ExportResult(output_pdf=out, attempts=attempt)
        except Exception as exc:  # pragma: no cover - exercised by tests via fake runners
            last_error = exc
            if attempt > retries:
                break
            if backoff_sec > 0:
                time.sleep(backoff_sec)

    raise PowerPointExportError(
        f"Failed to export {src} -> {out} after {retries + 1} attempt(s): {last_error}"
    )


def run_macro_export_mac(
    macro_host_pptm: Path,
    macro_name: str,
    output_pdf: Path,
    macro_params: list[str] | None = None,
    export_after_macro: bool = True,
    runner: Callable[..., object] = _default_runner,
):
    """Open a macro-enabled PowerPoint file, run a VBA macro, and export current presentation to PDF."""
    host = Path(macro_host_pptm)
    out = Path(output_pdf)

    if not host.exists():
        raise FileNotFoundError(f"Macro host PPTM not found: {host}")

    out.parent.mkdir(parents=True, exist_ok=True)
    scripts_dir = Path(__file__).resolve().parent / "scripts"
    if export_after_macro:
        script_path = scripts_dir / "run_macro_export.applescript"
        primary_cmd = [
            "osascript",
            str(script_path),
            str(host),
            macro_name,
            *(macro_params or []),
            str(out),
        ]
        fallback_cmd = _build_macro_inline_cmd(
            macro_host_pptm=host,
            macro_name=macro_name,
            macro_params=macro_params,
            output_pdf=out,
        )
    else:
        script_path = scripts_dir / "run_macro_only.applescript"
        primary_cmd = [
            "osascript",
            str(script_path),
            str(host),
            macro_name,
            *(macro_params or []),
        ]
        fallback_cmd = _build_macro_inline_cmd(
            macro_host_pptm=host,
            macro_name=macro_name,
            macro_params=macro_params,
            output_pdf=None,
        )
    _run_with_parse_fallback(runner=runner, primary_cmd=primary_cmd, fallback_cmd=fallback_cmd)

    if not out.exists() or out.stat().st_size == 0:
        raise PowerPointExportError(f"Macro run finished but output PDF missing/empty: {out}")

    return out


def run_macro_only_mac(
    macro_host_pptm: Path,
    macro_name: str,
    macro_params: list[str] | None = None,
    runner: Callable[..., object] = _default_runner,
):
    """Open a macro-enabled PowerPoint file and run a VBA macro without post-export checks."""
    host = Path(macro_host_pptm)
    if not host.exists():
        raise FileNotFoundError(f"Macro host PPTM not found: {host}")

    script_path = Path(__file__).resolve().parent / "scripts" / "run_macro_only.applescript"
    primary_cmd = [
        "osascript",
        str(script_path),
        str(host),
        macro_name,
        *(macro_params or []),
    ]
    fallback_cmd = _build_macro_inline_cmd(
        macro_host_pptm=host,
        macro_name=macro_name,
        macro_params=macro_params,
        output_pdf=None,
    )
    _run_with_parse_fallback(runner=runner, primary_cmd=primary_cmd, fallback_cmd=fallback_cmd)


# ---------------------------------------------------------------------------
# Windows implementation (win32com / COM automation)
# ---------------------------------------------------------------------------

_PP_SAVE_AS_PDF = 32
_MSO_AUTOMATION_SECURITY_LOW = 1


@contextmanager
def powerpoint_session_win() -> Generator:
    """Context manager that keeps a single PowerPoint COM process alive for batch use.

    Yields the COM Application object.  Handles CoInitialize/CoUninitialize and
    ensures the process is terminated on exit.
    """
    import pythoncom
    import win32com.client

    pythoncom.CoInitialize()
    app = None
    try:
        app = win32com.client.DispatchEx("PowerPoint.Application")
        app.Visible = False
        app.DisplayAlerts = False
        app.AutomationSecurity = _MSO_AUTOMATION_SECURITY_LOW
        yield app
    finally:
        if app is not None:
            try:
                app.Quit()
            except Exception:
                pass
            del app
        gc.collect()
        pythoncom.CoUninitialize()


def _run_macro_win(
    app,
    macro_host_pptm: Path,
    macro_name: str,
    macro_params: list[str] | None = None,
    output_pdf: Path | None = None,
    export_after_macro: bool = True,
):
    """Open a macro-enabled file in *app*, run a VBA macro, optionally export PDF."""
    host = Path(macro_host_pptm)
    if not host.exists():
        raise FileNotFoundError(f"Macro host PPTM not found: {host}")

    pptm_abs = str(host.resolve())
    pres = app.Presentations.Open(
        FileName=pptm_abs, ReadOnly=False, Untitled=False, WithWindow=False,
    )
    try:
        macro_ref = f"{pres.Name}!{macro_name}"
        params = macro_params or []
        app.Run(macro_ref, *params)

        if output_pdf is not None and export_after_macro:
            out = Path(output_pdf)
            out.parent.mkdir(parents=True, exist_ok=True)
            pres.SaveAs(str(out.resolve()), _PP_SAVE_AS_PDF)
    finally:
        try:
            pres.Close()
        except Exception:
            pass


def run_macro_export_win(
    macro_host_pptm: Path,
    macro_name: str,
    output_pdf: Path,
    macro_params: list[str] | None = None,
    export_after_macro: bool = True,
    runner: Callable[..., object] | None = None,  # accepted for API compat, ignored
):
    """Open a macro-enabled PowerPoint file, run a VBA macro, and optionally export PDF (Windows)."""
    host = Path(macro_host_pptm)
    out = Path(output_pdf)
    out.parent.mkdir(parents=True, exist_ok=True)

    with powerpoint_session_win() as app:
        _run_macro_win(
            app,
            macro_host_pptm=host,
            macro_name=macro_name,
            macro_params=macro_params,
            output_pdf=out,
            export_after_macro=export_after_macro,
        )

    if not out.exists() or out.stat().st_size == 0:
        raise PowerPointExportError(f"Macro run finished but output PDF missing/empty: {out}")

    return out


def run_macro_only_win(
    macro_host_pptm: Path,
    macro_name: str,
    macro_params: list[str] | None = None,
    runner: Callable[..., object] | None = None,  # accepted for API compat, ignored
):
    """Open a macro-enabled PowerPoint file and run a VBA macro without export (Windows)."""
    with powerpoint_session_win() as app:
        _run_macro_win(
            app,
            macro_host_pptm=macro_host_pptm,
            macro_name=macro_name,
            macro_params=macro_params,
            output_pdf=None,
            export_after_macro=False,
        )


# ---------------------------------------------------------------------------
# Platform dispatch — public API
# ---------------------------------------------------------------------------

def run_macro_export(
    macro_host_pptm: Path,
    macro_name: str,
    output_pdf: Path,
    macro_params: list[str] | None = None,
    export_after_macro: bool = True,
    runner: Callable[..., object] = _default_runner,
):
    """Platform-dispatching wrapper: macOS uses AppleScript, Windows uses win32com."""
    if sys.platform == "win32":
        return run_macro_export_win(
            macro_host_pptm, macro_name, output_pdf,
            macro_params=macro_params, export_after_macro=export_after_macro,
        )
    return run_macro_export_mac(
        macro_host_pptm, macro_name, output_pdf,
        macro_params=macro_params, export_after_macro=export_after_macro, runner=runner,
    )


def run_macro_only(
    macro_host_pptm: Path,
    macro_name: str,
    macro_params: list[str] | None = None,
    runner: Callable[..., object] = _default_runner,
):
    """Platform-dispatching wrapper: macOS uses AppleScript, Windows uses win32com."""
    if sys.platform == "win32":
        return run_macro_only_win(macro_host_pptm, macro_name, macro_params)
    return run_macro_only_mac(macro_host_pptm, macro_name, macro_params, runner=runner)
