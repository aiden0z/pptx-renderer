# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# PPTX Renderer

## Attention

- Temporary plan files and any other analysis output should be written to `docs/agent-tmp/` unless a specific path is given.

TypeScript library that parses Office Open XML (.pptx) files and renders them as HTML/SVG in the browser.

## Tech Stack

- **Runtime:** TypeScript + Vite (ESM)
- **Dependencies:** jszip (zip extraction), echarts (charts), pdfjs-dist (PDF comparison in dev pages)
- **E2E Tests:** Python (pytest + Playwright + scikit-image), not bundled with the library
- **Build:** `pnpm build` → `dist/aiden0z-pptx-renderer.{es,cjs}.js`

## Architecture

Three-layer pipeline: **Parse → Model → Render**

```
ArrayBuffer (.pptx)
  → ZipParser (jszip extraction)
  → XmlParser (DOMParser + SafeXmlNode wrapper)
  → buildPresentation() (assembles model with relationship chains)
  → SlideRenderer (dispatches to type-specific renderers → DOM)
```

### Source Layout

```
src/
  index.ts                    # Public API: PptxRenderer, parseZip, buildPresentation, serializePresentation
  core/Renderer.ts            # PptxRenderer class (preview, goToSlide, destroy)
  parser/
    ZipParser.ts              # .pptx → PptxFiles (categorized Maps of XML strings + media bytes)
    XmlParser.ts              # SafeXmlNode: null-safe XML traversal (child/children/attr/text)
    RelParser.ts              # .rels relationship files → Map<rId, {type, target}>
    units.ts                  # EMU→px (96dpi), angle→deg, pct→decimal conversions
  model/
    Presentation.ts           # buildPresentation(): assembles slides/layouts/masters/themes, resolves placeholders
    Slide.ts                  # parseSlide(): sp→Shape, pic→Pic, graphicFrame→Table|Chart, grpSp→Group
    Theme.ts                  # Color scheme (12 slots), font scheme, format scheme (fillStyles/lineStyles)
    Layout.ts                 # Placeholder definitions with absolute positions
    Master.ts                 # Color map, text styles (title/body/other), placeholders
    nodes/
      BaseNode.ts             # Common: id, name, position, size, rotation, flipH/V, placeholder
      ShapeNode.ts            # presetGeometry, adjustments, fill/line XML, textBody, headEnd/tailEnd
      PicNode.ts              # blipEmbed (rId), crop rect, isVideo/isAudio
      TableNode.ts            # columns[], rows[{height, cells[{gridSpan, rowSpan, textBody}]}]
      GroupNode.ts            # childOffset, childExtent, children (raw XML, parsed lazily during render)
      ChartNode.ts            # chartPath reference (e.g. "ppt/charts/chart1.xml")
  renderer/
    SlideRenderer.ts          # Renders background → master shapes → layout shapes → slide shapes
    ShapeRenderer.ts          # SVG path from preset/custom geometry, fill (solid/gradient/image), stroke, arrowheads
    TextRenderer.ts           # 7-level style inheritance, bullets, fonts, hyperlinks, vertical text
    TableRenderer.ts          # HTML <table>, table style sections (wholeTbl/band/firstRow/lastCol), merged cells
    ChartRenderer.ts          # OOXML chart XML → ECharts option (bar/line/pie/radar/scatter/area/doughnut)
    ImageRenderer.ts          # <img> with blob URL, crop, video/audio elements
    GroupRenderer.ts          # Coordinate remapping (chOff/chExt → group space), recursive renderNode
    BackgroundRenderer.ts     # Slide/layout/master background: solid, gradient, image (stretch/tile)
    StyleResolver.ts          # resolveColor (scheme→colorMap→theme + modifiers), resolveFill, resolveLineStyle
    RenderContext.ts          # Context: presentation, slide, theme, master, layout, mediaUrlCache
  shapes/
    presets.ts                # 200+ DrawingML preset shape → SVG path functions
    customGeometry.ts         # <a:custGeom> path commands → SVG path string
    shapeArc.ts               # Arc path generation helper
  export/
    serializePresentation.ts  # PresentationData → JSON-safe structure (strips SafeXmlNode refs)
  utils/
    color.ts                  # Hex/RGB/HSL conversion, lumMod/lumOff/tint/shade/alpha modifiers
```

