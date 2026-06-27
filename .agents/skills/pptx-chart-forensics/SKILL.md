---
name: pptx-chart-forensics
description: Use when diagnosing or fixing PPTX renderer chart mismatches, chart oracle failures, ECharts option drift, OOXML chart XML parsing gaps, axis or legend discrepancies, plotArea issues, or python-pptx chart cases in this repository.
---

# PPTX Chart Forensics

## Overview

Use this when a chart case fails. Derive fixes from OOXML before changing ECharts options.

## First Moves

For a known chart case, run a single-case probe first:

```bash
cd test/e2e
curl -sS -X POST http://127.0.0.1:8080/api/evaluate/CASE \
  > reports/oracle-failures/CASE-chart-probe-$(date +%Y%m%d-%H%M%S).json
```

Use `?source=windows` for Windows cases.

Use a broader sweep only for family impact:

```bash
cd test/e2e
.venv/bin/python3 scripts/run_all_shapes_eval.py \
  --cases-dir oracle/cases-full \
  --pypptx-cases-dir oracle/cases-pypptx \
  --out reports/oracle-failures/chart-probe-$(date +%Y%m%d-%H%M%S).json
```

Record metrics and report path.

## Inspect Chart XML

Extract chart XML before editing:

```bash
python3 - <<'PY'
from zipfile import ZipFile
case = 'CASE'
source = 'cases'  # use 'windows-cases' for --source windows
path = f'testdata/{source}/{case}/source.pptx'
with ZipFile(path) as z:
    for name in z.namelist():
        if name.startswith('ppt/charts/chart') and name.endswith('.xml'):
            print('---', name)
            print(z.read(name).decode('utf-8')[:12000])
PY
```

Use `testdata/windows-cases` when the run used `--source windows`.

## Diagnosis Checklist

Check these before parameter tuning:

| Area        | Questions                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------ |
| Plot area   | Multiple types, combo, stock, 3D, doughnut, scatter, radar, or area?                             |
| Series      | Explicit `spPr`, marker, smooth, varyColors, order/index, labels, per-point colors?              |
| Axes        | `crossBetween`, `majorTickMark`, `tickLblPos`, scaling, delete flags, number format, text props? |
| Legend      | Manual layout, overlay, order, icon shape, custom line/fill?                                     |
| Defaults    | Office default omitted from XML handling?                                                        |
| Unsupported | 3D/unsupported where bounded fallback is more honest?                                            |

## Implementation Rules

- Write or update a focused unit test first.
- If no XML field explains the mismatch, say so before experimenting.
- Prefer parser/model assertions for missing XML and renderer option assertions for ECharts.
- Keep fixes scoped to chart modules unless evidence crosses boundaries.
- Do not improve one chart while regressing another chart family.
- Do not treat low `fg_iou` alone as proof; text, grid bounds, and anti-aliasing can dominate it.

Targeted tests:

```bash
npx vitest run test/unit/renderer/ChartRenderer.test.ts
npx vitest run test/unit/renderer/chart/legendOverlay.test.ts
pnpm typecheck
```

## Verification

After a chart fix:

1. Run the focused unit test that failed first.
2. Run the nearby chart unit test files.
3. Re-run target oracle case and compare metrics.
4. Check generated `pdf`, `html`, and `diff` PNGs.
5. Run a small chart-family sweep.

## Reporting Back

Report case id, XML facts, suspected gap, files, tests, metrics, unsupported behavior.

## Common Mistakes

- Do not tune ECharts margins/radii/colors before proving OOXML source.
- Do not assume the filename names the actual chart type.
- Do not ignore later chart nodes in `plotArea`; combo charts often hide there.
- Do not mark 3D chart parity fixed without a real 3D strategy and oracle coverage.
- Do not use a broad sweep as a substitute for single-case evidence.
