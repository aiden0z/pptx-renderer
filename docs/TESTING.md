# Testing Guide

This project uses layered verification across two test ecosystems:

- **Unit tests** (vitest): parser/model/renderer behavior in isolation.
- **Browser package tests** (Playwright): built standalone entry, ECharts registration
  matrix, and isolated PDF.js Worker rendering in Chromium.
- **E2E tests** (pytest + Playwright): structural validation, visual comparison against PowerPoint PDF output, and baseline-driven shape/SmartArt regression.

## Fast Feedback By Change Impact

Use the affected-verification planner during implementation instead of repeating every gate after
each edit:

```bash
# Inspect the previous commit without running checks
pnpm verify:plan -- --base HEAD^

# Run only the planned fast checks
pnpm verify:affected -- --base HEAD^

# Plan explicit working files while iterating
pnpm verify:plan -- --changed-path src/renderer/ChartRenderer.ts

# Make required local visual-gate commands executable from fresh per-case reports
pnpm verify:plan -- --changed-path src/renderer/Shape3DRenderer.ts \
  --case-report test/e2e/reports/case-a.json \
  --case-report test/e2e/reports/case-b.json
```

The planner maps changed files through exact or declared-glob `affectedPaths` in
`capabilities.json`, de-duplicates their unit and Python tests, and lists the native PowerPoint case
IDs recorded by the latest historical verification record or, when no such record can exist for a
non-native render mode, its explicit `verificationCases`. A targeted run executes only those
unit/Python checks plus TypeScript type checking when runtime TypeScript changed. Browser checks
and native rendering stay visible as deferred pre-commit and pre-merge gates. Direct unit, Python,
and browser test edits run their own gate without expanding the production native scope; the shared
python-pptx generator runs its focused suite, while changed tracked case definitions still select
their declared capability. Documentation-only changes run formatting plus documentation and
distribution contract tests. A `package.json` change that modifies only the version runs build,
package, publint, and size gates without requesting native rerenders; any other package change
remains global. Any unclassified non-documentation path fails closed to the full TypeScript,
Python, typecheck, and browser plan. A capability-registry or unclassified global
runtime/control change expands the native scope to every registered capability. Shared evaluation,
provenance, evidence, and capability-loop control changes do the same and add `capability:check`.
Accepted native artifacts count as available only when their source and selected ground-truth
SHA-256 values match the recorded testcase inputs exactly; same-stem cases from another local
corpus cannot satisfy the check. Declared non-native verification cases require current local PPTX
and ground-truth artifacts but do not create a native support claim. Missing case sets, mismatched artifacts, and required local visual gates without a complete
repeatable `--case-report` set are reported explicitly instead of silently passing. Targeted Python
commands run from `test/e2e`, where the suite's fixture and testdata paths are defined.

The E2E API retries one screenshot in a fresh browser context only when the render page reports a
visual-stability timeout. Other errors fail immediately, and a second stability timeout remains a
runtime failure.

The package commands use `scripts/run-python.mjs`, preferring `PYTHON`, then the platform-specific
E2E virtual environment, then an installed Python 3 launcher. This keeps the same entry points
usable on macOS, Linux, and Windows.

Use three verification tiers:

1. **Edit loop:** `pnpm verify:affected` for affected deterministic tests, normally seconds to a
   few minutes.
2. **Pre-commit:** add the planner-requested browser suite and evaluate only its listed native
   cases. Keep the dev servers alive across cases.
3. **Pre-merge/release:** run the complete required suite, package gates, capability contract check,
   and any deliberately global native matrix.

This changes when verification runs, not what constitutes acceptance. A renderer result applies
only to the Git revision it tested. Test inputs and baselines can be reused when their source,
ground truth, browser/capture profile, and font provenance still match.

## Unit Tests

```bash
pnpm test              # Run all unit tests
pnpm test -- --watch   # Watch mode
pnpm test:coverage     # With v8 coverage report → coverage/
```

## Browser Package Tests

```bash
pnpm build
pnpm exec playwright install chromium
pnpm test:browser
```

On machines with branded Chrome but no downloaded Playwright Chromium, run
`PLAYWRIGHT_CHANNEL=chrome pnpm test:browser`. The channel applies to the complete browser suite.
For Python E2E runs, use `PPTX_E2E_BROWSER_CHANNEL=chrome`; the same value is also consumed by the
evaluation API server.

These tests load the built standalone browser artifact with a tracked PPTX, initialize
every renderer-supported ECharts series through the modular runtime, verify computed
overflow behavior for all text-axis combinations, and execute the actual outer-Worker
plus PDF.js-worker path. CI runs the PDF test against both supported PDF.js major lines;
Node-only imports are not accepted as browser compatibility evidence. The Vite test server allows
the resolved `pdfjs-dist` package root explicitly, including when a worktree's dependency symlink
points outside the worktree. Set `PDFJS_DIST_DIR` to test a different installed PDF.js package.

The dedicated `compatible-content-package.spec.ts` generates an OPC PPTX package and
loads it through the built exported `parseZip`, `buildPresentation`, `renderSlide`, and
serialization APIs. It checks eager/lazy MCE selection and nested order, decoded SVG/OLE
picture previews, and actual chart Canvas colors for local override/identity/absence while
ordinary slide colors retain the parent map. Run it alone after a build with:

```bash
pnpm exec playwright test --config test/browser/playwright.config.ts test/browser/compatible-content-package.spec.ts --workers=1
```

Other coverage specs exercise source modules for focused text, table/chart, and media/lifecycle
interactions. Keep these distinct from built-package coverage and PowerPoint oracle evidence.
Browser media tests explicitly await image decoding/playback; `handle.ready` covers scheduled
renderer work, not automatic playback or every browser decoder completion. Hidden charts can
initialize after visibility returns. H264 checks require branded Chrome; default Chromium still
runs WAV/WebM checks.

Coverage areas:

- Parser safety and correctness (ZipParser, relationship parsing, EMU/angle/PCT unit conversion)
- Shape geometry (preset shape path tests in `test/unit/shapes/presets.test.ts`)
- Renderer behavior (batching, windowed mounting, hyperlink safety)
- Color utilities (HSL/RGB conversion, lumMod/lumOff/tint/shade modifiers)

## OOXML Geometry Compiler Gate

The full-corpus compiler and emitter remain development tooling. A generated production subset
routes 29 definitions through `src/shapes/ooxmlGeometryRuntime.ts`: all 28 zero-adjustment
flowcharts in shape IDs 61-88 (20 one-path and eight ordered three-path definitions), plus `donut`
with pinned `adj=25000` default and `0..50000` handle bounds. Other presets remain handwritten.
Focused tests cover every guide-formula operator, PowerPoint
numeric deviations, predefined guides, ordered guide rebinding, adjustment overrides, every IR
section, all six path commands, path-coordinate scaling, non-circular elliptical arcs,
positive/negative sweeps, full circles, serialization rounding, runtime/build-time parity,
multi-path fill/stroke order, picture silhouettes, and error boundaries.

