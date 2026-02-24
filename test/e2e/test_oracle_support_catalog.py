import json
from pathlib import Path

from oracle.support_catalog import (
    load_or_init_support_catalog,
    merge_case_results_into_catalog,
    select_case_names_by_scope,
)


def test_load_or_init_support_catalog_marks_missing_cases_as_unknown(tmp_path: Path):
    cases_dir = tmp_path / "cases"
    cases_dir.mkdir()
    (cases_dir / "case-a.json").write_text("{}", encoding="utf-8")
    (cases_dir / "case-b.json").write_text("{}", encoding="utf-8")

    catalog_path = tmp_path / "support-catalog.json"
    catalog_path.write_text(
        json.dumps({"cases": {"case-a": {"status": "supported"}}}),
        encoding="utf-8",
    )

    catalog = load_or_init_support_catalog(catalog_path=catalog_path, cases_dir=cases_dir)

    assert catalog["cases"]["case-a"]["status"] == "supported"
    assert catalog["cases"]["case-b"]["status"] == "unknown"


def test_select_case_names_by_scope_prefers_non_supported():
    catalog = {
        "cases": {
            "case-a": {"status": "supported"},
            "case-b": {"status": "unsupported"},
            "case-c": {"status": "unknown"},
        }
    }

    assert select_case_names_by_scope(catalog, scope="unsupported") == {"case-b", "case-c"}
    assert select_case_names_by_scope(catalog, scope="all") == {"case-a", "case-b", "case-c"}


def test_merge_case_results_into_catalog_updates_statuses():
    catalog = {
        "cases": {
            "case-a": {"status": "unknown"},
            "case-b": {"status": "unknown"},
            "case-c": {"status": "supported"},
        }
    }
    results = [
        {"case": "case-a", "passed": True},
        {"case": "case-b", "passed": False},
        {"case": "case-d", "passed": False},
    ]

    merge_case_results_into_catalog(catalog, results)

    assert catalog["cases"]["case-a"]["status"] == "supported"
    assert catalog["cases"]["case-b"]["status"] == "unsupported"
    assert catalog["cases"]["case-c"]["status"] == "supported"
    assert catalog["cases"]["case-d"]["status"] == "unsupported"
