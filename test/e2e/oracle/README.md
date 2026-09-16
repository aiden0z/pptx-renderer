# PowerPoint Oracle E2E Plan

This directory contains the local-macOS PowerPoint oracle pipeline used to drive renderer improvements.

## Capability Loop

The oracle has a tracked capability contract in `capabilities.json` and one sanitized historical
verification record per capability in `capability-acceptance.json`. The loop separates intended
render mode, planning mode, and current evidence state. A public `supported` claim requires a
bounded `native` capability and a passing report for the current Git revision.

```bash
# From the repository root
pnpm capability:check
pnpm capability:inventory
pnpm verify:plan -- --base HEAD^
pnpm verify:affected -- --base HEAD^

# Inspect all commands
python3 test/e2e/scripts/run_capability_loop.py --help
```

`capability_contract.py`, `capability_inventory.py`, `capability_evidence.py`,
`capability_verification.py`, and `capability_ranking.py` contain the domain rules.
`scripts/run_capability_loop.py` only composes them. Local outputs are written below
`test/e2e/reports/capability-loop/` and remain ignored because
they may refer to private case aliases. Tracked records keep stable case IDs and input SHA-256 values,
but remove absolute paths, usernames, free-form issue bodies, and private labels.

Selectors can constrain a direct parent or an exact root-to-direct-parent suffix. The latter keeps
features such as ordinary-shape `a:outerShdw` separate from identically named picture, text, group,
and theme effects while still matching shapes nested in groups. The two constraint forms are
mutually exclusive; see `CAPABILITY_SELECTOR_SCHEMA.md` for the tracked contract.

The default inventory limits match the renderer safety contract: 4,000 ZIP entries, 32 MiB per
decoded entry, and 256 MiB decoded in total. The default `testdata/cases` scan classifies aliases
containing `oracle-` as validation fixtures and all other aliases as representative documents.
Custom scans may use either repeatable `--representative-alias` or `--validation-alias` globs; the
two modes are mutually exclusive. Ranking counts byte-identical PPTX files once, gives a package
representative status when any of its aliases is representative, and ranks representative demand
before total validation volume. A dirty report, missing or changed inputs, a different Git revision, skipped required cases,
failed structural checks, or an unresolved manual-review row blocks promotion. Corpus scans isolate
and report rejected packages instead of losing all other observations; use `--fail-on-rejected` for
a strict nonzero exit after the report is written. Unknown, verified, and externally blocked rows
remain in the ledger for observation but are not selected as the next implementation cohort.
The default `planningMode` is `ranked`. Broad residual selectors must use `observation-only`; their
counts remain visible in the ledger, but they cannot enter the executable ranking or produce a work
packet. A new bounded capability must be registered before work on one of those residuals begins.
When a committed goal deliberately selects a lower-ranked cohort, pass `--selection-reason`; the
work packet records the override instead of silently hiding the global ordering.

`verify_affected.py` is the fast development-loop entry point. It uses exact or declared-glob
`affectedPaths` hints to select affected capabilities, de-duplicates their tracked unit and Python
tests, and reports the native case set from the latest historical record or the capability's
explicit `verificationCases` when its non-native render mode cannot have an acceptance record. It deliberately defers
browser and native runs for targeted plans so they execute once at pre-commit or pre-merge rather
than after every edit. Direct unit, Python, and browser test edits run their own gate without
expanding the production native scope; the shared python-pptx generator runs its focused generator
suite, while changed tracked case definitions still select their declared capability. Markdown-only
changes run formatting plus documentation and distribution contract tests. A `package.json` change
that modifies only the version runs build, package, publint, and size gates without invalidating
native evidence; any other package change remains global. Unclassified non-documentation paths fail
closed to the full TypeScript, Python, typecheck, and browser plan. Registry or unclassified
global runtime/control changes also retain every registered capability's native and local gates;
shared evaluation, provenance, evidence, and loop-control changes additionally run
`capability:check`. Local case artifacts must match the recorded source and selected
ground-truth hashes; case-name existence alone is insufficient. Missing recorded case sets
or exact local artifacts remain explicit gaps. Repeat `--case-report` with fresh per-case API
reports to receive complete commands for required `bevel-local`, `camera-local`, `shadow-local`, and
`reflection-local` gates.