```bash
pnpm exec vitest run \
  test/unit/build/ooxmlGeometrySource.test.ts \
  test/unit/build/ooxmlGeometryIr.test.ts \
  test/unit/build/ooxmlGeometryPathEmitter.test.ts \
  test/unit/shapes/ooxmlGeometryRuntime.test.ts

pnpm geometry:check
```

`geometry:check` verifies the vendored ECMA archive/XML hashes, reconciliation rules, generated
catalog bytes, complete IR structural SHA-256, and default evaluation plus SVG emission of all
186 unique shapes at 216x216, 400x180, and 180x400. Each emitted profile requires all 319 paths
to be non-empty, rejects non-finite output, and has its own SHA-256. The command also verifies the
generated production-subset module byte-for-byte. These checks establish deterministic compilation
and path serialization. Browser and native PowerPoint equivalence remain separate per-shape gates.
The browser gate renders all 29 production definitions, checks the eight multi-path flowcharts as
three ordered SVG paths, and exercises donut bounds in standalone, non-uniform group, and adjusted
picture-clip contexts. The native flowchart gate compares all 28 presets against PowerPoint in 28
cases and 84 slides: square explicit paint, wide theme-reference paint, and tall rendering through a
non-identity group. The bounded donut gate remains separate. Both record per-case provenance,
runtime errors, review status, and metric deltas from a fresh clean baseline.

Report native comparisons with the exact source revision, case IDs, environment, errors,
pre-existing metric failures, new regressions, and visual-review status. A sampled run is not a
full-corpus acceptance result. Do not change thresholds or baseline images to hide failures.
The API exposes per-slide runtime failures through `evaluationErrorCount` and `evaluationErrors`;
they are excluded from visual metrics and reported as runtime errors. The batch runner retries
HTTP and per-slide runtime errors once by default (`--retries`) for explicit and discovered cases.
Unresolved native questions (including negative percent-stacked chart normalization and text
inheritance through some empty body-property/autofit combinations) need specific native evidence.

## E2E Tests

### Setup

```bash
cd test/e2e
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
playwright install chromium
```

`pytest-timeout` is installed by the E2E package and enforces the suite-wide 180-second per-test
limit. The suite uses explicit `asyncio.run(...)` calls rather than pytest async test functions.

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

The default corpus is `testdata/cases`. Windows-generated oracle cases live under
`testdata/windows-cases` and can be selected without changing test code:

```bash
pytest -v --testdata-source=windows    # Windows-generated cases only
pytest -v --testdata-source=all        # Default + Windows-generated cases

# Equivalent environment override:
PPTX_E2E_TESTDATA_SOURCE=windows pytest test_visual.py -v
```

Windows case ids are encoded with a `win__` prefix during pytest
parametrization so baseline/report filenames stay distinct from default cases.

### Local Corpus Contract

Binary oracle artifacts stay local under `test/e2e/testdata/` and are ignored by Git:

- `cases/{stem}/source.pptx`
- `cases/{stem}/ground-truth.pdf`
- optional `cases/{stem}/slides/slide{N}.png`

Keep the generator, tracked case JSON, and its `coverage` metadata in the repository. This
preserves case IDs, intended OOXML features, required fonts, and the native-oracle requirement
without committing large or licensed files. Generation reports record SHA-256 hashes for local
artifacts; visual evaluation reports independently fingerprint the exact inputs they consumed.

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

For text, shape-adjustment, zero-adjustment flowchart, ordinary-shape and text effects, bounded
static DrawingML 3D, table, composite, and chart interaction cases, use the python-pptx generator.
It currently defines 203 cases: 61 text, 31 shape-adjustment, 28 flowchart, 2 shape-effect, 1
text-effect, 20 static 3D, 8 table, 8 formula, 20 composite, and 24 chart cases. Chart cases 23–24
exercise readable two-dimensional fallbacks for native 3D column and pie charts; they do not claim
three-dimensional parity.

The eight isolated table cases cover a default grid, header and row banding, first/last-column
styles, horizontal and vertical merges, variable grid sizes, cell margins and vertical anchors,
CJK/mixed-script text, and direct solid/dashed/no-fill borders. They complement composite cases by
making one table interaction family diagnosable per native comparison.

The ordinary-shape effect cohort contains the eight-slide outer-shadow matrix and a seven-slide
reflection matrix with one inverse plus six positive shape-surface rows. The separate one-slide
live-text reflection case is discovery evidence and is not part of the promoted shape capability.
The reflection matrix crosses `rect`, `roundRect`, `ellipse`, and `upArrow`, solid and simple
gradient paint, square/wide/tall bounds, broad blur, distance, and a single unrotated group at
uniform 1.25 scale. Its local metric is described below.

