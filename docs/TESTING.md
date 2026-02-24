# Testing Guide

This project uses layered verification across two test ecosystems:

- **Unit tests** (vitest): parser/model/renderer behavior in isolation.
- **E2E tests** (pytest + Playwright): structural validation, visual comparison against PowerPoint PDF output, and baseline-driven shape/SmartArt regression.

## Unit Tests

```bash
pnpm test              # Run all unit tests
pnpm test -- --watch   # Watch mode
pnpm test:coverage     # With v8 coverage report → coverage/
```

Coverage areas:

- Parser safety and correctness (ZipParser, relationship parsing, EMU/angle/PCT unit conversion)
- Shape geometry (preset shape path tests in `test/unit/shapes/presets.test.ts`)
- Renderer behavior (batching, windowed mounting, hyperlink safety)
- Color utilities (HSL/RGB conversion, lumMod/lumOff/tint/shade modifiers)

## E2E Tests

### Setup

```bash
cd test/e2e
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
playwright install chromium
```

### Running

```bash
# Start dev servers first (from project root)
pnpm dev:e2e    # Vite :5173 + Python API :8080

# Then run tests
cd test/e2e
pytest -v                       # All E2E layers
pytest test_structural.py -v    # Layer 1: model structure vs ground truth
pytest test_visual.py -v        # Layer 2: HTML screenshots vs PDF (SSIM >= 0.65/slide)
pytest test_regression.py -v    # Layer 3: scores vs stored baselines
```

### Test Layers

| Layer               | File                             | What it checks                                              |
| ------------------- | -------------------------------- | ----------------------------------------------------------- |
| Structural          | `test_structural.py`             | Word coverage, shape count/position from exported model     |
| Visual              | `test_visual.py`                 | SSIM between HTML screenshots and PDF pages                 |
| Regression          | `test_regression.py`             | No score drops > 0.02 SSIM or 2% text coverage vs baselines |
| Baseline generation | `test_oracle_case_generation.py` | Baseline case JSON validity and generation pipeline         |

## Baseline-Driven Shape/SmartArt Evaluation

The baseline pipeline is the primary tool for expanding and verifying rendering quality. It generates isolated test cases (one shape or SmartArt layout per slide), renders them, and compares against PowerPoint output.

### Running Baseline Evaluation

```bash
cd test/e2e
source .venv/bin/activate

# Evaluate all preset shapes (by MsoAutoShapeType ID)
.venv/bin/python3 scripts/run_all_shapes_eval.py --shape-id-min 1 --shape-id-max 200

# Evaluate all SmartArt layouts
.venv/bin/python3 scripts/run_all_shapes_eval.py --smartart-cases-dir oracle/cases-full

# Both at once
.venv/bin/python3 scripts/run_all_shapes_eval.py \
  --shape-id-min 1 --shape-id-max 200 \
  --smartart-cases-dir oracle/cases-full

# Find failures
grep "False" reports/oracle-failures/all-shapes-eval.csv | sort -t, -k2 -n
```

Output files:

- `reports/oracle-failures/all-shapes-eval.json` — full metrics per case
- `reports/oracle-failures/all-shapes-eval.csv` — case,ssim,color_hist_corr,fg_iou_tolerant,chamfer_score,fg_iou,passed,needs_review
- `reports/<case>_slide0_{pdf,html,diff}.png` — visual comparison images

### Generating Ground Truth

Ground truth requires Microsoft PowerPoint (macOS or Windows). A VBA macro creates PPTX files and exports PDFs:

```bash
cd test/e2e
.venv/bin/python scripts/one_shot_full_ground_truth.py \
  --macro-host testdata/pptx-macro-host.pptm \
  --cases-dir oracle/cases-full \
  --testdata-dir testdata \
  --shape-id-min 1 \
  --shape-id-max 500
```

This generates/reuses ground truth for all SmartArt layouts available on the local PowerPoint build plus the specified shape ID range.

### Manual Review

For cases that pass automated metrics but have visual nuances:

1. Open `/test/pages/e2e-compare.html`
2. Review side-by-side PDF vs HTML renders with SSIM scores
3. Save verdicts per slide card
4. Verdicts persist in `reports/oracle-failures/manual-review.json`

## Visual Evaluation Metrics

