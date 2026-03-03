#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

# Ensure `oracle.*` imports resolve when this script is run via file path.
E2E_DIR = Path(__file__).resolve().parents[1]
if str(E2E_DIR) not in sys.path:
    sys.path.insert(0, str(E2E_DIR))

import platform

from oracle.generate_cases import generate_all_cases_resilient
from oracle.powerpoint_oracle import PowerPointExportError, run_macro_only


@dataclass
class SmartArtLayoutRow:
    id_value: str
    name_value: str


# --- Static catalogs for new element types ---

# Complete XlChartType fallback catalog: ID → slug name.
# Used on macOS (where chart VBA probe can't run) and as fallback on probe failure.
# Source: https://learn.microsoft.com/en-us/office/vba/api/excel.xlcharttype
CHART_TYPE_FALLBACK: dict[int, str] = {
    # Column / Bar
    51: "clustered-column",
    52: "stacked-column",
    53: "100-stacked-column",
    54: "3d-clustered-column",
    55: "3d-stacked-column",
    56: "3d-100-stacked-column",
    57: "clustered-bar",
    58: "stacked-bar",
    59: "100-stacked-bar",
    60: "3d-clustered-bar",
    61: "3d-stacked-bar",
    62: "3d-100-stacked-bar",
    -4100: "3d-column",
    # Line
    4: "line",
    63: "stacked-line",
    64: "100-stacked-line",
    65: "line-with-markers",
    66: "stacked-line-with-markers",
    67: "100-stacked-line-with-markers",
    -4101: "3d-line",
    -4120: "xl-line-classic",
    # Pie
    5: "pie",
    68: "pie-of-pie",
    69: "exploded-pie",
    70: "3d-pie",
    71: "3d-exploded-pie",
    -4102: "doughnut",
    80: "exploded-doughnut",
    # Area
    1: "area",
    76: "stacked-area",
    77: "100-stacked-area",
    78: "3d-area",
    79: "3d-stacked-area",
    -4098: "3d-100-stacked-area",
    # Scatter
    -4169: "scatter",
    72: "scatter-with-lines",
    73: "scatter-with-lines-no-markers",
    74: "scatter-with-smooth-lines",
    75: "scatter-with-smooth-lines-no-markers",
    # Radar
    -4151: "radar",
    81: "radar-with-markers",
    82: "filled-radar",
    # Bubble
    15: "bubble",
    87: "bubble-3d",
    # Stock
    88: "stock-hlc",
    89: "stock-ohlc",
    90: "stock-vhlc",
    91: "stock-vohlc",
    # Surface
    83: "surface-3d",
    84: "surface-wireframe-3d",
    85: "surface-contour",
    86: "surface-wireframe-contour",
    -4163: "surface-top-view",
    # Cone
    92: "cone-clustered-column",
    93: "cone-stacked-column",
    94: "cone-100-stacked-column",
    95: "cone-clustered-bar",
    96: "cone-stacked-bar",
    97: "cone-100-stacked-bar",
    98: "cone-3d-column",
    # Cylinder
    99: "cylinder-clustered-column",
    100: "cylinder-stacked-column",
    101: "cylinder-100-stacked-column",
    102: "cylinder-clustered-bar",
    103: "cylinder-stacked-bar",
    104: "cylinder-100-stacked-bar",
    105: "cylinder-3d-column",
    # Pyramid
    106: "pyramid-clustered-column",
    107: "pyramid-stacked-column",
    108: "pyramid-100-stacked-column",
    109: "pyramid-clustered-bar",
    110: "pyramid-stacked-bar",
    111: "pyramid-100-stacked-bar",
    112: "pyramid-3d-column",
    # Combo
    113: "combo-column-line",
    114: "combo-column-line-secondary-axis",
    115: "combo-stacked-area-column",
    -4152: "combo-custom",
    # Modern (Office 2016+)
    116: "treemap",
    117: "sunburst",
    118: "histogram",
    119: "pareto",
    120: "box-and-whisker",
    121: "waterfall",
    122: "funnel",
    123: "map",
    140: "region-map",
    # Microsoft 365 exclusive types
    124: "ex-linked-treemap",
    125: "ex-linked-sunburst",
    126: "ex-linked-histogram",
    127: "ex-linked-pareto",
    128: "ex-linked-box-whisker",
    129: "ex-linked-waterfall",
    130: "ex-linked-funnel",
    131: "ex-linked-map",
    132: "ex-linked-scatter",
    133: "ex-linked-line",
    134: "ex-linked-area",
    135: "ex-linked-bar",
    136: "ex-linked-column",
    137: "ex-linked-pie",
    138: "ex-linked-surface",
    139: "ex-linked-radar",
}

# Tables: (rows, cols, slug)
TABLE_CONFIGS: list[tuple[int, int, str]] = [
    (3, 3, "3x3"),
    (4, 5, "4x5"),
    (2, 6, "2x6"),
    (6, 2, "6x2"),
    (1, 4, "1x4-header"),
    (5, 1, "5x1-col"),
    (8, 8, "8x8-large"),
    (1, 1, "1x1"),
    (2, 2, "2x2"),
    (10, 3, "10x3"),
    (3, 10, "3x10"),
    (1, 10, "1x10"),
    (10, 1, "10x1"),
    (1, 2, "1x2"),
    (2, 1, "2x1"),
]