Each flowchart case maps one shape ID from 61 through 88 to its exact OOXML preset and contains three slides:
square explicit paint, wide theme-reference paint, and grouped tall explicit paint. The group uses
a non-identity child coordinate space, and every source keeps an empty `a:avLst` with no adjustment
guides. The static 3D matrix covers flat opt-out, picture and
shape containers, `twoPt:t` and `threePt:t` lighting, donut/ellipse/rect/roundRect, white contour,
wide/tall aspect ratios, a non-identity group, and the light rotation plus implicit defaults
observed in the local `model-platform` corpus. Its real-property sentinel also retains the coexisting picture
outline and outer shadow so the 3D effect is not tested in isolation from its actual container.
The twenty cases are one opt-out control, nine single-slide positive bevel cases, one three-slide
ellipse matrix, one five-slide donut endpoint/context matrix, one nine-slide donut
aspect/adjustment interpolation matrix, one six-slide omitted/explicit bevel-default matrix,
two six-slide camera-plane matrices, one three-slide
`perspectiveLeft` editable-text matrix, one four-slide `perspectiveRight` picture matrix, one
six-slide `perspectiveRelaxedModerately` custom-geometry matrix, and one eight-slide native-verified
`perspectiveLeft` picture-group matrix. The first
camera-plane row covers identity and 20°/30° rotated `orthographicFront`, then square, wide, tall,
theme-fill, and non-identity-group `perspectiveRelaxedModerately` rendering at the exact verified
120° field of view and camera rotation. The second proves scene-only implicit zero depth across
square/wide/tall solid planes, including the theme `effectRef=2` outer shadow on the projected
surface without filter clipping, and preserves square/wide/tall editable DOM text for the exact
`perspectiveContrastingRightFacing` tuple. The third camera matrix isolates the observed
`perspectiveLeft` camera at a 120-degree field of view with absent explicit rotation, `threePt:t`
lighting, no fill, `wrap="none"`, default top anchoring, and `spAutoFit` across square, wide, and
tall editable CJK/mixed-text planes. The fourth camera matrix preserves live PNG content under the
observed 95-degree `perspectiveRight` camera and implicit -20-degree longitude across square, wide,
tall, and real-corpus asymmetric-crop rows. The real-property slice is copied from the ignored local
corpus; the last three picture rows isolate horizontal, vertical, and combined nonnegative
`a:srcRect` crops against the existing no-crop control. The fifth camera matrix crosses one bounded
two-contour numeric line/cubic custom geometry over square, wide, and tall physical bounds with
explicit `#2F75B5` and `#FFFFFF` paint. It omits style, effects, and `a:sp3d` while retaining the
exact 120° field of view, camera rotation, and `threePt:t` light tuple. The group matrix
crosses square, wide, tall, and a nested real-corpus-like source-crop context against
scene-absent inverses. Its target has exactly two direct embedded stretch-filled rectangular
pictures, positive group/child extents, the exact `perspectiveLeft` 95-degree/25-degree-longitude
tuple, and no target effects, local transform, transformed ancestor, or ancestor 3D scene.
Coordinate-only ancestors remain eligible. The ellipse row spans square explicit paint, wide theme-reference paint,
and a tall ellipse under a non-identity group transform. The donut row spans the `0..50000`
adjustment bounds, the `25000` default, an adjusted wide theme-fill shape, and an adjusted grouped
tall shape. Together
they pin picture versus shape rendering, wide/tall extents, a non-identity parent group, contour
layering, stable repeated frames, unique SVG
effect IDs, distance-field texture readiness, no horizontal growth, picture-URL disposal, abort-safe
cleanup, and the flat fallback for an unsupported camera. The accepted support claim is limited to
the exact tuple in
`drawingml.shape.3d.top-bevel-contour`; a high aggregate score cannot broaden that registry scope.
An opt-in eight-case local matrix retains the original ellipse discovery probe and adds adjusted
donut, adjusted star, concave freeform, rotation, nested non-identity groups, glow interaction, and
an eleven-slide bottom-`relaxedInset` isolation matrix. The bottom-bevel rows compare flat versus full
scene tuples, implicit versus explicit 76200 EMU dimensions, material and light-rotation opt-outs,
live CJK text, a 5% alpha overlay, a `circle` neighbor, and square/wide/tall extents. Those cases use
the `oracle-local-shape3d-*` prefix, write metadata only below the ignored `oracle-runtime` directory,
and remain local evidence. Only the exact opaque bottom-front rows are consumed by the separately
bounded capability and native gate; the other local rows remain discovery evidence.
For the current macOS PowerPoint oracle, the implicit/explicit dimension rows, the explicit/omitted
light-rotation rows, and the `relaxedInset`/`circle` rows are byte-identical pairs. A matching
transparent flat control differs from the 5% alpha 3D row by at most one RGB level. The opaque
material opt-out remains intentionally distinct; this isolates the visible front-face response
from an invented bottom-edge geometry effect.
The CJK text matrix at IDs 0040-0055 covers square/no-wrap behavior, omitted and explicit autofit
modes, percentage and point line spacing, paragraph spacing, adjacent run spacing, centered text
inside a parent shape, and square/wide/tall `spAutoFit` growth. IDs 0052-0054 require native
PowerPoint and the renderer to retain the explicit 30 pt CJK run while growing the standalone text
box; ID 0055 is the inverse control where explicit horizontal and vertical overflow remain visible
and suppress shape growth. Browser coverage also checks that host `white-space` values cannot
change the result and that absolutely positioned siblings do not reflow.
Text IDs 0056-0059 cover color precedence independently from layout behavior: paragraph `defRPr`
`srgbClr` and `schemeClr` over a conflicting shape `fontRef`, an explicit run color over both, and
the inverse fallback to `fontRef` when local fills are absent. The cases span square, wide, and tall
containers and retain exact color values in their tracked OOXML metadata.
ID 0060 isolates styled soft breaks from the visible run's metrics and bullet color. ID 0061 is an
eleven-slide native tab-stop matrix covering leading and inline left tabs, multiple stops, bullets,
mixed-run tabs, the default interval, explicit center/right/decimal alignment, and a vertical East
Asian left tab. The vertical row uses a horizontal guide on the inline axis and is also guarded by
browser coordinate assertions for column centering and the 2-inch advance. Its RTL slide remains an
observation control.

```bash
cd test/e2e

# Generate all definitions and native ground truth.
.venv/bin/python scripts/generate_pypptx_cases.py

# Generate the focused text matrices. --case is repeatable and accepts exact names or globs.
.venv/bin/python scripts/generate_pypptx_cases.py \
  --case 'oracle-pypptx-text-00[456]*'

# Generate only the bounded static DrawingML 3D matrix.
.venv/bin/python scripts/generate_pypptx_cases.py \
  --case 'oracle-pypptx-shape3d-*'

# Generate the 28-case, 84-slide zero-adjustment flowchart matrix.
.venv/bin/python scripts/generate_pypptx_cases.py \
  --case 'oracle-pypptx-flowchart-*'

# Generate the isolated eight-case table matrix.
.venv/bin/python scripts/generate_pypptx_cases.py \
  --case 'oracle-pypptx-table-*'

# Generate the eight-case DrawingML/OMML formula matrix.
.venv/bin/python scripts/generate_pypptx_cases.py \
  --case 'oracle-pypptx-formula-*'

# Generate the ignored local 3D discovery matrix. Add --pptx-only without PowerPoint.
.venv/bin/python scripts/generate_pypptx_cases.py \
  --include-local-shape3d-matrix \
  --case 'oracle-local-shape3d-*'

# Package-only inspection on a host without PowerPoint.
.venv/bin/python scripts/generate_pypptx_cases.py \
  --pptx-only \
  --case 'oracle-pypptx-text-0044-*'
```

macOS PowerPoint exports PDF ground truth. Windows PowerPoint exports PDF and, by default,
per-slide PNG. The generator refreshes tracked case metadata even when cached local binaries are
reused and writes artifact fingerprints to
`reports/oracle-failures/pypptx-ground-truth.json`, including every available slide PNG.
The local discovery definitions default to `oracle-runtime/local-shape3d-cases/`; they never write
into tracked `oracle/cases-pypptx/` and do not change the 198-case default matrix.

The top-bevel capability also has a region-level lighting gate. After clean native API reports for
cases 0001-0012 and 0017-0018 have refreshed `reports/<case>_slide0_{pdf,html}.png`, run:

