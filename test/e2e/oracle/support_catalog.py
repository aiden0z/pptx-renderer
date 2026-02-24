from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SUPPORTED_STATUS = "supported"
UNSUPPORTED_STATUS = "unsupported"
UNKNOWN_STATUS = "unknown"
ALLOWED_STATUSES = {SUPPORTED_STATUS, UNSUPPORTED_STATUS, UNKNOWN_STATUS}


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def load_or_init_support_catalog(catalog_path: Path, cases_dir: Path) -> dict[str, Any]:
    catalog_path = Path(catalog_path)
    cases_dir = Path(cases_dir)

    if catalog_path.exists():
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    else:
        catalog = {"version": 1, "cases": {}}

    cases = catalog.setdefault("cases", {})

    for case_json in sorted(cases_dir.glob("*.json")):
        entry = cases.setdefault(case_json.stem, {})
        status = str(entry.get("status", UNKNOWN_STATUS)).lower().strip()
        if status not in ALLOWED_STATUSES:
            status = UNKNOWN_STATUS
        entry["status"] = status

    catalog["updated_at"] = _utc_now_iso()
    return catalog


def save_support_catalog(catalog_path: Path, catalog: dict[str, Any]) -> Path:
    out = Path(catalog_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    catalog = dict(catalog)
    catalog["updated_at"] = _utc_now_iso()
    out.write_text(json.dumps(catalog, indent=2, ensure_ascii=False), encoding="utf-8")
    return out


def select_case_names_by_scope(catalog: dict[str, Any], scope: str) -> set[str]:
    scope_key = str(scope).lower().strip()
    cases = catalog.get("cases", {})
    selected: set[str] = set()

    for name, meta in cases.items():
        status = str((meta or {}).get("status", UNKNOWN_STATUS)).lower().strip()
        if status not in ALLOWED_STATUSES:
            status = UNKNOWN_STATUS

        if scope_key == "all":
            selected.add(name)
        elif scope_key == "unsupported":
            if status != SUPPORTED_STATUS:
                selected.add(name)
        elif scope_key == "unknown":
            if status == UNKNOWN_STATUS:
                selected.add(name)
        else:
            raise ValueError(f"unsupported scope: {scope}")

    return selected


def merge_case_results_into_catalog(catalog: dict[str, Any], case_results: list[dict[str, Any]]) -> None:
    cases = catalog.setdefault("cases", {})
    for row in case_results:
        name = str(row.get("case", "")).strip()
        if not name:
            continue
        passed = bool(row.get("passed"))
        status = SUPPORTED_STATUS if passed else UNSUPPORTED_STATUS
        entry = cases.setdefault(name, {})
        entry["status"] = status
        entry["last_run_passed"] = passed
        reasons = row.get("reasons") or []
        if isinstance(reasons, list):
            entry["last_reasons"] = [str(x) for x in reasons]
        entry["last_seen_at"] = _utc_now_iso()