### Key Types

```typescript
type SlideNode = ShapeNodeData | PicNodeData | TableNodeData | GroupNodeData | ChartNodeData;

// All nodes share BaseNodeData: { id, name, nodeType, position, size, rotation, flipH, flipV }
// Positions/sizes are in pixels (converted from EMU during parsing)
// Rotations are in degrees (converted from 60000ths)
```

### SafeXmlNode Pattern

Central abstraction for XML traversal. Returns empty node on missing elements instead of null, enabling safe chaining:

```typescript
const color = node.child('solidFill').child('srgbClr').attr('val'); // undefined if any step missing
```

All parsed nodes keep `source: SafeXmlNode` reference to original XML for renderer access to properties not in typed interfaces.

## Rendering Details

### DOM Construction

- **Shapes:** `<div>` wrapper (absolute positioned) + inline `<svg>` with `<path>` for geometry + overlaid `<div>` for text
- **Images:** `<div>` wrapper + `<img src="blob:...">` with crop via margin/scale
- **Tables:** `<div>` wrapper + HTML `<table>` with `<colgroup>`, `border-collapse`
- **Charts:** `<div>` wrapper + ECharts `<canvas>` (initialized via `echarts.init()`)
- **Groups:** `<div>` wrapper + recursively rendered children with coordinate remapping

### Color Resolution

Three-step: `schemeClr` → master `colorMap` remap (e.g. "tx1"→"dk1") → theme `colorScheme` lookup → apply modifiers (lumMod, lumOff, tint, shade, alpha).

### Style Inheritance

- **Text:** 7-level cascade: master.defaultTextStyle → master.textStyles[category] → master placeholder lstStyle → layout placeholder lstStyle → shape lstStyle → paragraph pPr → run rPr
- **Fill/Line:** Shape spPr → style reference (fillRef/lnRef idx) → theme format scheme
- **Background:** slide → layout → master (first non-empty wins)

### What's NOT Supported

3D effects, animations/transitions, equations, EMF/WMF images, pattern fills, shadow/reflection/glow, combo charts, secondary axes, embedded OLE objects, slide notes.

Notes:

- SmartArt/diagram fallback is partially supported and under active oracle-driven regression expansion.
- Do not assume full PowerPoint parity for all SmartArt layouts.

## Dev Server Pages

All pages share unified dark theme via `test/pages/styles/common.css`.

| URL                                                                            | Purpose                                                |
| ------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `/test/pages/e2e-compare.html?file={stem}`                                     | PDF vs rendered HTML comparison with SSIM scores       |
| `/test/pages/index.html`                                                       | Upload PPTX for preview                                |
| `/test/pages/render-slide.html?file=testdata/cases/{stem}/source.pptx&slide=N` | Single slide at native resolution (used by Playwright) |
| `/test/pages/export.html?file={stem}`                                          | Model JSON tree viewer with Copy/Download              |

### Start Local E2E Dev Servers

Preferred (from project root):

```bash
pnpm dev:e2e
```

This starts:

- Vite dev server: `http://127.0.0.1:5173`
- Python E2E API server: `http://127.0.0.1:8080`

If split-start is needed:

```bash
# Terminal 1 (from project root)
pnpm dev

# Terminal 2 (from project root)
cd test/e2e && source .venv/bin/activate && python server.py
```

## Test Data

Case directories under `test/e2e/testdata/cases/{stem}/` each contain `source.pptx`, `ground-truth.pdf`, and optionally `slides/slide{N}.png`. E2E tests discover all such cases automatically.

## E2E Test Suite (`test/e2e/`)

Python-based. Recommended to run paired dev servers via `pnpm dev:e2e`
(or split-start Vite + Python API server).