`verify` consumes raw `/api/evaluate` JSON reports from one clean committed renderer revision. It
derives native-PowerPoint, manual-review, and regression status, including a matching baseline case
set, identical input/runtime provenance from an earlier revision, and the 0.02 SSIM budget. The
bounded top-bevel capability additionally requires a `--bevel-report`; the camera-plane and bounded
bottom-front capabilities require a `--camera-report`; bounded ordinary-shape outer shadows require
a `--shadow-report`; bounded ordinary-shape reflections require a `--reflection-report`. Their
derived `bevel-local`, `camera-local`, `shadow-local`, and `reflection-local` gates bind the exact
case set, source/ground-truth hashes, and per-slide raster hashes to the same clean revision and
current files. Other `--passed-gate` values only record checks already executed by the caller; they
are not run by the command. The API promotes any visible per-slide review flag to the case level, so
a strong average cannot hide a local mismatch. Review rows require an explicit case verdict.

Ordinary single-chart column, bar, line, and area evaluations also attach a scoped
`perSlide[].cartesianChart` diagnostic. It follows presentation order, limits detection to the
OOXML chart frame, and compares native/browser plot bounds plus aggregate chromatic series geometry
and color. A detected series-mask erasure sanity check guards the metric wiring. This signal helps
separate data-graphic usability from whole-page typography and whitespace differences. It does not
change the full-slide gate, replace source/model series assertions, or promote
`drawingml.chart.2d.common`; unsupported chart families, combo charts, grouped or unresolved chart
frames, more than eight series, neutral-only series, unsupported chromatic backgrounds, unstable
axis/grid fields, and mismatched oracle pages are explicitly unevaluable.

## Current Implemented Pieces

1. `powerpoint_oracle.py`
- `export_pptx_to_pdf_mac(...)`: stages a PPTX in a fixed runtime directory, opens that exact file
  in PowerPoint, and exports PDF with retry and a bounded timeout.
- `run_macro_export_mac(...)`: opens an exact macro host `.pptm`, runs a filename-qualified VBA
  macro, and optionally exports that same host.
- `run_macro_only_mac(...)`: runs a filename-qualified VBA macro when the macro writes its own
  fixed sink artifacts.

2. AppleScript runners
- `scripts/export_pptx_to_pdf.applescript`
- `scripts/run_macro_export.applescript`
- `scripts/run_macro_only.applescript`

3. Case compiler and metrics
- `case_compiler.py`: compiles JSON case files into a VBA-friendly line spec.
- `metrics.py`: visual metrics (`ssim`, `fg_iou`, `fg_iou_tolerant`, `chamfer_score`, `color_hist_corr`, `mae`) and quality gate. Pass/fail uses only `ssim ≥ 0.95` and `color_hist_corr ≥ 0.80`; the foreground color metric tolerates one HSV histogram bin and negligible visually blank PDF residue. Other metrics are diagnostic.
- `../scripts/shape3d_bevel_metrics.py`: source-OOXML-derived bevel-ring and round-corner lighting
  gate for the bounded static 3D cohort.
- `../scripts/shape3d_camera_metrics.py`: source-OOXML-derived projection, material, external-shadow,
  custom-path silhouette, live-text, rectified-picture, and bottom-front material gate for the
  bounded zero-depth cohorts.
- `../scripts/outer_shadow_metrics.py`: exact-path ordinary-shape exterior-shadow gate with energy,
  field, centroid, inverse, and erasure-sensitivity checks.
- `../scripts/reflection_metrics.py`: exact-path ordinary-shape reflection-region gate with energy,
  field, centroid, and erasure-sensitivity checks.
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
- `../test_pypptx_generator_cases.py`: locks the 28 zero-adjustment flowchart mappings and their
  84-slide square/wide/grouped-tall native matrix before PowerPoint export.

6. Reproducible evaluation provenance
- Every `/api/evaluate/{case}` result fingerprints the source PPTX and PDF/PNG ground truth.
- Reports also record the exact reference/HTML raster pair used for each visual metric row, the
  renderer Git state, actual browser version, PDF/browser capture density, and the configured local
  font-profile manifest/font hashes. PDF-backed evaluation captures Chromium at `PDF DPI / 96`
  (`150 / 96` by default); direct PNG oracles retain scale `1`.
