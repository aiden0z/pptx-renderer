#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

# Ensure `oracle.*` imports resolve when this script is run via file path.
E2E_DIR = Path(__file__).resolve().parents[1]
if str(E2E_DIR) not in sys.path:
    sys.path.insert(0, str(E2E_DIR))

from oracle.generate_cases import generate_all_cases_resilient
from oracle.powerpoint_oracle import PowerPointExportError, run_macro_only


@dataclass
class SmartArtLayoutRow:
    id_value: str
    name_value: str


# --- Static catalogs for new element types ---

# Charts: representative XlChartType IDs covering major chart families.
# Negative IDs are legacy XlChartType constants used by PowerPoint/Excel VBA.
CHART_TYPE_CATALOG: list[tuple[int, str]] = [
    (51, "clustered-bar"),
    (57, "stacked-bar"),
    (4, "line"),
    (5, "pie"),
    (-4169, "scatter"),
    (65, "area"),
    (-4120, "xl-line-classic"),
    (80, "radar"),
    (-4102, "doughnut"),
    (109, "bubble"),
    (88, "stock-hlc"),
    (73, "surface-3d"),
    (112, "treemap"),
    (116, "sunburst"),
]

# Tables: (rows, cols, slug)
TABLE_CONFIGS: list[tuple[int, int, str]] = [
    (3, 3, "3x3"),
    (4, 5, "4x5"),
    (2, 6, "2x6"),
    (6, 2, "6x2"),
    (1, 4, "1x4-header"),
    (5, 1, "5x1-col"),
    (8, 8, "8x8-large"),
]

# Connectors: (msoConnectorType, slug, beginX, beginY, endX, endY)
CONNECTOR_CONFIGS: list[tuple[int, str, float, float, float, float]] = [
    (1, "straight-h", 100, 200, 500, 200),
    (1, "straight-diag", 100, 100, 500, 400),
    (2, "elbow-h", 100, 200, 500, 200),
    (2, "elbow-v", 300, 100, 300, 400),
    (3, "curve-h", 100, 200, 500, 200),
    (3, "curve-diag", 100, 100, 500, 400),
]

# Fill/Stroke: (fillKind, strokeKind)
FILLSTROKE_CONFIGS: list[tuple[str, str]] = [
    ("solid-red", "solid-thin"),
    ("solid-blue", "solid-thick"),
    ("gradient-linear", "solid-thin"),
    ("gradient-radial", "dash"),
    ("pattern-cross", "dot"),
    ("no-fill", "solid-thin"),
    ("solid-red", "no-line"),
    ("solid-red", "dash-dot"),
    ("gradient-linear", "no-line"),
    ("no-fill", "dash"),
]


def _probe_valid_shape_ids(
    macro_host: Path,
    runtime_dir: Path,
    shape_id_min: int,
    shape_id_max: int,
) -> dict[int, str]:
    """Call VBA ProbeValidShapeIds to discover which MsoAutoShapeType IDs are valid.

    Runs in a single PowerPoint session — fast even for 500 IDs.
    Returns a dict mapping valid numeric ID → shape name (e.g. {1: "Rectangle"}).
    VBA outputs lines as "ID|ShapeName" (new format) or plain "ID" (legacy).
    """
    runtime_dir.mkdir(parents=True, exist_ok=True)
    probe_output = runtime_dir / "_valid-shape-ids.txt"

    print(f"Probing valid shape IDs {shape_id_min}-{shape_id_max} via PowerPoint ...")
    run_macro_only(
        macro_host_pptm=macro_host,
        macro_name="ProbeValidShapeIds",
        macro_params=[str(probe_output), str(shape_id_min), str(shape_id_max)],
    )

    valid: dict[int, str] = {}
    if probe_output.exists():
        for line in probe_output.read_text(encoding="utf-8").splitlines():
            text = line.strip()
            if not text:
                continue
            if "|" in text:
                id_str, _, name = text.partition("|")
                id_str = id_str.strip()
                name = name.strip()
                if id_str.isdigit():
                    valid[int(id_str)] = name
            elif text.isdigit():
                # Legacy format: plain ID without name
                valid[int(text)] = ""
    print(f"  Found {len(valid)} valid IDs out of {shape_id_max - shape_id_min + 1}")
    return valid