```bash
cd test/e2e && pip install -e . && playwright install chromium
pytest -v                          # All 3 layers
pytest test_structural.py -v       # Layer 1: model vs ground truth (word coverage, shape count/position)
pytest test_visual.py -v           # Layer 2: HTML screenshots vs PDF pages (SSIM ≥ 0.65/slide, ≥ 0.70 avg)
pytest test_regression.py -v       # Layer 3: scores vs stored baselines (no drops > 0.02 SSIM / 2% text)
pytest test_regression.py --update-baselines  # After confirmed improvements
```

## Shape / SmartArt Fix Workflow (Quick Reference)

Standard workflow for fixing preset shapes and SmartArt. The flow is the same for both; only the case source and evaluation command options differ. Dev servers must be running (`pnpm dev:e2e`).

### Prerequisites

```bash
# All commands run from test/e2e/ directory (from project root: cd test/e2e)
source .venv/bin/activate          # or use .venv/bin/python3 explicitly

# Dev servers must be running (Vite + Python API)
# From project root: pnpm dev:e2e
```

### Step 1: Discover Failing Cases

```bash
# === Shapes (by MsoAutoShapeType ID range) ===
.venv/bin/python3 scripts/run_all_shapes_eval.py --shape-id-min 1 --shape-id-max 200

# === SmartArt (by cases-full directory, 134 layouts) ===
.venv/bin/python3 scripts/run_all_shapes_eval.py --smartart-cases-dir oracle/cases-full

# === Both at once ===
.venv/bin/python3 scripts/run_all_shapes_eval.py \
  --shape-id-min 1 --shape-id-max 200 \
  --smartart-cases-dir oracle/cases-full

# Results:
#   reports/oracle-failures/all-shapes-eval.json   (full metrics per case)
#   reports/oracle-failures/all-shapes-eval.csv    (case,ssim,color_hist_corr,fg_iou_tolerant,chamfer_score,fg_iou,passed,needs_review)

# Find failures:
grep “False” reports/oracle-failures/all-shapes-eval.csv | sort -t, -k2 -n
```

**Two-Layer Metric System** (in `server.py`):

- **Pass/Fail** (automated): `ssim ≥ 0.95`, `color_hist_corr ≥ 0.80`
- **Warning** (human review): `ssim < 0.99` → `needsReview: true`
- **Diagnostic** (display only): `fg_iou`, `fg_iou_tolerant`, `chamfer_score`, `mae`

Note: `fg_iou` was removed from pass/fail due to false positives on thin-stroke shapes.

Oracle case naming:

- Shapes: `oracle-full-shapeid-{NNNN}-{name-slug}` (e.g. `oracle-full-shapeid-0001-rectangle`; NNNN = VBA MsoAutoShapeType enum, zero-padded)
- SmartArt: `oracle-full-smartart-{NNNN}-{layout-name}` (e.g. `oracle-full-smartart-0001-basic-block-list`)

Case JSON: `test/e2e/oracle/cases-full/*.json`. Each declares `kind: “shape”` or `kind: “smartart”` with layout/dimensions.

### Step 2: Identify the Shape

Oracle cases use VBA `MsoAutoShapeType` enum as ID. Map to OOXML preset name:

- **Reference**: https://learn.microsoft.com/en-us/office/vba/api/office.msoautoshapetype
- **python-pptx mapping**: https://github.com/scanny/python-pptx/blob/master/spec/gen_spec/src_data/enums/MsoAutoShapeType/MsoAutoShapeType.txt
- **Common IDs**: 15=bevel, 93=star8, 94=star16, 140=leftRightRibbon, 149=star10, 150=star12, 161=chord, 163=mathPlus, 174=funnel

### Step 3: Diagnose the Problem

