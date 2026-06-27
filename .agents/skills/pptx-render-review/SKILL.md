---
name: pptx-render-review
description: Use when reviewing PPTX renderer visual fidelity, triaging failed or needs-review oracle cases, inspecting PDF/PNG versus HTML screenshots, or saving manual support verdicts in this repository.
---

# PPTX Render Review

## Overview

Turn renderer screenshots and oracle metrics into a human review queue. Stay read-only unless the user asks for a fix.

## Required Context

From the repository root:

```bash
pwd
git status --short
find test/e2e/reports/oracle-failures -maxdepth 1 -type f -name '*.json' -print0 | xargs -0 ls -lt | head
```

For current quality, compare `generated_at` values and prefer the newest report matching the requested corpus.

## Review Sources

Source order:

| Need                      | Source                                                                         |
| ------------------------- | ------------------------------------------------------------------------------ |
| Interactive visual review | `http://127.0.0.1:5173/test/pages/e2e-compare.html`                            |
| Single native slide       | `/test/pages/render-slide.html?file=testdata/cases/{case}/source.pptx&slide=N` |
| Metrics                   | `test/e2e/reports/oracle-failures/*live*.json` or requested report             |
| Diff and screenshots      | `test/e2e/reports/{case}_slide{N}_{pdf,html,diff}.png`                         |
| Manual verdict store      | `test/e2e/reports/oracle-failures/manual-review.json`                          |
| Support catalog           | `test/e2e/reports/oracle-failures/support-catalog.json`                        |

## Workflow

1. Confirm report freshness:

```bash
jq '{generated_at,total_cases,
  passed:(.results|map(select(.passed==true))|length),
  failed:(.results|map(select(.passed==false))|length),
  needs_review:(.results|map(select(.needs_review==true))|length)}' test/e2e/reports/oracle-failures/<report>.json
```

If it is not the newest matching corpus, call it stale.

2. Confirm dev servers only when browser/API review is needed:

```bash
pnpm dev:e2e
```

If servers already run, reuse them.

3. Build an attention queue:

```bash
jq -r '.results
  | sort_by((if .passed then 1 else 0 end), (if .needs_review then 0 else 1 end), .summary.ssim)
  | .[:30][]
  | [.case, .summary.ssim, .summary.color_hist_corr, .passed, .needs_review, ((.reasons // []) | join(";")), ((.warnings // []) | join(";"))]
  | @tsv' test/e2e/reports/oracle-failures/<report>.json
```

4. Prioritize:

| Priority | Meaning                                         |
| -------- | ----------------------------------------------- |
| P0       | `passed=false`, especially chart/text/composite |
| P1       | `passed=true`, `needs_review=true`              |
| P2       | stale/missing manual verdict                    |
| P3       | supported sample                                |

5. Inspect selected cases in triple view. Prefer PNG ground truth; use PDF only when PNG is unavailable or requested.

6. Save verdicts only after per-slide visual inspection:

```bash
curl -sS -X POST http://127.0.0.1:8080/api/manual-review \
  -H 'Content-Type: application/json' \
  -d '{"test_file":"CASE","slide_idx":0,"verdict":"supported","note":"short reason"}'
```

Use `supported`, `unsupported`, or `unsure`. Notes name visible mismatch, not guessed code cause.

## Red Flags

- Bulk-marking from metrics alone.
- `needs_review=true` without screenshot/triple-view inspection.
- Old `generated_at` or wrong corpus/source.
- Notes guess code cause instead of visible mismatch.

## Reporting Back

Report the report path, `generated_at`, counts, top queue items, saved verdicts, and stale/missing data.

## Common Mistakes

- Do not use `windows-all-eval.json` or `all-shapes-eval.json` blindly.
- Do not mark a case supported from metrics alone when `needs_review=true`.
- Do not bulk-save manual verdicts; save only case/slide verdicts you inspected.
- Do not chase `fg_iou` as a pass/fail gate; it is diagnostic only.
- Do not modify renderer code during review unless the user asks for a fix.