def _slugify(value: str, *, default: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or default


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _shape_case_payload(case_name: str, shape_type_id: int) -> dict:
    return {
        "name": case_name,
        "slides": [
            {
                "nodes": [
                    {
                        "kind": "shape",
                        "shapeTypeId": shape_type_id,
                        "left": 120,
                        "top": 80,
                        "width": 400,
                        "height": 280,
                    }
                ]
            }
        ],
    }


def _smartart_case_payload(case_name: str, layout_key: str) -> dict:
    return {
        "name": case_name,
        "slides": [
            {
                "nodes": [
                    {
                        "kind": "smartart",
                        "layout": layout_key,
                        "left": 80,
                        "top": 80,
                        "width": 520,
                        "height": 300,
                    }
                ]
            }
        ],
    }


def _chart_case_payload(case_name: str, chart_type_id: int) -> dict:
    return {
        "name": case_name,
        "slides": [
            {
                "nodes": [
                    {
                        "kind": "chart",
                        "chartTypeId": chart_type_id,
                        "left": 80,
                        "top": 60,
                        "width": 480,
                        "height": 320,
                    }
                ]
            }
        ],
    }


def _table_case_payload(case_name: str, rows: int, cols: int) -> dict:
    return {
        "name": case_name,
        "slides": [
            {
                "nodes": [
                    {
                        "kind": "table",
                        "rows": rows,
                        "cols": cols,
                        "left": 60,
                        "top": 60,
                        "width": 520,
                        "height": 320,
                    }
                ]
            }
        ],
    }


def _connector_case_payload(
    case_name: str,
    connector_type: int,
    begin_x: float,
    begin_y: float,
    end_x: float,
    end_y: float,
) -> dict:
    return {
        "name": case_name,
        "slides": [
            {
                "nodes": [
                    {
                        "kind": "connector",
                        "connectorType": connector_type,
                        "beginX": begin_x,
                        "beginY": begin_y,
                        "endX": end_x,
                        "endY": end_y,
                    }
                ]
            }
        ],
    }


def _fillstroke_case_payload(case_name: str, fill_kind: str, stroke_kind: str) -> dict:
    return {
        "name": case_name,
        "slides": [
            {
                "nodes": [
                    {
                        "kind": "fillstroke",
                        "fillKind": fill_kind,
                        "strokeKind": stroke_kind,
                        "left": 120,
                        "top": 80,
                        "width": 400,
                        "height": 280,
                    }
                ]
            }
        ],
    }


def _export_smartart_layouts(macro_host: Path, catalog_path: Path) -> list[SmartArtLayoutRow]:
    catalog_path.parent.mkdir(parents=True, exist_ok=True)
    run_macro_only(
        macro_host_pptm=macro_host,
        macro_name="ExportSmartArtLayouts_ToFile",
        macro_params=[str(catalog_path)],
    )

    rows: list[SmartArtLayoutRow] = []
    for line in catalog_path.read_text(encoding="utf-8").splitlines():
        text = line.strip()
        if not text:
            continue
        id_value, sep, name_value = text.partition("|")
        if sep:
            rows.append(SmartArtLayoutRow(id_value=id_value.strip(), name_value=name_value.strip()))
        else:
            rows.append(SmartArtLayoutRow(id_value=text, name_value=text))
    return rows


def _build_case_set(
    *,
    cases_dir: Path,
    include_shapes: bool,
    shape_id_min: int,
    shape_id_max: int,
    valid_shape_ids: dict[int, str] | None,
    include_smartart: bool,
    smartart_rows: list[SmartArtLayoutRow],
    include_charts: bool = False,
    include_tables: bool = False,
    include_connectors: bool = False,
    include_fillstroke: bool = False,
) -> dict[str, int]:
    cases_dir.mkdir(parents=True, exist_ok=True)
    shape_case_count = 0
    shape_skipped_invalid = 0
    smartart_case_count = 0
    chart_case_count = 0
    table_case_count = 0
    connector_case_count = 0
    fillstroke_case_count = 0

    if include_shapes:
        for shape_id in range(shape_id_min, shape_id_max + 1):
            old_case_name = f"oracle-full-shapeid-{shape_id:04d}"

            # Skip IDs that PowerPoint cannot create
            if valid_shape_ids is not None and shape_id not in valid_shape_ids:
                # Remove stale case JSONs for invalid IDs (both old and new format)
                for p in cases_dir.glob(f"oracle-full-shapeid-{shape_id:04d}*.json"):
                    p.unlink()
                shape_skipped_invalid += 1
                continue

            # Build case name with shape name slug (like SmartArt)
            shape_name = (valid_shape_ids or {}).get(shape_id, "")
            if shape_name:
                slug = _slugify(shape_name, default="shape")
                case_name = f"oracle-full-shapeid-{shape_id:04d}-{slug}"
            else:
                case_name = old_case_name

            case_path = cases_dir / f"{case_name}.json"

            # Clean up old-format JSON if we now have a named version
            if case_name != old_case_name:
                old_path = cases_dir / f"{old_case_name}.json"
                if old_path.exists():
                    old_path.unlink()

            payload = _shape_case_payload(case_name, shape_id)
            _write_json(case_path, payload)
            shape_case_count += 1

    if include_smartart:
        for idx, row in enumerate(smartart_rows, start=1):
            layout_key = row.id_value or row.name_value
            base = row.name_value or row.id_value or f"layout-{idx}"
            slug = _slugify(base, default=f"layout-{idx}")
            case_name = f"oracle-full-smartart-{idx:04d}-{slug}"
            payload = _smartart_case_payload(case_name, layout_key)
            _write_json(cases_dir / f"{case_name}.json", payload)
            smartart_case_count += 1

    if include_charts:
        for idx, (chart_type_id, slug) in enumerate(CHART_TYPE_CATALOG, start=1):
            case_name = f"oracle-full-chart-{idx:04d}-{slug}"
            payload = _chart_case_payload(case_name, chart_type_id)
            _write_json(cases_dir / f"{case_name}.json", payload)
            chart_case_count += 1

    if include_tables:
        for idx, (rows, cols, slug) in enumerate(TABLE_CONFIGS, start=1):
            case_name = f"oracle-full-table-{idx:04d}-{slug}"
            payload = _table_case_payload(case_name, rows, cols)
            _write_json(cases_dir / f"{case_name}.json", payload)
            table_case_count += 1

    if include_connectors:
        for idx, (conn_type, slug, bx, by, ex, ey) in enumerate(CONNECTOR_CONFIGS, start=1):
            case_name = f"oracle-full-connector-{idx:04d}-{slug}"
            payload = _connector_case_payload(case_name, conn_type, bx, by, ex, ey)
            _write_json(cases_dir / f"{case_name}.json", payload)
            connector_case_count += 1

    if include_fillstroke:
        for idx, (fill_kind, stroke_kind) in enumerate(FILLSTROKE_CONFIGS, start=1):
            slug = f"{fill_kind}--{stroke_kind}"
            case_name = f"oracle-full-fillstroke-{idx:04d}-{slug}"
            payload = _fillstroke_case_payload(case_name, fill_kind, stroke_kind)
            _write_json(cases_dir / f"{case_name}.json", payload)
            fillstroke_case_count += 1

    total = shape_case_count + smartart_case_count + chart_case_count + table_case_count + connector_case_count + fillstroke_case_count
    return {
        "shape_case_count": shape_case_count,
        "shape_skipped_invalid": shape_skipped_invalid,
        "smartart_case_count": smartart_case_count,
        "chart_case_count": chart_case_count,
        "table_case_count": table_case_count,
        "connector_case_count": connector_case_count,
        "fillstroke_case_count": fillstroke_case_count,
        "total_case_count": total,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="One-shot full ground truth generation for shapes + SmartArt on local PowerPoint.",
    )
    parser.add_argument(
        "--macro-host",
        type=Path,
        default=Path("testdata/pptx-macro-host.pptm"),
        help="Path to pptm macro host containing GenerateProbeDeck module.",
    )
    parser.add_argument(
        "--testdata-dir",
        type=Path,
        default=Path("testdata"),
        help="Directory to write generated pptx/pdf pairs.",
    )
    parser.add_argument(
        "--cases-dir",
        type=Path,
        default=Path("oracle/cases-full"),
        help="Directory to write generated full case JSON files.",
    )
    parser.add_argument(
        "--shape-id-min",
        type=int,
        default=1,
        help="Minimum MsoAutoShapeType numeric ID to probe.",
    )
    parser.add_argument(
        "--shape-id-max",
        type=int,
        default=500,
        help="Maximum MsoAutoShapeType numeric ID to probe.",
    )
    parser.add_argument(
        "--skip-shapes",
        action="store_true",
        help="Skip shapeTypeId probing cases.",
    )
    parser.add_argument(
        "--skip-smartart",
        action="store_true",
        help="Skip SmartArt layout probing cases.",
    )
    parser.add_argument(
        "--skip-charts",
        action="store_true",
        help="Skip chart type cases.",
    )
    parser.add_argument(
        "--skip-tables",
        action="store_true",
        help="Skip table config cases.",
    )
    parser.add_argument(
        "--skip-connectors",
        action="store_true",
        help="Skip connector cases.",
    )
    parser.add_argument(
        "--skip-fillstroke",
        action="store_true",
        help="Skip fill/stroke variant cases.",
    )
    parser.add_argument(
        "--no-reuse",
        action="store_true",
        help="Do not reuse existing pptx/pdf pairs; force regeneration.",
    )
    parser.add_argument(
        "--probe-first",
        action="store_true",
        default=True,
        help="Probe valid shape IDs via VBA before generating (default: True). "
        "Avoids slow per-case failures for invalid MsoAutoShapeType IDs.",
    )
    parser.add_argument(
        "--no-probe",
        action="store_true",
        help="Skip probe step; attempt all IDs in range (old behavior).",
    )
    parser.add_argument(
        "--report-path",
        type=Path,
        default=Path("reports/oracle-failures/full-ground-truth-one-shot.json"),
        help="Path to write generation summary report.",
    )
    parser.add_argument(
        "--export-png",
        action="store_true",
        help="Also export each slide as PNG via VBA Slide.Export (higher quality ground truth).",
    )
    parser.add_argument(
        "--png-width",
        type=int,
        default=0,
        help="PNG export width in pixels (0 = PowerPoint default 96 DPI).",
    )
    parser.add_argument(
        "--png-height",
        type=int,
        default=0,
        help="PNG export height in pixels (0 = PowerPoint default 96 DPI).",
    )

    args = parser.parse_args()

    macro_host = args.macro_host.resolve()
    if not macro_host.exists():
        raise SystemExit(f"macro host not found: {macro_host}")
    if args.shape_id_max < args.shape_id_min:
        raise SystemExit("--shape-id-max must be >= --shape-id-min")

    testdata_dir = args.testdata_dir.resolve()
    cases_dir = args.cases_dir.resolve()
    report_path = args.report_path.resolve()
    runtime_dir = testdata_dir / "oracle-runtime"
    layout_catalog_path = runtime_dir / "_smartart-layouts.txt"

    include_shapes = not args.skip_shapes
    include_smartart = not args.skip_smartart
    include_charts = not args.skip_charts
    include_tables = not args.skip_tables
    include_connectors = not args.skip_connectors
    include_fillstroke = not args.skip_fillstroke
    do_probe = args.probe_first and not args.no_probe

    # --- Phase 1: Probe valid shape IDs (single PowerPoint session, fast) ---
    valid_shape_ids: dict[int, str] | None = None
    probe_error: str | None = None
    if include_shapes and do_probe:
        try:
            valid_shape_ids = _probe_valid_shape_ids(
                macro_host, runtime_dir, args.shape_id_min, args.shape_id_max,
            )
        except (PowerPointExportError, Exception) as exc:
            probe_error = str(exc)
            print(f"  Probe failed ({probe_error}), falling back to brute-force mode")
            valid_shape_ids = None

    # --- Phase 2: Export SmartArt layout catalog ---
    smartart_rows: list[SmartArtLayoutRow] = []
    smartart_export_error: str | None = None
    if include_smartart:
        try:
            smartart_rows = _export_smartart_layouts(macro_host, layout_catalog_path)
        except PowerPointExportError as exc:
            smartart_export_error = str(exc)
            include_smartart = False

    # --- Phase 3: Build case JSONs (only for valid IDs) ---
    counts = _build_case_set(
        cases_dir=cases_dir,
        include_shapes=include_shapes,
        shape_id_min=args.shape_id_min,
        shape_id_max=args.shape_id_max,
        valid_shape_ids=valid_shape_ids,
        include_smartart=include_smartart,
        smartart_rows=smartart_rows,
        include_charts=include_charts,
        include_tables=include_tables,
        include_connectors=include_connectors,
        include_fillstroke=include_fillstroke,
    )

    # --- Phase 4: Generate PPTX/PDF pairs (reuse cache by default) ---
    generated, failures = generate_all_cases_resilient(
        macro_host=macro_host,
        cases_dir=cases_dir,
        testdata_dir=testdata_dir,
        reuse_existing=not args.no_reuse,
        export_png=args.export_png,
        png_width=args.png_width,
        png_height=args.png_height,
    )

    generated_names = sorted(path.parent.name for path in generated)
    failure_cases = sorted(failures, key=lambda row: row.get("case", ""))

    report = {
        "macro_host": str(macro_host),
        "testdata_dir": str(testdata_dir),
        "cases_dir": str(cases_dir),
        "shape_id_range": [args.shape_id_min, args.shape_id_max],
        "include_shapes": include_shapes,
        "include_smartart": include_smartart,
        "include_charts": include_charts,
        "include_tables": include_tables,
        "include_connectors": include_connectors,
        "include_fillstroke": include_fillstroke,
        "probe_enabled": do_probe,
        "probe_error": probe_error,
        "valid_shape_id_count": len(valid_shape_ids) if valid_shape_ids is not None else None,
        "valid_shape_ids": {k: v for k, v in sorted(valid_shape_ids.items())} if valid_shape_ids is not None else None,
        "smartart_layout_count": len(smartart_rows),
        "smartart_export_error": smartart_export_error,
        "reuse_existing": not args.no_reuse,
        **counts,
        "generated_count": len(generated_names),
        "failed_count": len(failure_cases),
        "generated_cases": generated_names,
        "failed_cases": failure_cases,
    }

    _write_json(report_path, report)

    print(json.dumps(report, indent=2, ensure_ascii=False))
    print(f"\nreport written: {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
