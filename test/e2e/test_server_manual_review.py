import json
from pathlib import Path

from fastapi.testclient import TestClient

import server


def test_manual_review_api_persists_and_updates_support_catalog(tmp_path: Path, monkeypatch):
    reports_root = tmp_path / "reports"
    oracle_reports = reports_root / "oracle-failures"
    cases_dir = tmp_path / "cases"
    cases_dir.mkdir(parents=True, exist_ok=True)
    (cases_dir / "oracle-shape-rectangle.json").write_text("{}", encoding="utf-8")

    manual_review_path = oracle_reports / "manual-review.json"
    support_catalog_path = oracle_reports / "support-catalog.json"

    monkeypatch.setattr(server, "REPORTS_DIR", reports_root)
    monkeypatch.setattr(server, "ORACLE_REPORTS_DIR", oracle_reports)
    monkeypatch.setattr(server, "MANUAL_REVIEW_PATH", manual_review_path)
    monkeypatch.setattr(server, "SUPPORT_CATALOG_PATH", support_catalog_path)
    monkeypatch.setattr(server, "ORACLE_CASES_DIR", cases_dir)

    client = TestClient(server.app)
    payload = {
        "test_file": "oracle-shape-rectangle",
        "slide_idx": 0,
        "verdict": "supported",
        "note": "geometry matches ground truth",
    }
    resp = client.post("/api/manual-review", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["entry"]["verdict"] == "supported"

    stored = json.loads(manual_review_path.read_text(encoding="utf-8"))
    key = "oracle-shape-rectangle#0"
    assert stored["entries"][key]["verdict"] == "supported"

    catalog = json.loads(support_catalog_path.read_text(encoding="utf-8"))
    assert catalog["cases"]["oracle-shape-rectangle"]["status"] == "supported"


def test_manual_review_api_lists_entries_for_file(tmp_path: Path, monkeypatch):
    reports_root = tmp_path / "reports"
    oracle_reports = reports_root / "oracle-failures"
    manual_review_path = oracle_reports / "manual-review.json"
    manual_review_path.parent.mkdir(parents=True, exist_ok=True)
    manual_review_path.write_text(
        json.dumps(
            {
                "entries": {
                    "oracle-shape-rectangle#0": {"test_file": "oracle-shape-rectangle", "slide_idx": 0, "verdict": "supported"},
                    "oracle-shape-rectangle#1": {"test_file": "oracle-shape-rectangle", "slide_idx": 1, "verdict": "unsupported"},
                    "oracle-shape-heart#0": {"test_file": "oracle-shape-heart", "slide_idx": 0, "verdict": "supported"},
                }
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(server, "REPORTS_DIR", reports_root)
    monkeypatch.setattr(server, "ORACLE_REPORTS_DIR", oracle_reports)
    monkeypatch.setattr(server, "MANUAL_REVIEW_PATH", manual_review_path)

    client = TestClient(server.app)
    resp = client.get("/api/manual-review/oracle-shape-rectangle")
    assert resp.status_code == 200
    rows = resp.json()["entries"]
    assert len(rows) == 2
    assert {r["slide_idx"] for r in rows} == {0, 1}


def test_manual_review_api_returns_detailed_500(tmp_path: Path, monkeypatch):
    reports_root = tmp_path / "reports"
    oracle_reports = reports_root / "oracle-failures"
    manual_review_path = oracle_reports / "manual-review.json"
    support_catalog_path = oracle_reports / "support-catalog.json"
    cases_dir = tmp_path / "cases"
    cases_dir.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(server, "REPORTS_DIR", reports_root)
    monkeypatch.setattr(server, "ORACLE_REPORTS_DIR", oracle_reports)
    monkeypatch.setattr(server, "MANUAL_REVIEW_PATH", manual_review_path)
    monkeypatch.setattr(server, "SUPPORT_CATALOG_PATH", support_catalog_path)
    monkeypatch.setattr(server, "ORACLE_CASES_DIR", cases_dir)

    def boom(_store):
        raise RuntimeError("disk write failed")

    monkeypatch.setattr(server, "_save_manual_review_store", boom)

    client = TestClient(server.app)
    resp = client.post(
        "/api/manual-review",
        json={
            "test_file": "oracle-shape-rectangle",
            "slide_idx": 0,
            "verdict": "supported",
            "note": "",
        },
    )
    assert resp.status_code == 500
    assert "manual review save failed" in resp.json()["detail"]
    assert "disk write failed" in resp.json()["detail"]