```bash
# Visual comparison (requires prior eval run):
#   reports/oracle-full-shapeid-{NNNN}_slide0_pdf.png   (ground truth)
#   reports/oracle-full-shapeid-{NNNN}_slide0_html.png  (our render)
#   reports/oracle-full-shapeid-{NNNN}_slide0_diff.png  (overlay diff)

# Edge analysis (Canny edge IoU + overlay):
.venv/bin/python3 scripts/analyze_edge.py oracle-full-shapeid-0161-chord
#   → reports/edge_analysis/<case>/edge_overlay.png (green=both, red=PDF only, blue=HTML only)

# Extract PPTX XML to verify preset name and adjustments:
.venv/bin/python3 -c “
import zipfile; from lxml import etree
z = zipfile.ZipFile('testdata/cases/oracle-full-shapeid-NNNN-{slug}/source.pptx')
for n in z.namelist():
    if 'slide1.xml' in n:
        root = etree.fromstring(z.read(n))
        ns = {'a': 'http://schemas.openxmlformats.org/drawingml/2006/main'}
        for g in root.iter('{http://schemas.openxmlformats.org/drawingml/2006/main}prstGeom'):
            print('prst:', g.get('prst'))
            for gd in g.findall('.//a:gd', ns): print(' ', gd.get('name'), '=', gd.get('fmla'))
“
```

Common diagnoses:

| Symptom                      | Likely Cause                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------- |
| Rectangle instead of shape   | Preset missing in `src/shapes/presets.ts`                                     |
| Shape too big/small/thin     | Wrong `adj` default or formula (check OOXML spec)                             |
| No stroke on non-line shapes | `lnRef` theme line not applied (check `ShapeRenderer.ts`)                     |
| Center hole not visible      | Missing `fill-rule: evenodd` in `ShapeRenderer.ts`                            |
| Ellipse angle wrong          | Using parametric angle directly instead of OOXML visual→parametric conversion |
| Flat color instead of 3D     | Single-path instead of multi-path with lighten/darken faces                   |

### Step 4: Find OOXML Spec

The authoritative geometry source is ECMA-376 `presetShapeDefinitions.xml`. Locations:

1. **Local LibreOffice reference** (if present): `references/libreoffice-core/oox/source/drawingml/customshapes/presetShapeDefinitions.xml`
2. **GitHub LibreOffice**: https://github.com/LibreOffice/core → `oox/source/drawingml/customshapes/`
3. **docx4j**: https://github.com/plutext/docx4j → `docx4j-core/src/main/resources/org/docx4j/model/shapes/presetShapeDefinitions.xml`

Key OOXML formula patterns:

```
adj(name, default)     → adjustment value, raw units 0-100000 (divide by 100000 for ratio)
*/ A B C               → A * B / C
+- A B C               → A + B - C
pin lo val hi           → clamp(val, lo, hi)
cos val ang             → val * cos(ang)        (ang in 60000ths of degree)
sin val ang             → val * sin(ang)
at2 y x                → atan2(y, x)           (result in 60000ths of degree)
```

Common OOXML constants: `wd2`=w/2, `hd2`=h/2, `hd4`=h/4, `wd32`=w/32, `ss`=min(w,h), `hc`=w/2, `vc`=h/2, `cd4`=90°, `cd2`=180°, `3cd4`=270°.

### Step 5: Implement the Fix

Key files to modify:

| File                                                  | When                                                           |
| ----------------------------------------------------- | -------------------------------------------------------------- |
| `src/shapes/presets.ts` — `presetShapes.set(...)`     | New/fix single-path preset geometry                            |
| `src/shapes/presets.ts` — `multiPathPresets.set(...)` | Multi-face 3D shapes (bevel, cube, ribbon) with fill modifiers |
| `src/renderer/ShapeRenderer.ts`                       | Stroke/fill logic (lnRef, fill-rule, etc.)                     |
| `src/shapes/customGeometry.ts`                        | Custom geometry arcTo handler                                  |

**Preset shape patterns:**

