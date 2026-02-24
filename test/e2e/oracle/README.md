# PowerPoint Oracle E2E Plan

This directory contains the local-macOS PowerPoint oracle pipeline used to drive renderer improvements.

## Current Implemented Pieces

1. `powerpoint_oracle.py`
- `export_pptx_to_pdf_mac(...)`: opens a PPTX in PowerPoint and exports PDF with retry.
- `run_macro_export_mac(...)`: opens a macro host `.pptm`, runs a VBA macro (with optional parameters), exports PDF.

2. AppleScript runners
- `scripts/export_pptx_to_pdf.applescript`
- `scripts/run_macro_export.applescript`

3. Case compiler and metrics
- `case_compiler.py`: compiles JSON case files into a VBA-friendly line spec.
- `metrics.py`: visual metrics (`ssim`, `fg_iou`, `fg_iou_tolerant`, `chamfer_score`, `color_hist_corr`, `mae`) and quality gate. Pass/fail uses only `ssim ≥ 0.95` and `color_hist_corr ≥ 0.80`; other metrics are diagnostic.
- `shape` nodes support `shapeTypeId` (numeric `MsoAutoShapeType`) for forward-compatible shape coverage.

4. VBA probe module
- `vba/GenerateProbeDeck.bas`
- Includes a no-arg entry `GenerateProbeDeck_Default` so it appears in `Tools -> Macro -> Macros...`.
- Includes `GenerateProbeDeck_FromSpec(specPath)` to generate decks from compiled case specs.
- Import this module into `pptx-macro-host.pptm` only when the VBA file changes; case JSON edits do not require re-import.
- `SHAPE` spec token supports both names (`RECTANGLE`) and numeric ids (`1`, `182`, ...). Numeric is preferred for new shape coverage.

5. Tests
- `test_oracle_powerpoint.py`: unit tests for command assembly/retry/error behavior.
- `test_oracle_macro_pipeline.py`: local smoke test for macro-driven oracle export.
- `test_oracle_case_compiler.py`: validates JSON -> spec compilation.
- `test_oracle_metrics.py`: validates visual metrics + quality gate logic.
- `test_oracle_auto_pipeline.py`: end-to-end local pipeline (`case -> macro -> pptx/pdf -> renderer compare`).
- `test_oracle_attention_ranking.py`: verifies ranked `attention_cases` output.

## How To Run

1. Unit tests (no PowerPoint dependency)
```bash
cd test/e2e
.venv/bin/python -m pytest -q test_oracle_powerpoint.py
```

2. Local macro smoke test
```bash
cd test/e2e
PPTX_ORACLE_MACRO_HOST=/tmp/pptx-macro-host.pptm \
.venv/bin/python -m pytest -q test_oracle_macro_pipeline.py
```

Optional macro name override:
```bash
PPTX_ORACLE_MACRO_NAME=GenerateProbeDeck_Default
```

3. End-to-end local oracle pipeline
```bash
cd test/e2e
PPTX_ORACLE_MACRO_HOST=/absolute/path/to/pptx-macro-host.pptm \
.venv/bin/python -m pytest -q test_oracle_auto_pipeline.py -m local_oracle
```

Generated artifacts are intentionally persisted to:
- `test/e2e/testdata/cases/oracle-auto-basic-shapes-smoke/source.pptx`
- `test/e2e/testdata/cases/oracle-auto-basic-shapes-smoke/ground-truth.pdf`

This makes the auto-generated file pair visible in `/test/pages/e2e-compare.html`
for manual visual alignment.

## Batch-generate Oracle Cases

Run this to generate all JSON cases under `oracle/cases/` into `test/e2e/testdata/cases/`:

```bash
cd test/e2e
.venv/bin/python -m pytest -q test_oracle_generate_cases_local.py -m local_oracle
```

Generated pairs (e.g. `oracle-shape-rectangle.*`, `oracle-smartart-basic-process.*`)
will appear in `/test/pages/e2e-compare.html` file dropdown automatically.

## One-Shot Full Ground Truth (Large Baseline)

For a larger baseline (beyond curated `oracle/cases/*.json`), use:

- `../scripts/one_shot_full_ground_truth.py`

It supports:

- SmartArt: export all layouts available on the local PowerPoint build and generate cases automatically.
- Shapes: probe numeric `MsoAutoShapeType` ranges (e.g. `1..500`) via `shapeTypeId`.
- Cache reuse by default (`--no-reuse` to force regeneration).
- Unified JSON report output.

Example:

```bash
cd test/e2e
.venv/bin/python scripts/one_shot_full_ground_truth.py \
  --macro-host testdata/pptx-macro-host.pptm \
  --cases-dir oracle/cases-full \
  --testdata-dir testdata \
  --shape-id-min 1 \
  --shape-id-max 500
```

Report (default):

- `test/e2e/reports/oracle-failures/full-ground-truth-one-shot.json`

## Local Development Loop (Incremental by default)

Use this when actively improving shape/SmartArt support.

```bash
cd test/e2e
PPTX_ORACLE_MACRO_HOST=/absolute/path/to/pptx-macro-host.pptm \
.venv/bin/python -m pytest -q test_oracle_regression_matrix_local.py -m local_oracle
```

Default behavior is optimized for local development:

- Runs only cases that are not yet marked `supported` in:
  - `test/e2e/reports/oracle-failures/support-catalog.json`
- Reuses cached ground truth (`source.pptx` + `ground-truth.pdf`) in `test/e2e/testdata/cases/{stem}/` when both files already exist.
- Writes updated pass/fail status back into the support catalog after the run.

