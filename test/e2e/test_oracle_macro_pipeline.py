import sys
from pathlib import Path

import pytest

from oracle.powerpoint_oracle import run_macro_only_mac

pytestmark = pytest.mark.skipif(
    sys.platform == "win32",
    reason="AppleScript-based tests are macOS-only",
)


def test_macro_oracle_smoke(oracle_runtime_dir: Path, oracle_macro_host: Path | None, oracle_macro_name: str):
    if oracle_macro_host is None:
        pytest.skip("Set --oracle-macro-host or PPTX_ORACLE_MACRO_HOST to run macro oracle smoke test")
    if not oracle_macro_host.exists():
        pytest.skip(f"Macro host not found: {oracle_macro_host}")

    output_catalog = oracle_runtime_dir / "_macro-smoke-layouts.txt"
    output_catalog.unlink(missing_ok=True)
    run_macro_only_mac(
        macro_host_pptm=oracle_macro_host,
        macro_name=oracle_macro_name,
        macro_params=[str(output_catalog)],
    )

    assert output_catalog.exists()
    rows = [line for line in output_catalog.read_text(encoding="utf-8").splitlines() if line]
    assert rows
    assert all("|" in row for row in rows)