```bash
# Run from the repository root; report paths are repository-relative.
test/e2e/.venv/bin/python test/e2e/scripts/shape3d_bevel_metrics.py \
  --case-report test/e2e/reports/capability-loop/current-<revision>-oracle-pypptx-shape3d-0001-flat-optout.json \
  --case-report test/e2e/reports/capability-loop/current-<revision>-oracle-pypptx-shape3d-0002-picture-rect-circle-bevel.json \
  --case-report test/e2e/reports/capability-loop/current-<revision>-oracle-pypptx-shape3d-0003-roundrect-bevel-contour.json \
  --case-report test/e2e/reports/capability-loop/current-<revision>-oracle-pypptx-shape3d-0004-wide-bevel.json \
  --case-report test/e2e/reports/capability-loop/current-<revision>-oracle-pypptx-shape3d-0005-tall-bevel.json \
  --case-report test/e2e/reports/capability-loop/current-<revision>-oracle-pypptx-shape3d-0006-grouped-bevel.json \
  --case-report test/e2e/reports/capability-loop/current-<revision>-oracle-pypptx-shape3d-0007-real-picture-bevel-slice.json \
  --case-report test/e2e/reports/capability-loop/current-<revision>-oracle-pypptx-shape3d-0008-picture-horizontal-crop-bevel.json \
  --case-report test/e2e/reports/capability-loop/current-<revision>-oracle-pypptx-shape3d-0009-picture-vertical-crop-bevel.json \
  --case-report test/e2e/reports/capability-loop/current-<revision>-oracle-pypptx-shape3d-0010-picture-asymmetric-crop-bevel.json \
  --case-report test/e2e/reports/capability-loop/current-<revision>-oracle-pypptx-shape3d-0011-ellipse-circle-bevel-matrix.json \
  --case-report test/e2e/reports/capability-loop/current-<revision>-oracle-pypptx-shape3d-0012-donut-circle-bevel-adjustment-matrix.json \
  --case-report test/e2e/reports/capability-loop/current-<revision>-oracle-pypptx-shape3d-0017-default-top-bevel-dimensions-matrix.json \
  --case-report test/e2e/reports/capability-loop/current-<revision>-oracle-pypptx-shape3d-0018-donut-shadow-interpolation-matrix.json \
  --out test/e2e/reports/capability-loop/shape3d-bevel-local-<revision>.json
```

The metric extracts shape bounds, group transforms, ellipse contours, round-rectangle corners, and
donut inner/outer radii independently from source OOXML, then compares luminance only in the inward
bevel ring. Unknown silhouettes and rotated shapes fail as unevaluable instead of being scored with
a rectangular mask. The schema-v8 gate requires a general field score of at least `0.60`, dynamic
range ratio `0.85`, shadow-amplitude ratio `0.85`, and candidate/native shadow overshoot no greater
than `1.05`; solid donut faces use the tighter native-backed `1.01` peak ceiling and a `1.05`
ceiling for mean negative shadow energy. They also cap non-cancelling per-pixel local shadow excess
at `0.30` of native mean shadow energy. Every salient 30° sector along both donut contours, where
the native mean shadow is at least 3 luma, must remain at or below `1.60` candidate/native shadow
energy. This catches a concentrated dark lobe that total energy and per-pixel averages can hide.
Solid-shape highlight
amplitude requires `0.80`; picture lighting uses its separately verified `0.70` floor. Verified
`roundRect` corners also require `0.78`. The symmetric amplitude
ratios catch large weak or excessive lighting, while the directional ceiling rejects a smaller but
visible over-dark edge even when correlation leaves the composite score high. A zero-thickness
donut stays in the full-slide native gate because it has no interior bevel surface. A band below
four output pixels is explicitly recorded as
resolution-limited and remains covered by full-slide and manual gates rather than guessed from too
few pixels. The flat control has no applicable region. This local metric complements the full-page
SSIM/color-histogram gate; it does not replace it. Each native API slide row fingerprints the exact
reference and HTML rasters. The metric generator rejects a stale or replaced raster before scoring.
Case 0017 additionally declares three implicit/explicit slide pairs. The same report requires exact
reference-raster equality and exact candidate-raster equality for every pair, so a parser-default
regression cannot hide behind a high full-slide score.
Case 0018 keeps paint, container, camera, light, and bevel fixed while crossing three intermediate
aspect ratios with three donut adjustments. All nine rows must pass both the full-slide and
schema-v8 bevel-local gates.
It is also sensitive to material-specific lighting: the tracked picture case must retain the native
top/right shadow and bottom/left relief instead of passing only because its rectangular bounds match.

The camera-plane capability has a separate local gate. After all clean camera case reports have
refreshed the native and HTML rasters, run:

```bash
test/e2e/.venv/bin/python test/e2e/scripts/shape3d_camera_metrics.py \
  --case-report test/e2e/reports/capability-loop/current-<revision>-oracle-pypptx-shape3d-0013-camera-projection-matrix.json \
  --case-report test/e2e/reports/capability-loop/current-<revision>-oracle-pypptx-shape3d-0014-scene-only-plane-matrix.json \
  --case-report test/e2e/reports/capability-loop/current-<revision>-oracle-pypptx-shape3d-0015-perspective-left-text-plane-matrix.json \
  --case-report test/e2e/reports/capability-loop/current-<revision>-oracle-pypptx-shape3d-0016-perspective-right-picture-plane-matrix.json \
  --case-report test/e2e/reports/capability-loop/current-<revision>-oracle-pypptx-shape3d-0019-perspective-custom-geometry-plane-matrix.json \
  --out test/e2e/reports/capability-loop/shape3d-camera-local-<revision>.json
```

Include the native group matrix in the same report:
`--case-report test/e2e/reports/capability-loop/current-<revision>-oracle-pypptx-shape3d-0020-perspective-left-picture-group-matrix.json`.

Run the bounded bottom-front capability against its own clean native report:

```bash
test/e2e/.venv/bin/python test/e2e/scripts/shape3d_camera_metrics.py \
  --case-report test/e2e/reports/capability-loop/current-<revision>-oracle-local-shape3d-0008-bottom-relaxed-inset-matrix.json \
  --out test/e2e/reports/capability-loop/shape3d-bottom-front-local-<revision>.json
```

