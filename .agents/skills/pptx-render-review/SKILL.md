---
name: pptx-render-review
description: Use when reviewing PPTX renderer visual fidelity, triaging failed or needs-review oracle cases, inspecting PDF/PNG versus HTML screenshots, checking renderer bugfix side effects, planning regression coverage, or saving manual support verdicts in this repository.
---

# PPTX Render Review

## Overview

Use renderer screenshots, diff images, and oracle metrics to make fast visual fidelity judgments. Start from side-by-side review, then use diff-first as a diagnostic lens; stay read-only unless the user asks for a fix.

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

3. Pick a review set for the changed rendering area:

| Area           | Prefer samples                                            |
| -------------- | --------------------------------------------------------- |
| Shape geometry | target shape id, related presets, adjustment variants     |
| Fill/stroke    | gradient, scheme color, alpha, connector, multi-path      |
| Chart          | axis, legend, marker, combo, stock, doughnut, data labels |
| Text/table     | pypptx text, table alignment, composite cases             |
| SmartArt       | layout family, generated PNG ground truth, edge-heavy     |

4. For renderer fixes, build a small interaction matrix before changing code or declaring the
   fix complete. Include the user-visible positive case, the inverse/opt-out case, and the parent
   container or browser behavior that could expose a side effect. For text layout changes, inspect
   `a:bodyPr` and cover relevant combinations of `wrap`, `horzOverflow`, `vertOverflow`,
   `spAutoFit`, `normAutofit`, `noAutofit`, insets, vertical text, bullets, multi-paragraph text,
   and adjacent runs. A leaf `TextRenderer` test is insufficient when the visible behavior depends
   on the `ShapeRenderer` text container.

5. Prioritize:

| Priority | Meaning                                      |
| -------- | -------------------------------------------- |
| P0       | large diff in changed rendering area         |
| P1       | `passed=false` or semantic mismatch          |
| P2       | `passed=true`, `needs_review=true`           |
| P3       | representative supported sample for baseline |

6. Inspect selected cases in side-by-side view first. Use diff-first to locate suspicious regions, then confirm in ground-truth/rendered side-by-side before making a verdict. Prefer PNG ground truth; use PDF only when PNG is unavailable or requested.

Default to decision metrics first: auto gate (`PASS`, `REVIEW`, `FAIL`), SSIM, color correlation, and `needs_review`. Open Diagnostics only when locating a mismatch or explaining why a case needs review; diagnostic metrics include foreground IoU, chamfer, MAE, text coverage, word counts, and shape count.

7. Save verdicts only after per-slide visual inspection:

```bash
curl -sS -X POST http://127.0.0.1:8080/api/manual-review \
  -H 'Content-Type: application/json' \
  -d '{"test_file":"CASE","slide_idx":0,"verdict":"supported","note":"short reason"}'
```

Use `supported`, `unsupported`, or `unsure`. Notes name visible mismatch, not guessed code cause.

## Red Flags

- Bulk-marking from metrics alone.
- Treating diagnostic metrics as top-level verdict gates.
- `needs_review=true` without expanding from diff into side-by-side inspection.
- Old `generated_at` or wrong corpus/source.
- Notes guess code cause instead of visible mismatch.
- Text/layout fixes tested only at the run/span layer without the shape text container.
- Missing inverse coverage for explicit opt-outs such as `horzOverflow="overflow"`.

## Reporting Back

Report the report path, `generated_at`, selected review set, auto gate summary, diff observations, saved verdicts, and stale/missing data. Keep diagnostic metrics secondary unless they explain a visible issue.

## Common Mistakes

- Do not use `windows-all-eval.json` or `all-shapes-eval.json` blindly.
- Do not mark a case supported from metrics alone when `needs_review=true`.
- Do not bulk-save manual verdicts; save only case/slide verdicts you inspected.
- Do not chase `fg_iou` as a pass/fail gate; it is diagnostic only.
- Do not modify renderer code during review unless the user asks for a fix.