# Connectors: (msoConnectorType, slug, beginX, beginY, endX, endY)
CONNECTOR_CONFIGS: list[tuple[int, str, float, float, float, float]] = [
    (1, "straight-h", 100, 200, 500, 200),
    (1, "straight-diag", 100, 100, 500, 400),
    (2, "elbow-h", 100, 200, 500, 200),
    (2, "elbow-v", 300, 100, 300, 400),
    (3, "curve-h", 100, 200, 500, 200),
    (3, "curve-diag", 100, 100, 500, 400),
    (1, "straight-v", 300, 100, 300, 400),
    (2, "elbow-diag", 100, 100, 500, 400),
    (3, "curve-v", 300, 100, 300, 400),
]

# Fill/Stroke: (fillKind, strokeKind)
# First 10 entries preserved for backward compat (0001-0010 case names unchanged).
FILLSTROKE_CONFIGS: list[tuple[str, str]] = [
    # --- Original 10 ---
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
    # --- New solids × strokes ---
    ("solid-green", "solid-thin"),
    ("solid-green", "solid-thick"),
    ("solid-yellow", "solid-thin"),
    ("solid-yellow", "dash"),
    ("solid-black", "solid-thin"),
    ("solid-black", "solid-red-thin"),
    ("solid-white", "solid-thick"),
    ("solid-white", "solid-blue-thick"),
    # --- New gradients × strokes ---
    ("gradient-diagonal", "solid-thin"),
    ("gradient-diagonal", "dash"),
    ("gradient-diagonal", "no-line"),
    ("gradient-vertical", "solid-thin"),
    ("gradient-vertical", "solid-thick"),
    ("gradient-vertical", "round-dot"),
    # --- New patterns × strokes ---
    ("pattern-horizontal", "solid-thin"),
    ("pattern-horizontal", "dash"),
    ("pattern-diagonal-up", "solid-thin"),
    ("pattern-diagonal-up", "long-dash"),
    ("pattern-dots", "solid-thin"),
    ("pattern-dots", "square-dot"),
    ("pattern-checker", "solid-thin"),
    ("pattern-checker", "long-dash-dot"),
    # --- Color strokes ---
    ("solid-red", "solid-red-thin"),
    ("solid-blue", "solid-blue-thick"),
    # --- No-fill × new strokes ---
    ("no-fill", "round-dot"),
    ("no-fill", "solid-medium"),
]


def _probe_valid_shape_ids(
    macro_host: Path,
    runtime_dir: Path,
    shape_id_min: int,
    shape_id_max: int,
    run_only_fn: Callable[..., object] | None = None,
) -> dict[int, str]:
    """Call VBA ProbeValidShapeIds to discover which MsoAutoShapeType IDs are valid.

    Runs in a single PowerPoint session — fast even for 500 IDs.
    Returns a dict mapping valid numeric ID → shape name (e.g. {1: "Rectangle"}).
    VBA outputs lines as "ID|ShapeName" (new format) or plain "ID" (legacy).

    If *run_only_fn* is provided it is called instead of the default
    ``run_macro_only`` — used on Windows to share a batch COM session.
    """
    runtime_dir.mkdir(parents=True, exist_ok=True)
    probe_output = runtime_dir / "_valid-shape-ids.txt"

    print(f"Probing valid shape IDs {shape_id_min}-{shape_id_max} via PowerPoint ...")
    _run = run_only_fn or run_macro_only
    _run(
        macro_host_pptm=macro_host,
        macro_name="ProbeValidShapeIds",
        macro_params=[str(probe_output), str(shape_id_min), str(shape_id_max)],
    )

    valid: dict[int, str] = {}
    if probe_output.exists():
        for line in probe_output.read_text(encoding="utf-8", errors="replace").splitlines():
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


def _probe_valid_chart_types(
    macro_host: Path,
    runtime_dir: Path,
    chart_id_min: int,
    chart_id_max: int,
    run_only_fn: Callable[..., object] | None = None,
) -> dict[int, str]:
    """Call VBA ProbeValidChartTypes to discover which XlChartType IDs are valid.

    On macOS, returns the static CHART_TYPE_FALLBACK immediately (Excel engine
    is unavailable so chart creation is #If Mac Then skipped).

    On Windows: runs ProbeValidChartTypes VBA macro, parses ID|name output.
    Falls back to static dict on probe failure.
    """
    if platform.system() == "Darwin":
        print("macOS detected — using static chart type fallback (no Excel engine)")
        return {
            k: v
            for k, v in CHART_TYPE_FALLBACK.items()
            if chart_id_min <= k <= chart_id_max
        }

    runtime_dir.mkdir(parents=True, exist_ok=True)
    probe_output = runtime_dir / "_valid-chart-types.txt"

    print(f"Probing valid chart types {chart_id_min}-{chart_id_max} via PowerPoint ...")
    _run = run_only_fn or run_macro_only
    _run(
        macro_host_pptm=macro_host,
        macro_name="ProbeValidChartTypes",
        macro_params=[str(probe_output), str(chart_id_min), str(chart_id_max)],
    )

    valid: dict[int, str] = {}
    if probe_output.exists():
        for line in probe_output.read_text(encoding="utf-8", errors="replace").splitlines():
            text = line.strip()
            if not text:
                continue
            if "|" in text:
                id_str, _, name = text.partition("|")
                id_str = id_str.strip()
                name = name.strip()
                try:
                    valid[int(id_str)] = name
                except ValueError:
                    pass
            else:
                # Legacy format: plain ID without name
                try:
                    chart_id = int(text)
                    valid[chart_id] = CHART_TYPE_FALLBACK.get(chart_id, f"chart-type-{chart_id}")
                except ValueError:
                    pass
    print(f"  Found {len(valid)} valid chart types out of {chart_id_max - chart_id_min + 1}")
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