```typescript
// Simple single-path shape
presetShapes.set('myShape', (w, h, adjustments) => {
  const a = adj(adjustments, 'adj', 50000); // adj() divides by 100000
  return `M0,0 L${w},0 L${w},${h} Z`;
});

// Multi-path shape with 3D faces
multiPathPresets.set('myShape', (w, h, adjustments) => {
  return [
    { d: bodyPath, fill: 'norm', stroke: true },
    { d: topFace, fill: 'lightenLess', stroke: true },
    { d: shadow, fill: 'darkenLess', stroke: false },
    { d: outline, fill: 'none', stroke: true },
  ];
});
// fill modifiers: 'norm' | 'darken' | 'darkenLess' | 'lighten' | 'lightenLess' | 'none'
```

**OOXML angle gotchas:**

- OOXML angles are “visual” (geometric ray from center). For ellipses (rx≠ry), must convert to parametric: `t = atan2(sin(θ)/ry, cos(θ)/rx)`. Affects `chord`, `pie`, `arc` and any shape using `arcTo` on non-circular ellipses.
- Star `adj` default divides by 50000 (not 100000): `innerRatio = adj/50000`. Since `adj()` helper divides by 100000, multiply by 2: `adj(adjustments, 'adj', 37500) * 2`.

**OOXML arcTo → SVG arc helper** (for multi-path shapes with arcs):

```typescript
const arcTo = (
  curX: number,
  curY: number,
  wR: number,
  hR: number,
  stDeg: number,
  swDeg: number,
) => {
  const stRad = (stDeg * Math.PI) / 180;
  const endRad = ((stDeg + swDeg) * Math.PI) / 180;
  const cx = curX - wR * Math.cos(stRad);
  const cy = curY - hR * Math.sin(stRad);
  const endX = cx + wR * Math.cos(endRad);
  const endY = cy + hR * Math.sin(endRad);
  const largeArc = Math.abs(swDeg) > 180 ? 1 : 0;
  const sweep = swDeg > 0 ? 1 : 0;
  return { endX, endY, svg: `A${wR},${hR} 0 ${largeArc},${sweep} ${endX},${endY}` };
};
```

### Step 6: Verify

```bash
# 1. Unit tests
npx vitest run test/unit/shapes/presets.test.ts
npx vitest run test/unit/renderer/ShapeRenderer.test.ts

# 2. Targeted oracle eval (single shape)
cd test/e2e
.venv/bin/python3 scripts/run_all_shapes_eval.py --shape-id-min 174 --shape-id-max 174
cat reports/oracle-failures/all-shapes-eval.csv

# 3. Visual check: open diff image
#    reports/oracle-full-shapeid-{NNNN}_slide0_diff.png

# 4. Broad regression check (all shapes)
.venv/bin/python3 scripts/run_all_shapes_eval.py --shape-id-min 1 --shape-id-max 200
grep “False” reports/oracle-failures/all-shapes-eval.csv
```

### Step 7: Add Unit Test

Add test in `test/unit/shapes/presets.test.ts` for each fixed shape:

```typescript
it('renders funnel with two sub-paths: body and inset ellipse hole (oracle-full-shapeid-0174-funnel)', () => {
  const d = getPresetShapePath('funnel', 400, 280);
  const subpaths = d.match(/M[^M]+/g);
  expect(subpaths!.length).toBe(2); // body + inset ellipse
  // verify arc radii, key structure assertions...
});
```

### Mandatory TDD Rule For Complex Geometry

When a shape mismatch is non-trivial (topology / arrowhead / curvature / local deformation), treat as **geometry-forensics**, not parameter tuning.

1. Lock target case id, gather current metrics.
2. Extract ground-truth from OOXML spec (not by guessing from pixel images).
3. Write/adjust failing test first.
4. Implement minimal geometry change aligned to spec.
5. Verify all 3 layers (unit tests + oracle eval + visual check).
6. If `fg_iou` regresses, immediately rollback and re-derive from spec.

Anti-patterns: blind tuning of `adj*` constants, accepting “looks close” with wrong topology, accepting high SSIM with incorrect local semantics.

### One-Shot Large Baseline Generation

For large local corpus bootstrapping (all local SmartArt layouts + shapeTypeId range):