- `font-profile.example.json` documents the ignored local profile format without distributing
  font binaries.

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
PPTX_ORACLE_MACRO_NAME=ExportSmartArtLayouts_ToFile
```

The smoke passes a fixed catalog path to the macro and verifies that at least one `Id|Name` row is
written. An override must follow the same one-output-path contract.

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

The python-pptx corpus includes `oracle-pypptx-flowchart-0061-*` through
`oracle-pypptx-flowchart-0088-*`. Each file has three slides covering explicit solid paint, a theme
style reference, and a non-identity group transform. Generate only that cohort with:

```bash
cd test/e2e
.venv/bin/python scripts/generate_pypptx_cases.py \
  --case 'oracle-pypptx-flowchart-*'
```

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

## Python-pptx Ground Truth Pipeline

A second pipeline uses `python-pptx` for PPTX creation and native PowerPoint automation for
ground-truth export. It defines 203 cases under `oracle/cases-pypptx/` with the
`oracle-pypptx-*` prefix:

- **Text** (61 cases): fonts, sizes, styles, alignment, colors, bullets, vertical text,
  placeholder inheritance, plus a 16-case CJK wrap/autofit/line-spacing interaction matrix whose
  final four cases cover square/wide/tall `spAutoFit` growth and explicit-overflow opt-out, and a
  four-case `defRPr`/`fontRef` color-precedence matrix with explicit-run and inverse controls. The
  final two cases isolate styled soft breaks and an eleven-slide native tab-stop matrix; explicit
  left/center/right/decimal tabs are verified for horizontal LTR text, while RTL and vertical rows
  remain observation controls
- **Shape adjustments** (31 cases): adjustment handles for roundRect, chevron, arrow, star, donut, cross, trapezoid, blockArc, bevel, triangle, pentagon, can, heart, moon, brace
- **Zero-adjustment flowcharts** (28 cases, 84 slides): presets in shape IDs 61-88, each with
  square explicit paint, wide theme-reference paint, and grouped-tall rendering
- **Ordinary-shape effects** (2 cases, 15 slides): a direct `a:outerShdw` matrix covering inverse,
  omitted defaults, offset/direction, centered 102% and top-right 92% uniform scale, wide/tall
  geometry, gradient paint, a single unrotated group at uniform 1.25 scale, and scheme-color
  modifiers; plus a direct `a:reflection` matrix covering one inverse and six bounded positive rows
  across shape geometry, aspect, solid/gradient paint, blur, fade, distance, and the same group scale
- **Text effects** (1 discovery case): live no-fill text reflection retained for comparison and
  future local-metric work; it is outside the verified ordinary-shape reflection capability
- **Static DrawingML 3D** (20 cases, 66 slides): flat picture opt-out plus a bounded
  `orthographicFront`/`twoPt:t|threePt:t`/circle-top-bevel matrix across picture, rect,
  roundRect, ellipse, contour, wide/tall, and grouped-shape contexts; the seventh case mirrors the
  `model-platform` picture tuple including light rotation, implicit defaults, outline, and outer
  shadow, cases 8-10 isolate horizontal, vertical, and combined `a:srcRect` crops, case 11
  covers square explicit, wide theme-reference, and grouped-tall ellipse rendering, and case 12
  covers donut adjustment bounds/default plus wide-theme and grouped-tall variants; case 13 adds
  identity and rotated orthographic camera controls plus square/wide/tall, explicit/theme, and
  grouped perspective zero-depth planes; case 14 adds scene-only square/wide/tall solid planes and
  square/wide/tall editable text planes for the exact contrasting-right camera tuple; case 15 adds
  square/wide/tall editable CJK/mixed-text planes for the observed `perspectiveLeft`, 120-degree
  field-of-view tuple with implicit camera rotation and default top anchoring; case 16 adds
  square/wide/tall PNG picture planes for the observed `perspectiveRight`, 95-degree field of view,
  including absent, horizontal, vertical, and real-corpus asymmetric source crops; case 17 pairs
  omitted top-bevel preset/width/height attributes with explicit `circle`/76200-EMU values; case 18
  crosses donut aspect ratios `0.75`, `1.25`, and `2.0` with adjustments `10000`, default `25000`,
  and `40000` while holding paint, container, camera, light, and bevel constant; case 19 crosses
  one bounded multi-contour numeric line/cubic custom path over square/wide/tall physical bounds
  with explicit blue/white paint and the exact `perspectiveRelaxedModerately` scene tuple; case 20
  adds an eight-slide native-verified `perspectiveLeft` two-picture group matrix across square/wide/tall,
  a nested real-corpus asymmetric source crop under a coordinate-only ancestor, and
  scene-absent inverses
- **Tables** (8 cases): default and conditional styles, banding, first/last columns,
  horizontal/vertical merges, variable grid sizes, cell margins and vertical anchors,
  CJK/mixed-script text, and direct solid/dashed/no-fill borders
- **Formulas** (8 cases): valid DrawingML `a14:m` choices and visible MCE shape fallbacks for
  inline runs, fractions, radicals, subscript/superscript, delimiters, n-ary summation, a 2x2
  matrix, and a function; recognized choices render as Presentation MathML while unknown OMML
  constructs must keep the authored fallback
- **Composites** (20 cases): multi-element layouts combining shapes, text, tables, charts, connectors, merged cells, vertical text, transparent overlaps, and scaled groups
- **Charts** (21 cases): column, bar, line, pie, doughnut, area, scatter, radar, bubble variants

Generate cases:

```bash
cd test/e2e
.venv/bin/python3 scripts/generate_pypptx_cases.py

