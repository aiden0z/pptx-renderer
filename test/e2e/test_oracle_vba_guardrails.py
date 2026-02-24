from pathlib import Path


def test_vba_module_has_guardrails_for_strict_oracle_generation():
    src = (Path(__file__).resolve().parent / "oracle" / "vba" / "GenerateProbeDeck.bas").read_text(encoding="utf-8")

    # Unknown shape tokens must fail loudly, not silently fallback.
    assert "Case Else: Err.Raise 5" in src

    # Parser macro should always clean up resources on error.
    assert "On Error GoTo CleanFail" in src
    assert "CleanFail:" in src
    assert "CleanExit:" in src
    assert "If fileOpen Then Close #fnum" in src

    # SmartArt resolution should avoid broad substring matching.
    assert "InStr(1, idVal, keyCompact" not in src
    assert "InStr(1, nameVal, keyCompact" not in src

    # Numeric SHAPE ids should be range-checked and include spec context in errors.
    assert "SHAPE type id out of range" in src
    assert "Failed to add shape from line:" in src