```bash
cd test/e2e
source .venv/bin/activate
python scripts/one_shot_full_ground_truth.py \
  --macro-host testdata/pptx-macro-host.pptm \
  --cases-dir oracle/cases-full \
  --testdata-dir testdata \
  --shape-id-min 1 \
  --shape-id-max 500
```

Report: `test/e2e/reports/oracle-failures/full-ground-truth-one-shot.json`

### E2E Test Architecture

- **`test/e2e/extract_ground_truth.py`** — Parses raw PPTX XML via `zipfile` + `lxml` (independent of our renderer)
- **`test/e2e/conftest.py`** — Fixtures: auto-starts Vite, Playwright browser, export cache, parametrized across 4 test files
- **`test/e2e/server.py`** — FastAPI server with SSIM evaluation endpoints (proxies to Vite)
- **`test/e2e/reports/`** — Generated PNG screenshots: `{file}_slide{N}_{pdf|html|diff}.png`

### E2E Scripts Reference

| Script                                  | Usage                               | Purpose                                               |
| --------------------------------------- | ----------------------------------- | ----------------------------------------------------- |
| `scripts/run_all_shapes_eval.py`        | `--shape-id-min N --shape-id-max N` | Batch evaluate shapes via POST `/api/evaluate/{case}` |
| `scripts/analyze_edge.py`               | `<case> [--slide N]`                | Canny edge IoU analysis with visual overlay output    |
| `scripts/one_shot_full_ground_truth.py` | `--macro-host ... --cases-dir ...`  | Bulk generate PPTX+PDF ground truth from oracle cases |

Key mechanics:

- Ground truth cache reuse is default.
- Incremental matrix focuses unsupported cases from: `test/e2e/reports/oracle-failures/support-catalog.json`
- Full run / regenerate switches: `ORACLE_CASE_SCOPE=all`, `ORACLE_REUSE_GROUND_TRUTH=0`

## Quality Tools

```bash
pnpm test                # vitest (unit tests)
pnpm test:coverage       # vitest + v8 coverage report → coverage/
pnpm lint                # eslint (src/ only)
pnpm lint:fix            # eslint --fix
pnpm format              # prettier --write src/**/*.ts
pnpm format:check        # prettier --check (CI)
pnpm typecheck           # tsc --noEmit
pnpm knip                # dead code / unused exports detection
pnpm publint             # package.json exports correctness
pnpm size                # size-limit check (gzip ≤ 1400 kB)
```

**Git hooks** (husky + lint-staged): `pre-commit` runs `eslint --fix` + `prettier --write` on staged `src/**/*.ts`; `commit-msg` enforces [Conventional Commits](https://www.conventionalcommits.org/) via commitlint.

**Style rules**: single quotes, trailing commas, 100 char print width, 2-space indent (`semi: true`). Unused vars prefixed `_` are allowed. `no-console` warns (except `console.warn/error`).

## Reference Libraries (`references/`)

- **pptxjs** (`references/pptxjs/`) — Alternative TS renderer, aliased as `pptxjs-reference` in vite.config. Kept as a reference implementation.
- **pptx-preview** (`references/pptx-preview/`) — Chinese PPTX preview lib (ECharts-based charts). Pre-built dist only.
- **libreoffice-core** (`references/libreoffice-core/`) — C++ source for OOXML spec verification (table styles, default values).

## Conventions

- **Units:** All model-layer positions/sizes are in pixels. Conversion happens in parser layer (`emuToPx`).
- **Null safety:** Use `SafeXmlNode` for all XML access. Never access `.element` directly without `.exists()` check.
- **Error isolation:** Each node renders inside try/catch. A failed shape shows error placeholder; the slide continues.
- **Lazy group parsing:** Group children stored as raw `SafeXmlNode[]`, parsed to typed nodes during rendering (avoids deep recursion in model layer).
- **Blob URLs:** Created for images/media, tracked in `RenderContext.mediaUrlCache`, revoked on `destroy()`.
- **No external CSS:** All styles are inline on DOM elements. The library outputs self-contained HTML fragments.