# Focus one or more exact/glob patterns; this example selects text IDs 0040-0061.
.venv/bin/python3 scripts/generate_pypptx_cases.py \
  --case 'oracle-pypptx-text-00[456]*'

# Generate only the bounded ordinary-shape effect matrix.
.venv/bin/python3 scripts/generate_pypptx_cases.py \
  --case 'oracle-pypptx-shape-effect-*'

# Generate the separate live-text reflection discovery case.
.venv/bin/python3 scripts/generate_pypptx_cases.py \
  --case 'oracle-pypptx-text-effect-*'

# Generate only the bounded static DrawingML 3D matrix.
.venv/bin/python3 scripts/generate_pypptx_cases.py \
  --case 'oracle-pypptx-shape3d-*'

# Generate only the isolated native table matrix.
.venv/bin/python3 scripts/generate_pypptx_cases.py \
  --case 'oracle-pypptx-table-*'

# Generate only the native DrawingML/OMML formula matrix.
.venv/bin/python3 scripts/generate_pypptx_cases.py \
  --case 'oracle-pypptx-formula-*'

# Generate eight ignored discovery probes without widening the supported cohort.
.venv/bin/python3 scripts/generate_pypptx_cases.py \
  --include-local-shape3d-matrix \
  --case 'oracle-local-shape3d-*'