The comparison pipeline uses a **two-layer metric system**. This design was arrived at empirically by testing many metrics against 300+ shape cases.

### Pass/Fail Layer (automated)

These two metrics determine pass/fail. Chosen for zero false positives across all 352 baseline cases:

| Metric            | Range   | Threshold | What it catches                                                                 |
| ----------------- | ------- | --------- | ------------------------------------------------------------------------------- |
| `ssim`            | 0-1     | >= 0.95   | Structural errors: wrong geometry, missing elements, layout shifts              |
| `color_hist_corr` | -1 to 1 | >= 0.80   | Color errors: wrong scheme resolution, gradient bugs, tint/shade misapplication |

### Warning Layer (human review)

| Condition     | Flag                | Purpose                                                     |
| ------------- | ------------------- | ----------------------------------------------------------- |
| `ssim < 0.99` | `needsReview: true` | Flags near-misses for human inspection without auto-failing |

### Diagnostic Layer (display only)

These metrics appear in the UI for reference but do not affect pass/fail:

| Metric            | Range | Description                                    |
| ----------------- | ----- | ---------------------------------------------- |
| `fg_iou`          | 0-1   | Foreground pixel IoU (non-white pixel overlap) |
| `fg_iou_tolerant` | 0-1   | FG IoU with 1px morphological dilation         |
| `chamfer_score`   | 0-1   | 1 - normalized Chamfer Distance                |
| `mae`             | 0-1   | Mean Absolute Error per pixel                  |

### Why Only SSIM + Color Histogram?

- **`fg_iou` was removed from pass/fail** — thin-stroke shapes (brackets, braces, arcs) get ~50% IoU drop from 1px anti-aliasing differences despite correct geometry.
- **`chamfer_score` was not promoted** — its "dilution effect" masks localized errors when most of the shape is correct.
- **SSIM catches all bugs** that any other metric catches, but color histogram adds sensitivity to pure-color errors that SSIM misses (e.g., wrong gradient stop colors on an otherwise correctly shaped element).

Previously evaluated but rejected: `edge_iou` (too noisy), `fg_area_ratio` (redundant), `fg_centroid_distance` (no observed failures), patch-based SSIM (can't detect < 1% area defects), LPIPS (heavy PyTorch dependency, marginal improvement).

### Color Histogram Correlation Details

- Computed over H, S, V channels independently (30 H bins, 32 S/V bins), then averaged
- Only foreground pixels (gray < 245) are compared, ignoring white backgrounds
- Sparse foreground (< 1.5% coverage) returns 1.0 to avoid anti-aliasing noise on thin-stroke shapes
- Score of 1.0 = identical color distributions; >= 0.80 = pass threshold

## Shape Fix Protocol (TDD Required)

For complex shape regressions (curved arrows, multi-segment geometry, 3D faces):

1. Isolate one baseline case ID and one slide.
2. Record baseline metrics (`ssim`, `color_hist_corr`, `fg_iou`, `chamfer_score`).
3. Extract ground-truth geometry from ECMA-376 `presetShapeDefinitions.xml` before editing path code.
4. Add a failing unit test for the specific mismatch.
5. Implement minimal geometry patch.
6. Verify: unit tests pass, baseline metrics do not regress, visual review confirms correctness.
7. Only then mark the case fixed and move to the next.

Do not use blind parameter tuning. When topology or shape semantics are wrong, derive the fix from the OOXML spec.

## Test Pages

| Page                                 | Purpose                           |
| ------------------------------------ | --------------------------------- |
| `/test/pages/index.html`             | Upload and preview any PPTX       |
| `/test/pages/render-slide.html`      | Single slide at native resolution |
| `/test/pages/e2e-compare.html`       | E2E dashboard with SSIM scores    |
| `/test/pages/compare-renderers.html` | Renderer-to-renderer comparison   |
| `/test/pages/export.html`            | Model JSON tree viewer            |

URL params for list rendering performance: `listStrategy`, `listBatchSize`, `windowedInitialSlides`, `windowedOverscanViewport`.

## Contribution Requirement

For behavior changes:

- Add or update at least one relevant test.
- Keep existing test suite green before opening PR.
- For shape geometry changes, run the baseline evaluation on affected cases.
