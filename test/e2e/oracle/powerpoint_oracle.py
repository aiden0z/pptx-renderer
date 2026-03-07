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
    slide_pngs: list[Path] | None = None


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

    if export_after_macro and (not out.exists() or out.stat().st_size == 0):
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
_RPC_E_CALL_REJECTED = -2147418111  # 0x80010001
_RPC_E_SERVERCALL_RETRYLATER = -2147417846  # 0x8001010A


def _com_call_with_retry(fn, *args, retries: int = 5, delay: float = 1.0, **kwargs):
    """Retry a COM call when PowerPoint is busy (RPC_E_CALL_REJECTED / RETRYLATER).

    This is the Python-side equivalent of implementing IMessageFilter.  In batch
    mode the previous Close() may still be running when the next Open() arrives,
    causing -2147418111.
    """
    import pywintypes

    for attempt in range(retries):
        try:
            return fn(*args, **kwargs)
        except pywintypes.com_error as exc:
            hr = exc.hresult if hasattr(exc, "hresult") else (exc.args[0] if exc.args else None)
            if hr in (_RPC_E_CALL_REJECTED, _RPC_E_SERVERCALL_RETRYLATER) and attempt < retries - 1:
                time.sleep(delay * (attempt + 1))
                continue
            raise


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
        try:
            app.Visible = False
        except Exception:
            # Some Windows PowerPoint builds disallow hiding the application window.
            # Fall back to minimized to keep it out of the way.
            app.Visible = True
            app.WindowState = 2  # ppWindowMinimized
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
    # WithWindow=True is required: some PowerPoint builds fail to load VBA
    # projects when opening without a window (-2147188720 "object not exist").
    pres = _com_call_with_retry(
        app.Presentations.Open,
        FileName=pptm_abs, ReadOnly=False, Untitled=False, WithWindow=True,
    )
    try:
        macro_ref = f"{pres.Name}!{macro_name}"
        params = macro_params or []
        _com_call_with_retry(app.Run, macro_ref, *params)

        if output_pdf is not None and export_after_macro:
            out = Path(output_pdf)
            out.parent.mkdir(parents=True, exist_ok=True)
            _com_call_with_retry(pres.SaveAs, str(out.resolve()), _PP_SAVE_AS_PDF)
    finally:
        try:
            # Mark as saved to suppress "Do you want to save?" dialog.
            pres.Saved = True
            pres.Close()
        except Exception:
            pass
        # Brief pause to let PowerPoint finish releasing resources before the
        # next Open() call in batch mode.
        time.sleep(0.3)


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

    if export_after_macro and (not out.exists() or out.stat().st_size == 0):
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


def export_pptx_to_pdf_win(
    pptx_path: Path,
    pdf_path: Path,
    retries: int = 2,
    backoff_sec: float = 1.0,
) -> ExportResult:
    """Open an existing PPTX and export to PDF via COM — no VBA macro needed."""
    src = Path(pptx_path).resolve()
    out = Path(pdf_path).resolve()
    if not src.exists():
        raise FileNotFoundError(f"PPTX not found: {src}")
    out.parent.mkdir(parents=True, exist_ok=True)

    last_error: Exception | None = None
    for attempt in range(1, retries + 2):
        try:
            with powerpoint_session_win() as app:
                pres = _com_call_with_retry(
                    app.Presentations.Open,
                    FileName=str(src), ReadOnly=True, Untitled=False, WithWindow=True,
                )
                try:
                    _com_call_with_retry(pres.SaveAs, str(out), _PP_SAVE_AS_PDF)
                finally:
                    try:
                        pres.Saved = True
                        pres.Close()
                    except Exception:
                        pass
                    time.sleep(0.3)
            if not out.exists() or out.stat().st_size == 0:
                raise PowerPointExportError(f"PowerPoint reported success but PDF missing/empty: {out}")
            return ExportResult(output_pdf=out, attempts=attempt)
        except Exception as exc:
            last_error = exc
            if attempt > retries:
                break
            if backoff_sec > 0:
                time.sleep(backoff_sec)

    raise PowerPointExportError(
        f"Failed to export {src} -> {out} after {retries + 1} attempt(s): {last_error}"
    )