```

macOS exports PDF; Windows exports PDF plus optional per-slide PNG. `--pptx-only` works without
PowerPoint. On macOS each export is isolated to its staged input path and fixed runtime sink;
PowerPoint itself may remain running. The exporter normalizes macOS's `/private/tmp` firmlink to
the `/tmp` spelling reported by PowerPoint, then resolves and closes only the presentation whose
full path matches that staged input. Unrelated user presentations stay outside the export
lifecycle. The binary artifacts remain ignored under `testdata/`, while tracked case JSON records
coverage and font requirements. The generation report includes the selected patterns and SHA-256
fingerprints.

The opt-in `oracle-local-shape3d-*` matrix explores ellipse, adjusted donut/star, concave freeform,
shape rotation, nested group scaling, glow interaction, and an eleven-slide bottom-`relaxedInset`
matrix. The bottom-bevel rows isolate default encoding, material, light rotation, live CJK text,
transparent overlay composition plus an exact transparent flat control, a neighboring `circle`
preset, and aspect ratio. Its definition files
default to ignored `oracle-runtime/local-shape3d-cases/`, and its PPTX/PDF output remains under
ignored `testdata/`. These cases are discovery inputs; they do not alter the tracked 198-case matrix.
The current macOS PowerPoint oracle produces byte-identical native rasters for the implicit/explicit
dimension pair, the explicit/omitted light-rotation pair, and the `relaxedInset`/`circle` pair. The
opaque material opt-out is deliberately distinct. The exact standalone rectangle rows now back
`drawingml.shape.3d.bottom-bevel-front-material`, which models the uniform front response without
inventing a visible bottom edge. Other parent, paint, scene, and bottom-bevel combinations remain
discovery evidence.
The original one-slide ellipse and donut probes remain useful for preflight comparisons, while the
tracked three-slide ellipse, five-slide donut endpoint/context, and nine-slide donut interpolation
matrices bound the public
`drawingml.shape.3d.top-bevel-contour` claim. That tuple also requires an absent scene backdrop,
zero or omitted shape `z`, and no extrusion color.

After evaluating top-bevel cases 0001-0012 and 0017-0018, run `../scripts/shape3d_bevel_metrics.py` with one
`--case-report` per case. It reads the source OOXML to locate supported regions and builds independent
rect, roundRect, ellipse, and donut masks before comparing the native and HTML luminance fields only
inside the bevel ring. Unknown silhouettes and rotations fail as unevaluable instead of borrowing a
rectangular mask. It requires a general score of `0.60` and applies an additional `0.78` corner score
to `roundRect`. Schema v8 additionally requires dynamic-range ratio `0.85`, shadow-amplitude ratio
`0.85`, a directional candidate/native shadow ceiling of `1.05`, a tighter `1.01` ceiling for solid
donut peak amplitude, a `1.05` ceiling for solid-donut mean negative shadow energy, a `0.30` ceiling
for its non-cancelling per-pixel local shadow excess relative to native mean shadow energy, and a
`1.60` ceiling for candidate/native shadow energy in every salient 30° inner/outer contour sector
whose native mean shadow is at least 3 luma. Solid-shape highlight-amplitude ratio remains `0.80`,
with a separately verified `0.70` floor for pictures. The local and sector ceilings catch an
over-dark lobe even when a lighter sector keeps total energy and the composite correlation score
high. Zero-thickness
donuts remain covered by the full-slide gate; bands below four pixels are reported as
resolution-limited and remain subject to full-slide and manual checks. Pass the resulting JSON to
`run_capability_loop.py verify --bevel-report ...`; both commands verify the API and on-disk raster
hashes, and callers cannot self-attest `bevel-local`.
Case 0017 declares three `assertions.equivalentSlidePairs` rows across square rect, wide roundRect,
and tall ellipse. The gate requires byte-identical native references and byte-identical renderer
candidates for each omitted/explicit pair before the case can pass.
Case 0018 must retain all nine aspect/adjustment cross-product rows; it validates the donut shadow
profile between existing native anchors without adding theme, group, or camera variables.
For the native-backed grouped donut in case 0012, the bevel field is rasterized in the child's OOXML
coordinate space and then stretched with the group. This scope does not extend to grouped rectangles,
ellipses, or arbitrary nested geometry without their own native matrix.

After evaluating cases 0013 through 0016 and case 0019, run
`../scripts/shape3d_camera_metrics.py` with all clean native reports. It binds the exact source,
ground truth, revision, and per-slide raster hashes. Solid
rows use normalized four-corner geometry and three material color bands, requiring corner score
`0.98`, color score `0.97`, and, for measurable gradients, range ratio `0.65` and direction cosine
`0.95`. Exact source-required outer shadows additionally require measurable native shadow evidence,
symmetric candidate/reference energy ratio `0.70`, and direction cosine `0.95`; this makes a
visible but materially weaker shadow fail the gate. Editable-text rows
use a `0.25%` resolution-normalized raster tolerance and require bidirectional foreground F1 `0.90`,
tolerant projected-bounds score `0.98`, and grayscale ink-density retention `0.90`; raw IoU and raw
bounds remain diagnostic. Picture rows are inverse-projected to `384×384` and require corner score
`0.98`, rectified color score `0.95`, and tolerant edge F1 `0.90`, which detects wrong image content
or crop behind a correct outer plane. Bottom-front rows require normalized corner score `0.98`,
mean RGB band error no greater than `1.0`, and rejection of a restored source-flat-fill mutation.
Custom-path rows require tolerant foreground F1 `0.95`, tolerant bounds score `0.98`,
candidate/reference foreground area ratio `0.90`, centroid score `0.99`, and color score `0.98`.
Include case 0020 in the same command. The schema-v7 report adds a `picture-group` modality using the same
corner, rectified-color, tolerant-edge, and crop-mutation checks as picture planes. Schema-v6 reports
remain accepted for the previously verified modalities. Pass the report to
`run_capability_loop.py verify --camera-report ...`; callers cannot self-attest `camera-local`.
The same report erases every measurable candidate shadow and applies a 12% left crop plus rescale to
each rectified picture. It also vertically squashes every custom-path candidate to 20% height. All
matching mutations must be rejected by their target metric, so the gate also
proves that the selected corpus remains sensitive to the failure it claims to cover.

After evaluating `oracle-pypptx-shape-effect-0001-outer-shadow-matrix`, run
`../scripts/outer_shadow_metrics.py` with its clean API report. The schema-v1 report derives the
positive and inverse slides from source OOXML, binds source/ground-truth and every visible raster
hash, and checks exterior shadow energy, overshoot, field cosine/IoU/error, and centroid displacement.
It erases the candidate exterior shadow on every measurable positive row and requires that mutation
to fail. Pass the report to `run_capability_loop.py verify --shadow-report ...`; callers cannot
self-attest `shadow-local`. The seven positive rows are the promoted combinations; values appearing
in separate rows are not implicitly cross-combined.

After evaluating `oracle-pypptx-shape-effect-0002-reflection-matrix`, run
`../scripts/reflection_metrics.py` with its clean API report. The schema-v1 report derives the six
positive slides from direct `p:sp/p:spPr/a:effectLst/a:reflection` paths, binds source,
ground-truth, and every visible raster hash, and checks reflection density, symmetric energy
retention, overshoot, field cosine/IoU/error, and centroid displacement. It erases each candidate
reflection region and requires the mutation to fail. Pass the report to
`run_capability_loop.py verify --reflection-report ...`; callers cannot self-attest
`reflection-local`. The full native report also covers the no-reflection inverse. The separate
live-text case remains discovery evidence and does not broaden this shape-surface cohort.

On macOS the PowerPoint interactive session must remain available. Error `-9074` can come from a
locked session, a pending dialog, or a staged `_pptx-input.pptx` left open by an interrupted run.
Export and macro timeouts stop immediately and point to the unlock state or a pending **Grant File
Access** or macro-security dialog. A file-backed export-script compile error (`-2741`) switches to
an equivalent inline exact-path script within the same attempt. VBA calls are qualified as
`<macro-host-filename>!<macro-name>` because an unqualified procedure can return `-18` when another
presentation is open. The exporter removes stale output before every attempt and preserves the
original AppleScript stderr.

## Optional Font Profile

For font-sensitive text cases, copy `font-profile.example.json` to an ignored path such as
`testdata/font-profiles/local-office-fonts.json`, then point each face at an ignored local font or
symlink. Paths are relative to `testdata/`; do not commit licensed fonts.

```bash
PPTX_E2E_VITE_SERVER_URL=http://127.0.0.1:5183 \
PPTX_E2E_FONT_PROFILE=font-profiles/local-office-fonts.json \
PPTX_E2E_BROWSER_CHANNEL=chrome \
.venv/bin/python server.py
```

The single-slide page registers the profile before layout. Evaluation provenance records the
profile manifest, every face hash, browser and raster-capture settings, renderer revision, and
source/ground-truth hashes. Only compare metric runs whose relevant provenance matches. Regression comparability uses
the resolved profile ID, ordered faces, descriptors, and font-file hashes; the manifest hash remains
auditable but formatting-only JSON changes do not create a different browser environment.

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
  - `test/e2e/testdata/oracle-runtime/_pptx-input.pptx`
  - `test/e2e/testdata/oracle-runtime/_pptx-output.pdf`
  - `test/e2e/testdata/oracle-runtime/_macro-output.pptx`
  - `test/e2e/testdata/oracle-runtime/_macro-output.pdf`
- Macro spec path is also fixed:
  - `test/e2e/testdata/oracle-runtime/_macro-spec.txt`
  Generated per-case files are copied from these sinks by Python.

Authorize this directory once when prompted by PowerPoint.

The macOS runner also needs an unlocked user session, Automation permission for the calling app to
control Microsoft PowerPoint, and permission to run the repository-owned macro host. Keep these
native-oracle permissions on a dedicated development user or machine when running unattended
corpora; do not mix untrusted macro-enabled documents into that session.

## Next Steps (TDD Sequence)

1. Expand shape/smartart coverage in `oracle/cases/*.json`.
2. Add auto-minimization for failing cases and persist them into a stable regression suite.
3. Reuse exact-provenance render artifacts across metric-only changes, then add PR (`smoke`) vs
   nightly (`full`) matrix commands in CI.

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
