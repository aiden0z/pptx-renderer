import sys
from pathlib import Path

import pytest

from oracle.powerpoint_oracle import run_macro_export_mac

pytestmark = pytest.mark.skipif(
    sys.platform == "win32",
    reason="AppleScript-based tests are macOS-only",
)


def test_macro_oracle_smoke(oracle_runtime_dir: Path, oracle_macro_host: Path | None, oracle_macro_name: str):
    if oracle_macro_host is None:
        pytest.skip("Set --oracle-macro-host or PPTX_ORACLE_MACRO_HOST to run macro oracle smoke test")
    if not oracle_macro_host.exists():
        pytest.skip(f"Macro host not found: {oracle_macro_host}")

    output_pdf = oracle_runtime_dir / "oracle-smoke.pdf"
    out = run_macro_export_mac(
        macro_host_pptm=oracle_macro_host,
        macro_name=oracle_macro_name,
        output_pdf=output_pdf,
    )

    assert out.exists()
    assert out.stat().st_size > 0
    assert out.read_bytes().startswith(b"%PDF")