def export_pptx_ground_truth_win(
    pptx_path: Path,
    pdf_path: Path,
    slides_png_dir: Path | None = None,
    png_width: int = 0,
    png_height: int = 0,
    retries: int = 2,
    backoff_sec: float = 1.0,
) -> ExportResult:
    """Open an existing PPTX, export PDF + optional slide PNGs in one COM session."""
    src = Path(pptx_path).resolve()
    out = Path(pdf_path).resolve()
    if not src.exists():
        raise FileNotFoundError(f"PPTX not found: {src}")
    out.parent.mkdir(parents=True, exist_ok=True)
    if slides_png_dir is not None:
        Path(slides_png_dir).mkdir(parents=True, exist_ok=True)

    last_error: Exception | None = None
    for attempt in range(1, retries + 2):
        try:
            slide_pngs: list[Path] = []
            with powerpoint_session_win() as app:
                pres = _com_call_with_retry(
                    app.Presentations.Open,
                    FileName=str(src), ReadOnly=True, Untitled=False, WithWindow=True,
                )
                try:
                    _com_call_with_retry(pres.SaveAs, str(out), _PP_SAVE_AS_PDF)

                    if slides_png_dir is not None:
                        png_dir = Path(slides_png_dir).resolve()
                        for i in range(1, pres.Slides.Count + 1):
                            png_path = png_dir / f"slide{i}.png"
                            export_args = [str(png_path), "PNG"]
                            if png_width > 0:
                                export_args.append(png_width)
                            if png_height > 0:
                                export_args.append(png_height)
                            _com_call_with_retry(pres.Slides(i).Export, *export_args)
                            slide_pngs.append(png_path)
                finally:
                    try:
                        pres.Saved = True
                        pres.Close()
                    except Exception:
                        pass
                    time.sleep(0.3)
            if not out.exists() or out.stat().st_size == 0:
                raise PowerPointExportError(f"PowerPoint reported success but PDF missing/empty: {out}")
            return ExportResult(output_pdf=out, attempts=attempt, slide_pngs=slide_pngs or None)
        except Exception as exc:
            last_error = exc
            if attempt > retries:
                break
            if backoff_sec > 0:
                time.sleep(backoff_sec)

    raise PowerPointExportError(
        f"Failed to export {src} -> {out} after {retries + 1} attempt(s): {last_error}"
    )


@contextmanager
def powerpoint_batch_session_win() -> Generator:
    """Context manager yielding a session object with ``run_export()`` and ``run_only()``
    methods that share a single PowerPoint COM process for batch use on Windows.

    Using one COM session avoids restarting PowerPoint for every case (hundreds of
    times for full oracle generation).
    """
    with powerpoint_session_win() as app:
        class _Session:
            def run_export(
                self,
                *,
                macro_host_pptm: Path,
                macro_name: str,
                output_pdf: Path,
                macro_params: list[str] | None = None,
                export_after_macro: bool = True,
            ):
                _run_macro_win(
                    app,
                    macro_host_pptm=macro_host_pptm,
                    macro_name=macro_name,
                    macro_params=macro_params,
                    output_pdf=output_pdf,
                    export_after_macro=export_after_macro,
                )
                if export_after_macro and output_pdf is not None:
                    out = Path(output_pdf)
                    if not out.exists() or out.stat().st_size == 0:
                        raise PowerPointExportError(
                            f"Macro run finished but output PDF missing/empty: {out}"
                        )

            def run_only(
                self,
                *,
                macro_host_pptm: Path,
                macro_name: str,
                macro_params: list[str] | None = None,
            ):
                _run_macro_win(
                    app,
                    macro_host_pptm=macro_host_pptm,
                    macro_name=macro_name,
                    macro_params=macro_params,
                    output_pdf=None,
                    export_after_macro=False,
                )

        yield _Session()


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


def export_pptx_to_pdf(
    pptx_path: Path,
    pdf_path: Path,
    retries: int = 2,
    backoff_sec: float = 1.0,
) -> ExportResult:
    """Platform-dispatching wrapper: open existing PPTX and export to PDF."""
    if sys.platform == "win32":
        return export_pptx_to_pdf_win(pptx_path, pdf_path, retries=retries, backoff_sec=backoff_sec)
    return export_pptx_to_pdf_mac(pptx_path, pdf_path, retries=retries, backoff_sec=backoff_sec)


def export_pptx_ground_truth(
    pptx_path: Path,
    pdf_path: Path,
    slides_png_dir: Path | None = None,
    png_width: int = 0,
    png_height: int = 0,
    retries: int = 2,
    backoff_sec: float = 1.0,
) -> ExportResult:
    """Platform-dispatching wrapper: export PDF + optional slide PNGs.

    On macOS, falls back to PDF-only export (PNG not supported via AppleScript).
    """
    if sys.platform == "win32":
        return export_pptx_ground_truth_win(
            pptx_path, pdf_path,
            slides_png_dir=slides_png_dir,
            png_width=png_width, png_height=png_height,
            retries=retries, backoff_sec=backoff_sec,
        )
    # macOS: PDF only (Slide.Export not available via AppleScript)
    return export_pptx_to_pdf_mac(pptx_path, pdf_path, retries=retries, backoff_sec=backoff_sec)