This keeps each iteration focused on unsupported coverage and avoids regenerating existing oracle artifacts.

### Force Full Regression

```bash
ORACLE_CASE_SCOPE=all \
PPTX_ORACLE_MACRO_HOST=/absolute/path/to/pptx-macro-host.pptm \
.venv/bin/python -m pytest -q test_oracle_regression_matrix_local.py -m local_oracle
```

### Force Ground-Truth Regeneration

```bash
ORACLE_REUSE_GROUND_TRUTH=0 \
PPTX_ORACLE_MACRO_HOST=/absolute/path/to/pptx-macro-host.pptm \
.venv/bin/python -m pytest -q test_oracle_regression_matrix_local.py -m local_oracle
```

## Bootstrap Coverage from Existing Large Decks

Generate seed cases by scanning shape presets and SmartArt layout IDs from your own existing PPTX decks. Use case stems under `testdata/cases/` that already have `source.pptx` (and optionally `ground-truth.pdf`):

```bash
cd test/e2e
.venv/bin/python -m oracle.seed_catalog \
  --testdata-dir testdata \
  --cases-dir oracle/cases \
  --sources <stem1> <stem2> ... \
  --min-source-size-mb 1 \
  --report-path reports/oracle-failures/seed-bootstrap-from-sources.json
```

The seed catalog is written to `test/e2e/reports/oracle-failures/seed-bootstrap-from-sources.json`.

Then generate/refresh oracle ground truth for these seed cases (cached by default):

```bash
cd test/e2e
PPTX_ORACLE_MACRO_HOST=/absolute/path/to/pptx-macro-host.pptm \
.venv/bin/python -m pytest -q test_oracle_seed_bootstrap_local.py -m local_oracle
```

## Manual Confirmation via E2E Page

Open:

- `http://localhost:5173/test/pages/e2e-compare.html`

Each slide card now supports a manual verdict (`supported` / `unsupported` / `unsure`) and note.

Saving feedback calls:

- `POST /api/manual-review`

Feedback is persisted to:

- `test/e2e/reports/oracle-failures/manual-review.json`

For oracle case files, `supported`/`unsupported` feedback also updates:

- `test/e2e/reports/oracle-failures/support-catalog.json`

## Attention Ranking Output

`test_oracle_regression_matrix_local.py` writes `test/e2e/reports/oracle-failures/suite-summary.json` with:
- `failed_by_label`: hard failures by shape/smartart label.
- `attention_cases`: warning-only cases sorted by severity for manual review priority.

## Evaluate all shapes + SmartArt (SSIM + fg_iou)

To get **SSIM and fg_iou** for shapes and SmartArt by iterating `POST /api/evaluate/{case}`:

1. Start dev servers: `pnpm dev:e2e` (Vite + Python API).
2. Run one of:

```bash
cd test/e2e
# Shapes (id 1..500) + SmartArt (all oracle-full-smartart-*.json in oracle/cases-full)
.venv/bin/python scripts/run_all_shapes_eval.py --shape-id-min 1 --shape-id-max 500 --smartart-cases-dir oracle/cases-full
# Shapes only
.venv/bin/python scripts/run_all_shapes_eval.py --shape-id-min 1 --shape-id-max 500
# SmartArt only
.venv/bin/python scripts/run_all_shapes_eval.py --smartart-cases-dir oracle/cases-full
# Everything in testdata (single evaluate-all call)
.venv/bin/python scripts/run_all_shapes_eval.py
```

Output:

- `reports/oracle-failures/all-shapes-eval.json` — full report with `results[].summary.ssim`, `results[].summary.fg_iou`, etc.
- `reports/oracle-failures/all-shapes-eval.csv` — CSV with columns `case`, `ssim`, `color_hist_corr`, `fg_iou_tolerant`, `chamfer_score`, `fg_iou`, `passed`, `needs_review` for sorting/filtering.

Optional: `--api-base`, `--out`, `--no-csv`.

## Directory Authorization (macOS)

To avoid repeated PowerPoint permission prompts, keep oracle IO in one fixed directory:

- Fixed runtime dir: `test/e2e/testdata/oracle-runtime`
- PowerPoint now writes only to fixed sink files in that dir:
  - `test/e2e/testdata/oracle-runtime/_macro-output.pptx`
  - `test/e2e/testdata/oracle-runtime/_macro-output.pdf`
- Macro spec path is also fixed:
  - `test/e2e/testdata/oracle-runtime/_macro-spec.txt`
  Generated per-case files are copied from these sinks by Python.

Authorize this directory once when prompted by PowerPoint.

## Next Steps (TDD Sequence)

1. Expand shape/smartart coverage in `oracle/cases/*.json`.
2. Add auto-minimization for failing cases and persist them into a stable regression suite.
3. Add PR (`smoke`) vs nightly (`full`) matrix commands in CI scripts.

## Standard TDD Loop For New Render Support

Use this as the default development workflow for adding new shape/SmartArt compatibility:

1. Add a new oracle case (or include it in `cases-full`).
2. Generate/reuse ground truth (`pptx/pdf`).
3. Run local oracle matrix and confirm failure signal.
4. Add a failing renderer/unit test for the exact mismatch.
5. Implement minimal fix in parser/shape preset/renderer.
6. Re-run:
   - unit tests
   - targeted oracle case
   - matrix (incremental or full)
7. Confirm support status update in:
   - `reports/oracle-failures/support-catalog.json`
