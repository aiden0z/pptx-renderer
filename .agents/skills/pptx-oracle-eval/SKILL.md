---
name: pptx-oracle-eval
description: Use when running, refreshing, comparing, or summarizing PPTX renderer oracle evaluations, including shape, SmartArt, chart, table, connector, fillstroke, python-pptx, cases, windows-cases, and regression report workflows in this repository.
---

# PPTX Oracle Eval

## Overview

Run PPTX renderer oracle evaluations without mixing stale reports, loose pytest thresholds, and high-fidelity support gates.

## Before Running

Capture provenance first:

```bash
pwd
git status --short
```

Ensure E2E servers are available. If needed, start `pnpm dev:e2e` in a separate long-running session, then verify:

```bash
curl -sS http://127.0.0.1:8080/api/testdata-files >/dev/null
curl -sS http://127.0.0.1:5173/test/pages/e2e-compare.html >/dev/null
```

If ownership is unclear, reuse healthy servers.

## Pick The Corpus

| User intent               | Command shape                            |
| ------------------------- | ---------------------------------------- |
| One shape ID              | `--shape-id-min N --shape-id-max N`      |
| Shape range               | `--shape-id-min A --shape-id-max B`      |
| SmartArt only             | `--smartart-cases-dir oracle/cases-full` |
| Full curated oracle cases | `--cases-dir oracle/cases-full`          |
| Python-pptx cases         | `--pypptx-cases-dir oracle/cases-pypptx` |
| Windows ground truth      | add `--source windows`                   |

Use semantic output names:

```bash
cd test/e2e
.venv/bin/python3 scripts/run_all_shapes_eval.py \
  --cases-dir oracle/cases-full \
  --out reports/oracle-failures/<topic>-$(date +%Y%m%d-%H%M%S).json
```

For one known case, use the API first:

```bash
cd test/e2e
curl -sS -X POST http://127.0.0.1:8080/api/evaluate/CASE \
  > reports/oracle-failures/CASE-probe-$(date +%Y%m%d-%H%M%S).json
```

## Quality Gate

Use the repository's two-layer metric model:

| Layer               | Rule                                                |
| ------------------- | --------------------------------------------------- |
| Automated pass/fail | `ssim >= 0.95` and `color_hist_corr >= 0.80`        |
| Human review        | `ssim < 0.99` sets `needs_review=true`              |
| Diagnostic only     | `fg_iou`, `fg_iou_tolerant`, `chamfer_score`, `mae` |

Do not change thresholds during an eval run.

Do not update baselines, manual verdicts, or `support-catalog.json` unless asked.

## Summarize The Run

Report counts and worst cases:

```bash
jq '{generated_at,total_cases,
  passed:(.results|map(select(.passed==true))|length),
  failed:(.results|map(select(.passed==false))|length),
  needs_review:(.results|map(select(.needs_review==true))|length),
  errors:(.errors|length)}' <report>.json

jq -r '.results
  | sort_by(.summary.ssim)
  | .[:20][]
  | [.case,.summary.ssim,.summary.color_hist_corr,.summary.fg_iou_tolerant,.summary.chamfer_score,.passed,.needs_review,((.reasons // [])|join(";"))]
  | @tsv' <report>.json
```

For mixed corpora, group results by domain (`chart`, `smartart`, `shape`, `table`, `connector`, `fillstroke`, `text`, `composite`) before recommending next work.

## Interpret Carefully

- Treat `generated_at` and mtime as evidence.
- Separate current facts from older report history.
- If metrics conflict with the UI, re-run the single case via `POST /api/evaluate/{case}`.
- Chart-heavy failures need XML inspection, not blind ECharts tuning.
- SmartArt near misses need manual review even when gates pass.

## Red Flags

- Reporting default reports as current without checking `generated_at`.
- Starting a foreground dev server and never running eval.
- Running full corpus when the user named one case.
- Updating baselines/support status as measurement side effect.

## Reporting Back

Include command, report path, `generated_at`, corpus/source, git dirty status, pass/fail/review/error counts, top cases by domain, stale data, and next target.