This schema-v7 gate derives each applicable modality from source OOXML and binds both raster hashes
to the native API report. Solid rows extract the largest saturated four-corner plane independently
from renderer DOM bounds: normalized corner score must be at least `0.98`, material-band color
score at least `0.97`, and a measurable native gradient requires at least `0.65` range ratio and
`0.95` direction cosine. When source OOXML selects the exact verified theme outer shadow, the native
reference must expose enough external shadow energy to be measurable; the candidate then requires
at least `0.70` symmetric energy ratio and `0.95` direction cosine. This rejects a visible but
materially weaker shadow instead of treating mere presence as fidelity. Live-text rows use a
resolution-normalized raster tolerance of `0.25%`, then require bidirectional foreground F1 `0.90`,
tolerant projected-bounds score `0.98`, and grayscale ink-density retention `0.90`. Picture rows are
inverse-projected to `384×384` and require corner score `0.98`, rectified color score `0.95`, and
tolerant edge F1 `0.90`; this makes crop/content errors visible even when the outer quadrilateral is
correct. Custom-geometry rows use the same `0.25%` raster tolerance and require foreground F1
`0.95`, bounds score `0.98`, candidate/reference foreground area ratio `0.90`, centroid score
`0.99`, and color score `0.98`. Raw IoU and raw bounds stay in the report for diagnosis. The verifier recomputes pass
status and derived ratios from fixed thresholds. A `picture-group` row uses the picture corner,
rectified-color, edge, and crop-mutation thresholds for the composed child surface. Schema-v6
reports remain accepted for existing modalities. It also requires deterministic mutation controls
to fail: exterior-shadow erasure on every measurable shadow row and a 12% left crop plus rescale on
every rectified picture row. Bottom-front rows require normalized corner score `0.98`, mean RGB
error no greater than `1.0` across three interior material bands, and rejection after restoring the
source flat `#4472C4` fill. Every custom row is also vertically squashed to 20% height and must fail
its silhouette gate. A corpus row whose local metric cannot detect its matching mutation is
not promotable. Callers cannot self-attest any modality.

PowerPoint automation on macOS needs an available interactive session. Error `-9074` can mean the
session is locked, PowerPoint is waiting for a dialog, or the fixed staged input is still open from
an interrupted run; it is an environment failure, not a renderer result. Ordinary exports stage
`_pptx-input.pptx` and `_pptx-output.pdf` in the ignored `testdata/oracle-runtime` directory; grant
PowerPoint access to that directory once. Each script normalizes macOS's `/private/tmp` firmlink to
the `/tmp` spelling returned by PowerPoint, matches the opened file by exact `full name`, never
exports or closes `active presentation`, and closes only the matched object on success or failure.
If PowerPoint cannot compile the file-backed export script (`-2741`), the exporter retries the same
exact-path lifecycle as inline AppleScript within the same attempt. Macro names are qualified with
their loaded `.pptm` filename because an unqualified name can return PowerPoint error `-18` when
another deck is open. The 120-second export and macro timeouts stop without retry and tell the
operator to check the unlock state and any pending **Grant File Access** or macro-security dialog.
Stale output PDFs are removed before each attempt. AppleScript stderr remains in the reported
error.

The native macro smoke uses `ExportSmartArtLayouts_ToFile` with a fixed runtime output and verifies
that the resulting catalog is non-empty. Run it only on a host where the repository macro host is
trusted:

```bash
cd test/e2e
.venv/bin/python -m pytest -q test_oracle_macro_pipeline.py
```

### Reproducing Fonts in Oracle Runs

Text metrics are only comparable when the browser can use the same font faces as PowerPoint.
Create an ignored profile under `test/e2e/testdata/` using
`test/e2e/oracle/font-profile.example.json` as the format. Each `path` is relative to the testdata
root; it may be an ignored symlink to a locally installed and properly licensed font. Do not copy
or commit proprietary font files.

Start the API with an explicit code server, browser channel, and profile:

```bash
# Terminal 1, project root
pnpm dev --host 127.0.0.1 --port 5183 --strictPort

# Terminal 2, test/e2e
PPTX_E2E_VITE_SERVER_URL=http://127.0.0.1:5183 \
PPTX_E2E_FONT_PROFILE=font-profiles/local-office-fonts.json \
PPTX_E2E_BROWSER_CHANNEL=chrome \
.venv/bin/python server.py
```

`PPTX_E2E_API_PORT` can move the API from port 8080 when needed. The single-slide page accepts
the corresponding `fontProfile` query parameter and passes those faces to `renderSlide()` before
layout measurement.

Every `/api/evaluate/{case}` response includes `provenance` with:

- source PPTX and ground-truth kind, size, and SHA-256;
- renderer Git revision and tracked dirty state;
- OS/Python details, the actual browser version, and the raster capture profile;
- optional font-profile manifest and font-file hashes.

`scripts/run_all_shapes_eval.py` preserves this object in every `results[]` row. Compare or update
a baseline only when the input hashes and relevant runtime profile match; otherwise treat the
difference as an environment/corpus change and rerun before changing renderer code.
Regression comparison uses the resolved font-profile ID, ordered faces, descriptors, and font-file
fingerprints. It retains the raw manifest fingerprint for audit but ignores formatting-only changes
to that JSON file.

PDF references are rasterized at `PPTX_E2E_PDF_DPI` (150 by default). During `/api/evaluate`,
Playwright uses `deviceScaleFactor = PDF DPI / 96` so the browser and PDF are sampled at the same
pixel density before SSIM and foreground metrics run. Direct PowerPoint PNG references retain a
device scale factor of `1`; every per-slide row and the run provenance record the selected value.
Changing the PDF DPI or capture scale therefore creates a different regression environment rather
than an apparent renderer improvement.

### Manual Review

For cases that pass automated metrics but have visual nuances:

1. Open `/test/pages/e2e-compare.html`
2. Review side-by-side PDF vs HTML renders with SSIM scores
3. Save verdicts per slide card
4. Verdicts persist in `reports/oracle-failures/manual-review.json`

## Visual Evaluation Metrics

The comparison pipeline uses a **two-layer metric system**. This design was arrived at empirically by testing many metrics against 300+ shape cases.

### Pass/Fail Layer (automated)

These two metrics determine automated pass/fail for this oracle evaluator. Their thresholds are regression gates, not proof that every feature is correct or that the corpus has no failures:

| Metric            | Range   | Threshold | What it catches                                                                 |
| ----------------- | ------- | --------- | ------------------------------------------------------------------------------- |
| `ssim`            | 0-1     | >= 0.95   | Structural errors: wrong geometry, missing elements, layout shifts              |
| `color_hist_corr` | -1 to 1 | >= 0.80   | Color errors: wrong scheme resolution, gradient bugs, tint/shade misapplication |

### Warning Layer (human review)

| Condition                       | Flag                | Purpose                                                     |
| ------------------------------- | ------------------- | ----------------------------------------------------------- |
| Any visible slide `ssim < 0.99` | `needsReview: true` | Flags near-misses for human inspection without auto-failing |

The case-level flag is the union of visible per-slide review flags, evaluation errors, and detected
oracle page mismatches. A high multi-slide average cannot hide one page that needs inspection.

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
- **SSIM and color histogram are complementary signals.** Color histogram adds sensitivity to pure-color errors, while both can miss localized semantic defects, incorrect branch selection, or lifecycle behavior. Use source-based assertions, decoded media/Canvas checks, and native visual inspection for those boundaries.