def _export_smartart_layouts(
    macro_host: Path,
    catalog_path: Path,
    run_only_fn: Callable[..., object] | None = None,
) -> list[SmartArtLayoutRow]:
    catalog_path.parent.mkdir(parents=True, exist_ok=True)
    _run = run_only_fn or run_macro_only
    _run(
        macro_host_pptm=macro_host,
        macro_name="ExportSmartArtLayouts_ToFile",
        macro_params=[str(catalog_path)],
    )

    rows: list[SmartArtLayoutRow] = []
    for line in catalog_path.read_text(encoding="utf-8", errors="replace").splitlines():
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
    valid_chart_types: dict[int, str] | None = None,
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
        # Clean stale chart case JSONs before rebuilding (renumbering is inevitable
        # when switching from static catalog to probe-discovered types).
        for stale in cases_dir.glob("oracle-full-chart-*.json"):
            stale.unlink()

        chart_types = valid_chart_types if valid_chart_types is not None else CHART_TYPE_FALLBACK
        for idx, chart_id in enumerate(sorted(chart_types.keys()), start=1):
            slug = _slugify(chart_types[chart_id], default=f"chart-type-{chart_id}")
            case_name = f"oracle-full-chart-{idx:04d}-{slug}"
            payload = _chart_case_payload(case_name, chart_id)
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
        "--chart-id-min",
        type=int,
        default=-4200,
        help="Minimum XlChartType numeric ID to probe (default: -4200).",
    )
    parser.add_argument(
        "--chart-id-max",
        type=int,
        default=150,
        help="Maximum XlChartType numeric ID to probe (default: 150).",
    )
    parser.add_argument(
        "--no-probe-charts",
        action="store_true",
        help="Skip chart probe step; use static fallback catalog.",
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
        default=True,
        help="Export each slide as PNG via VBA Slide.Export (default: enabled).",
    )
    parser.add_argument(
        "--no-export-png",
        action="store_true",
        help="Disable PNG export.",
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
    do_probe_charts = not args.no_probe_charts

    # All phases use independent PowerPoint sessions for maximum stability.
    # Each VBA call starts/quits its own PowerPoint process — slower but
    # ensures one failure never cascades to subsequent phases or cases.

    # --- Phase 1A: Probe valid shape IDs (single PowerPoint session, fast) ---
    valid_shape_ids: dict[int, str] | None = None
    probe_error: str | None = None
    if include_shapes and do_probe:
        try:
            valid_shape_ids = _probe_valid_shape_ids(
                macro_host, runtime_dir, args.shape_id_min, args.shape_id_max,
            )
        except Exception as exc:
            probe_error = str(exc)
            print(f"  Probe failed ({probe_error}), falling back to brute-force mode")
            valid_shape_ids = None

    # --- Phase 1B: Probe valid chart types ---
    valid_chart_types: dict[int, str] | None = None
    chart_probe_error: str | None = None
    if include_charts and do_probe_charts:
        try:
            valid_chart_types = _probe_valid_chart_types(
                macro_host, runtime_dir, args.chart_id_min, args.chart_id_max,
            )
        except Exception as exc:
            chart_probe_error = str(exc)
            print(f"  Chart probe failed ({chart_probe_error}), using static fallback")
            valid_chart_types = None

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
        valid_chart_types=valid_chart_types,
        include_tables=include_tables,
        include_connectors=include_connectors,
        include_fillstroke=include_fillstroke,
    )

    # --- Phase 4: Generate PPTX/PDF pairs (reuse cache by default) ---
    # Each case uses its own independent PowerPoint session for fault isolation.
    generated, failures = generate_all_cases_resilient(
        macro_host=macro_host,
        cases_dir=cases_dir,
        testdata_dir=testdata_dir,
        reuse_existing=not args.no_reuse,
        export_png=args.export_png and not args.no_export_png,
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
        "chart_id_range": [args.chart_id_min, args.chart_id_max],
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
        "chart_probe_enabled": do_probe_charts,
        "chart_probe_error": chart_probe_error,
        "valid_chart_type_count": len(valid_chart_types) if valid_chart_types is not None else None,
        "valid_chart_types": {k: v for k, v in sorted(valid_chart_types.items())} if valid_chart_types is not None else None,
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