Previously evaluated but rejected: `edge_iou` (too noisy), `fg_area_ratio` (redundant), `fg_centroid_distance` (no observed failures), patch-based SSIM (can't detect < 1% area defects), LPIPS (heavy PyTorch dependency, marginal improvement).

### Color Histogram Correlation Details

- Computed over H, S, V channels independently (30 H bins, 32 S/V bins), then averaged
- Only foreground pixels (gray < 245) are compared, ignoring white backgrounds
- Each channel tolerates a one-bin displacement before correlation (circular for hue, clamped for
  saturation/value), preventing a small color quantization shift from becoming a false mismatch
- Sparse foreground in both images (< 1.5% coverage) returns 1.0 to avoid anti-aliasing noise on
  thin-stroke shapes
- When only one image has foreground, it remains a mismatch unless that image contains at most
  0.01% black-equivalent ink, which covers visually blank PDF anti-alias residue without hiding a
  meaningful missing line
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

### Spec-Compiled Geometry Source Gate

The geometry source contract is independent of local PowerPoint ground-truth files:

```bash
pnpm geometry:generate  # regenerate after an intentional source or contract change
pnpm geometry:check     # validate source hashes and fail on generated drift
pnpm exec vitest run \
  test/unit/build/ooxmlGeometrySource.test.ts \
  test/unit/build/ooxmlGeometryIr.test.ts \
  test/unit/build/ooxmlGeometryPathEmitter.test.ts \
  test/unit/shapes/ooxmlGeometryRuntime.test.ts
```

`geometry:check` validates the unchanged ECMA archive and nested XML hashes, all 17 formula
operators and arities, document-order guide references, DrawingML path namespaces and
command structure, duplicate-source handling, source reconciliation, deterministic catalog
bytes, finite IR evaluation, and deterministic SVG emission. It runs in CI before the package
build.

The generated catalog is evidence about source coverage; it is not renderer acceptance. The
production subset is a separate generated module and currently contains 29 definitions: all 28
zero-adjustment flowcharts in shape IDs 61-88 (20 single-path and eight ordered three-path
definitions), plus bounded-adjustment `donut`.
Before adding a definition, add tests for formula semantics and path topology plus browser checks
for both ordinary shapes and picture clips. Then compare square, wide, and tall shapes and
relevant adjustment bounds against native PowerPoint ground truth. Group, flip, rotation,
line-like, and multi-path cases require their own coverage when applicable.

The validator rejects active source overrides. Before enabling one, add an offline check that reads the
alternative source bytes, verifies their SHA-256 and requested shape, and resolves an
existing native PowerPoint oracle record. Do not update a visual baseline merely to make a
generated definition pass.

## Capability Loop Contract

The capability loop turns corpus observations into one reviewable renderer cohort at a time. Its
tracked inputs are `test/e2e/oracle/capabilities.json` and
`test/e2e/oracle/capability-acceptance.json`. Its local inventory, ledger, ranking, work packet, and
verification files stay ignored under `test/e2e/reports/capability-loop/`.

```bash
# CI-safe contract check; requires no private corpus or PowerPoint installation
pnpm capability:check

# Scan the default ignored testdata/cases corpus
pnpm capability:inventory

# Add more local corpora, classify generated fixtures, and attach an optional issue snapshot
python3 test/e2e/scripts/run_capability_loop.py inventory \
  --corpus test/e2e/testdata/cases \
  --corpus test/e2e/testdata/windows-cases \
  --validation-alias 'corpus-0/*oracle-*' \
  --validation-alias 'corpus-1/*oracle-*' \
  --issues /path/to/open-issues.json
```

The scanner reads ZIP members in memory without extracting them. It rejects path traversal, more
than 4,000 entries, a decoded entry over 32 MiB, or more than 256 MiB decoded in total. Identical
PPTX bytes count once for ranking while all corpus aliases remain available in the ignored report.
Selectors match XML namespace, local name, optional attribute predicates, and either an optional
direct parent or exact root-to-parent suffix. The path-scoped outer-shadow selector therefore does
not count picture, text-run, group-level, or theme effect lists. Similarly named elements from
unrelated namespaces do not count. A rejected package is isolated and recorded with
a stable reason so the rest of a private corpus still produces evidence; add `--fail-on-rejected`
when any rejected package must also make the command exit nonzero.

For the default `test/e2e/testdata/cases` corpus, aliases containing `oracle-` are validation
fixtures and every other alias is representative. This keeps generated shape, SmartArt, text, and
effect matrices available as coverage evidence without letting their volume raise the demand rank
of the capability that generated them. Custom scans can instead provide either repeatable
`--representative-alias` globs (unmatched packages become validation) or repeatable
`--validation-alias` globs (unmatched packages become representative). The modes are mutually
exclusive. Byte-identical packages are still counted once; if their aliases span both roles, the
representative alias wins.

Ranking is lexicographic and retains every input dimension: impact, currently reproduced issues,
unique representative packages, all unique observed packages, failure type, native-oracle
readiness, dependency depth, then capability ID. It does not generate a weighted quality
percentage. The registry defaults `planningMode` to `ranked`; an explicit `observation-only` row
remains visible in inventory and the ledger but cannot enter the executable queue or produce a work
packet. This is the required mode for a broad residual selector that overlaps narrower bounded
capabilities. `unknown`, stable `verified`, and externally `blocked` rows likewise remain visible in
the ledger but do not enter the executable queue. An open issue only
contributes demand after the issue snapshot explicitly records a current reproduction.
Selecting anything other than the first executable row requires `work-packet --selection-reason`;
the resulting packet records both the original rank and the reason, such as a previously committed
release goal.

Normalize committed, clean native API results before promotion:

```bash
python3 test/e2e/scripts/run_capability_loop.py verify \
  --capability drawingml.shape.geometry.adjustment.donut \
  --case-report test/e2e/reports/capability-loop/donut-thin-native.json \
  --case-report test/e2e/reports/capability-loop/donut-thick-native.json \
  --baseline-report test/e2e/reports/capability-loop/donut-thin-baseline.json \
  --baseline-report test/e2e/reports/capability-loop/donut-thick-baseline.json \
  --oracle powerpoint-macos \
  --passed-gate source --passed-gate structural --passed-gate unit \
  --passed-gate browser --passed-gate docs
```

`verify` checks one clean renderer revision, exact case/input/ground-truth hashes, API runtime
errors, PowerPoint quality status, matching baseline case IDs, and the 0.02 SSIM regression budget.
Regression baselines must use one earlier clean revision with identical source, ground-truth, and
runtime-environment fingerprints.
It derives `native-powerpoint`, `manual-visual`, and `regression`; callers cannot self-attest those
gates. A capability that requires `bevel-local` must also supply `--bevel-report`, one that requires
`camera-local` must supply `--camera-report`, and one that requires `shadow-local` must supply
`--shadow-report`; a capability that requires `reflection-local` must supply
`--reflection-report`. Verification derives a local gate only
when the clean revision, exact case set, source hashes, ground-truth hashes, native per-slide raster
hashes, on-disk raster hashes, thresholds, and every local result match. `--passed-gate` records
separate checks that have already run and does not execute them. A `needsReview` case requires
`--manual-verdict CASE_ID=passed` (or `accepted`).

`accept` records a completed verification after the capability registry says `renderMode=native`
and the candidate implementation is committed. The command requires a clean tracked tree, matching
HEAD, source and ground-truth SHA-256 values, every declared gate, no skipped/runtime-failed cases,
and an accepted manual verdict for every review row. It writes a sanitized historical record
atomically and never changes GitHub issues or visual baselines. That record does not prove later
revisions.

The bounded ordinary-shape outer-shadow lane uses one eight-slide case. After evaluating it on a
clean committed revision, generate and bind its local report:

```bash
test/e2e/.venv/bin/python test/e2e/scripts/outer_shadow_metrics.py \
  --case-report test/e2e/reports/capability-loop/outer-shadow-current.json \
  --out test/e2e/reports/capability-loop/outer-shadow-local-current.json

python3 test/e2e/scripts/run_capability_loop.py verify \
  --capability drawingml.shape.effect.outer-shadow \
  --case-report test/e2e/reports/capability-loop/outer-shadow-current.json \
  --baseline-report test/e2e/reports/capability-loop/outer-shadow-baseline.json \
  --shadow-report test/e2e/reports/capability-loop/outer-shadow-local-current.json \
  --oracle powerpoint-macos \
  --passed-gate source --passed-gate structural --passed-gate unit \
  --passed-gate browser --passed-gate performance --passed-gate package \
  --passed-gate package-size --passed-gate typecheck --passed-gate lint \
  --passed-gate build --passed-gate docs
```

The local metric derives the relevant slides from the exact ordinary-shape XML path. It measures an
exterior ring for native/candidate energy ratio, overshoot, cosine, binary IoU, normalized error,
and centroid displacement. Every measurable positive row must also fail after its candidate shadow
is erased. The inverse row caps invented darkness. Reports with different revisions, inputs,
ground truth, raster hashes, thresholds, or visible slide sets are rejected. Promotion applies to
the seven declared positive rows; the parameter-value lists are an evidence index, not a Cartesian
product of supported combinations.

The bounded ordinary-shape reflection lane uses the seven-slide
`oracle-pypptx-shape-effect-0002-reflection-matrix`. After evaluating it on a clean committed
revision, generate and bind its local report:

```bash
test/e2e/.venv/bin/python test/e2e/scripts/reflection_metrics.py \
  --case-report test/e2e/reports/capability-loop/reflection-current.json \
  --out test/e2e/reports/capability-loop/reflection-local-current.json

python3 test/e2e/scripts/run_capability_loop.py verify \
  --capability drawingml.shape.effect.reflection \
  --case-report test/e2e/reports/capability-loop/reflection-current.json \
  --baseline-report test/e2e/reports/capability-loop/reflection-baseline.json \
  --reflection-report test/e2e/reports/capability-loop/reflection-local-current.json \
  --oracle powerpoint-macos \
  --passed-gate source --passed-gate structural --passed-gate unit \
  --passed-gate browser --passed-gate performance --passed-gate package \
  --passed-gate package-size --passed-gate typecheck --passed-gate lint \
  --passed-gate build --passed-gate docs
```

The report derives exactly the positive direct-shape reflection slides from OOXML and binds the
native and browser raster hashes. It compares reflection density, symmetric energy retention,
overshoot, field cosine/IoU/error, and centroid displacement, then erases each candidate reflection
region and requires the mutation to fail. The full-slide native report covers the inverse control.
Only the six declared positive rows are promoted; the one-slide no-fill live-text case remains
discovery evidence until it has its own local metric and accepted matrix.

DrawingML shape 3D, chart 3D, Office 2017 embedded models, and PresentationML animation are separate
capability IDs. A verified flat 2D fallback in one lane cannot promote native behavior in another.
The `drawingml.shape.3d.top-bevel-contour` cohort promotes only `orthographicFront` circular top bevels on opaque
solid `donut`/`ellipse`/`rect`/`roundRect` shapes and rectangular stretch-filled pictures, with absent or bounded
nonnegative `a:srcRect` crops, the documented `twoPt:t`/`threePt:t` lighting tuple, zero extrusion
and `z`, no scene backdrop or extrusion color, an optional contour with a resolvable color, and an
optional outer shadow. The visual gate checks
that `bevelT@w` controls the inward edge width,
`bevelT@h` changes contrast rather than geometry, directional lighting remains distinct, and rounded
corners follow continuous silhouette normals. The default-value matrix additionally requires
omitted `prst`, `w`, or `h` to match explicit `circle`/76200-EMU encodings exactly. The picture row additionally verifies the lower
relative-overlay response and native `twoPt:t` edge ordering. Verification
uses cases 0001-0012 plus 0017-0018 and the same fourteen earlier-revision baselines,
the derived `bevel-local` report, explicit manual verdicts for review rows, and the `source`,
`structural`, `unit`, `browser`, `performance`, `package-size`, and `docs` caller-run gates.

The separate `drawingml.shape.3d.camera-projected-plane` cohort uses cases 0013-0016, 0019, and 0020. It promotes
exact zero-depth solid rectangles, two scene-only no-fill live-text tuples, and one live-picture
tuple with absent or bounded nonnegative source crop. It also promotes one standalone custom-path
family with a `1000×1000` coordinate space, identity text rectangle, at least two closed numeric
`moveTo`/`lnTo`/`cubicBezTo` contours, the three exact physical bounds, and explicit blue/white paint
declared in the registry. All modalities exclude local transform, backdrop,
nonzero `z`, explicit effect lists, bevel, contour, extrusion color, and material. The scene-only
solid row retains the exact theme outer-shadow style; the text rows exclude `p:style`, vertical text,
independent bounds, and
local body properties outside the registry's `wrap`, anchor, and autofit tuples. Its exact cameras, paint values,
aspect ratios, container rows, and implicit-depth semantics are declared in the registry. The
picture row additionally excludes visible outlines, non-rectangular geometry, `a:fillRect`, tiles,
style references, picture background fills, blip effects, and degenerate crops. The group row
requires exactly two direct embedded stretch-filled rectangular pictures, positive group and child
extents, the exact `perspectiveLeft` 95-degree/25-degree-longitude tuple, and no target effects,
local transform, transformed/effect-bearing ancestor, or ancestor 3D scene. Verification uses
all earlier/current report pairs plus the derived schema-v7 `camera-local`
plane/custom/text/picture/picture-group report
and the same caller-run gate classes. The broad
`drawingml.shape.3d.scene` fallback remains in inventory as a conservative `observation-only`
residual, so observing a verified narrow tuple cannot hide unimplemented scene values or make the
overlapping umbrella itself the next work packet.

`drawingml.text.3d.scene` is also `observation-only`. Its current representative hit has an empty
text body, so raw `a:bodyPr/a:scene3d` presence cannot be treated as visible renderer demand. A
future text-3D implementation starts by registering a bounded visible-text cohort.

Case 0020 supplies the native group evidence: square/wide/tall and nested source-crop positives are
paired with scene-absent inverses. Group reflection composition remains browser/real-corpus
diagnostic evidence and is intentionally outside the promoted native matrix.

The separate `drawingml.shape.3d.bottom-bevel-front-material` cohort promotes only the exact
standalone opaque rectangle rows declared in the registry: default-size `relaxedInset`/`circle`
bottom bevel, `orthographicFront`, bounded `threePt:t` rotation, zero depth, `dkEdge` or implicit
material, and the three verified aspect ratios. It retains live centered text, emits a uniform
native front-face color, draws no bottom rim, and requires the schema-v7 bottom-material modality
plus its restored-flat-fill mutation.

Other perspective and arbitrary rotations, nonzero extrusion, materials and bottom bevels outside
that exact cohort, tiled pictures,
negative or degenerate source crops, other paint/effect combinations, and other shape or picture
presets, custom-path commands/coordinates/bounds outside the declared profile, and guided custom
geometry remain flat fallbacks. Opt-in local probes for these contexts do not promote the public
support boundary.

## Chart Fix Protocol

Chart rendering is validated at two levels:

1. Add focused unit tests in `test/unit/renderer/ChartRenderer.test.ts` for OOXML
   semantics such as stacking mode, axis orientation, per-point data labels,
   chart color styles, legend data, and combo-axis wiring.
2. Run targeted oracle comparisons through the E2E API or pytest. Use
   `--testdata-source=windows` for Windows-generated chart oracle cases, which
   include many Office chart defaults not present in lightweight generated decks.

The 21-case python-pptx matrix covers column/bar, line/area, pie/doughnut, scatter, radar, bubble,
and stock families. Treat the broad runtime as approximate until each family passes its native
gate. Diagnose Cartesian plot area, axes, labels, and legends separately before changing series
geometry or data parsing. The Cartesian automatic-layout matrix keeps explicit plot layouts and
top/bottom legend reservations as opt-outs, and covers compact columns, zero-crossing category
labels, horizontal bars, and right-side line/area legends. A whole-slide score is supporting
evidence only; semantic assertions and plot-region inspection decide whether a layout change is
acceptable.

For an eligible single-chart column, bar, line, or area slide, `/api/evaluate/{case}` adds
`perSlide[].cartesianChart`. This local evidence is deliberately independent of the full-slide
pass/fail result. The profile follows presentation order and resolves both the chart relationship
and chart-frame transform. Analysis stays inside that frame. The reference must have one to eight
series with chromatic ink; both rasters must expose a stable neutral axis/grid field and either a
neutral or stable solid plot background. Combo charts, grouped or unresolved chart frames, larger
series sets, neutral-only series, unsupported chromatic backgrounds, charts without enough
parallel grid evidence, and pages with an oracle mapping mismatch return `evaluable: false`
instead of silently passing.

The bounded local gate requires all of the following:

| Signal                                          | Column/bar/area |     Line | Failure protected against                       |
| ----------------------------------------------- | --------------: | -------: | ----------------------------------------------- |
| Maximum plot-side error / shorter raster side   |         <= 0.01 |  <= 0.01 | Shifted or resized plot area                    |
| Tolerant chromatic-series IoU                   |         >= 0.90 |  >= 0.65 | Missing or displaced bars, areas, or thin lines |
| Series-ink area ratio                           |         >= 0.88 |  >= 0.88 | Missing or overdrawn data ink                   |
| Series Chamfer score                            |        >= 0.995 | >= 0.995 | Local contour/path displacement                 |
| Series centroid distance                        |        <= 0.005 | <= 0.005 | Whole-series translation                        |
| Reference pixels with candidate ink within 3 px |         >= 0.95 |  >= 0.95 | Sparse/missing candidate series                 |
| Mean normalized Lab distance                    |         <= 0.12 |  <= 0.12 | Wrong series colors                             |

The candidate series-mask erasure sanity check must also turn the series gate from pass to fail.
Plot, value-axis, category-axis, and right-legend SSIM values remain diagnostics because a mostly
blank region can otherwise produce a misleading score. Source/model assertions still decide
whether series, categories, values, and chart semantics survived parsing; the aggregate ink gate
does not prove every small series independently. A local pass supports a
user-usable assessment for this bounded matrix; it does not promote the broad 2D chart capability
from `approximate` or suppress an existing full-slide review flag.

Formula verification has two distinct gates. MCE fallback tests prove that an unsupported
`a14:m` equation retains its package-authored `p:sp` or `p:graphicFrame` fallback. Direct support
uses an eight-case native PowerPoint matrix spanning inline runs, fractions, radicals,
subscript/superscript, delimiters, n-ary summation, a 2x2 matrix, and a function. It also requires
structural and browser checks for the corresponding Presentation MathML tree; a fallback-only pass
does not satisfy that gate. Global SSIM can remain high when sparse formula ink is topologically
wrong, so any low-foreground-overlap warning sets `needsReview=true` and blocks unattended
promotion. The current direct subset is `approximate`: supported topology is usable, while native
font outlines, operator sizing, and per-token rich OMML styling remain outside its fidelity claim.

Current chart 3D support is intentionally a 2D fallback for render continuity.
Do not treat `surface3DChart` or 3D perspective/depth mismatches as fixed unless
there is a real 3D rendering implementation and corresponding oracle coverage.

## Test Pages

| Page                                 | Purpose                                                        |
| ------------------------------------ | -------------------------------------------------------------- |
| `/test/pages/index.html`             | Upload preview with model search and lazy thumbnail navigation |
| `/test/pages/render-slide.html`      | Single slide at native resolution                              |
| `/test/pages/e2e-compare.html`       | E2E dashboard with SSIM scores                                 |
| `/test/pages/compare-renderers.html` | Renderer-to-renderer comparison                                |
| `/test/pages/export.html`            | Model JSON tree viewer                                         |

URL params for list rendering performance: `listStrategy`, `listBatchSize`, `windowedInitialSlides`, `windowedOverscanViewport`.

## Contribution Requirement

For behavior changes:

- Add or update at least one relevant test.
- Keep existing test suite green before opening PR.
- For shape geometry changes, run the baseline evaluation on affected cases.
