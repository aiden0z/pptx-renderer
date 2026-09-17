# Architecture

`@aiden0z/pptx-renderer` follows a three-stage pipeline:

1. Parse
2. Model
3. Render

Renderer evolution is governed by a separate evidence loop. It observes source packages and test
results, but does not bypass or rewrite the Parse → Model → Render boundaries.

## Capability Evidence Boundary

`test/e2e/oracle/capabilities.json` is the tracked support contract. Each stable capability ID
declares namespace-aware OOXML selectors, a bounded scope, current render mode, planning mode,
fallback, affected implementation/test paths, and required gates. `capability-acceptance.json`
stores one sanitized historical verification record per capability; Git retains older revisions. Private
PPTX/PDF/PNG artifacts and generated inventory remain ignored.

The loop has six domain modules and two thin CLIs:

- `capability_contract.py` validates immutable registry and historical-record types.
- `capability_inventory.py` scans PPTX ZIP/XML within fixed entry and decoded-byte limits and
  deduplicates packages by SHA-256.
- `capability_evidence.py` validates current-revision test reports and stores source PPTX, ground
  truth, gates, environment, and revision evidence without hashing renderer source files.
- `capability_verification.py` normalizes native evaluation API results, rejects mixed or dirty
  revisions, and derives native, manual-review, SSIM-regression, and capability-specific local
  metric gate outcomes. Local visual gates must match the per-slide reference/candidate hashes in
  the API report and the current raster files.
- `capability_ranking.py` applies a documented lexicographic priority and emits one bounded work
  packet.
- `verification_impact.py` maps changed repository paths through exact or declared-glob capability
  impact hints to deterministic tests, browser/native requirements, and the latest recorded native
  case sets. Documentation-only edits run documentation contracts without entering the visual
  plan; unclassified non-documentation paths fail closed to full TypeScript, Python, typecheck, and
  browser verification. Capability-registry and unclassified global runtime/control changes expand
  impact to every registered capability. Shared evaluation, provenance, evidence, and loop-control
  changes do the same and add the capability contract check. Native artifacts are matched to
  recorded source and ground-truth hashes rather than case names alone. The planner also
  exposes missing native artifacts and the exact local metric commands still required.
- `scripts/run_capability_loop.py` composes `validate`, `inventory`, `rank`, `work-packet`,
  `verify`, and `accept`; it does not edit GitHub issues or accept visual baselines.
- `scripts/verify_affected.py` prints that impact plan and optionally executes its fast commands in
  their declared working directories; targeted browser and native work remains a visible
  pre-commit/pre-merge obligation.

Render mode, planning mode, and evidence state are independent. Render modes are `none`, `fallback`, `approximate`,
`native`, and `excluded`; evidence moves through `unknown`, `observed`, `reproducible`, `candidate`,
`historical`, `verified`, `regressed`, or `blocked`. User-facing support requires `native` scope plus a passing
report for the current Git revision. Planning mode is `ranked` by default; `observation-only` keeps broad residual
selectors visible in the ledger while excluding them from executable ranking and work packets. A
historical verification record never establishes the state of a later revision. The edit-loop
planner uses each capability's `affectedPaths` only to select tests and its `verificationCases` to
select concrete non-native oracle probes; neither field is an implementation signature or
correctness proof.

## 1) Parse Layer

Core modules:

- `src/parser/ZipParser.ts`
- `src/parser/XmlParser.ts`
- `src/parser/RelParser.ts`

Responsibilities:

- Open PPTX ZIP package and read entry files.
- Enforce resource limits (`ZipParseLimits`) to reduce DoS surface.
- Parse OOXML + relationship targets into safe intermediate structures.

## 2) Model Layer

Core modules:

- `src/model/Presentation.ts`
- `src/model/Slide.ts`
- `src/model/nodes/*`
- `src/search/TextSearch.ts`

Responsibilities:

- Build normalized in-memory presentation model.
- Resolve layout/master/theme inheritance.
- Parse node-level geometry, text, style, and relationship references.
- Optionally defer per-slide node parsing with `lazySlides` until render, search, or
  serialization consumes that slide.
- Build model-level text indexes and search results that are independent of mounted DOM.

Slide placeholders with an ordinary explicit `idx` inherit from the layout placeholder with that
index. A missing `idx`, or the unlinked sentinel `4294967295`, instead matches by the effective
placeholder type so duplicate sentinel values cannot select an unrelated layout style. Layout to
master inheritance remains type based.

## 3) Render Layer

Core modules:

- `src/core/Viewer.ts` — `PptxViewer` (primary API, extends `EventTarget`)
- `src/core/Renderer.ts` — `PptxRenderer` (deprecated v1 wrapper, extends `PptxViewer`)
- `src/renderer/SlideRenderer.ts` — returns `SlideHandle` with per-slide resource lifecycle
- `src/renderer/*Renderer.ts`

Responsibilities:

- Convert model into DOM elements per slide.
- Handle list/single-slide render modes via `renderList()` / `renderSlide()`.
- Instance-level `open()` for one-call parse→build→render (static `PptxViewer.open()` delegates to this).
- Render lifecycle events: `renderstart` / `rendercomplete` bracket every render cycle; `slidechange` fires after render.
- A newer render request supersedes older queued or batched work; stale list batches stop at frame boundaries before appending more DOM.
- Typed `on()` / `off()` helpers and state getters (`isRendering`, `zoomPercent`, `fitMode`).
- Manage media object URL lifecycle (blob URLs tracked per-handle and per-viewer).
- Handle internal/external navigation (with URL safety checks).
- Expose external slide rendering, scaled thumbnail preview, and search highlight helpers.
- Render common EMF fallback previews when the file contains embedded bitmap data or,
  with optional `pdfjs` URLs, an embedded PDF preview.

### Async Resource Lifecycle

Each `renderSlide()` call owns an `AbortController`. `SlideHandle.dispose()` aborts
in-flight EMF-PDF work before disposing chart instances and owned blob URLs. Async
renderers must check the context signal before mutating DOM or shared caches, and must
revoke any blob URL that arrives after cancellation. `PptxViewer.destroy()` disposes its
slide handles before clearing the viewer-level media cache.

PDF.js runs inside a short-lived isolated Worker, with PDF.js using its own nested Worker.
Success, worker error, timeout, and cancellation share one cleanup path that terminates
the outer Worker. No PDF.js module state is imported or configured on the host page.

### Chart Runtime and Distribution

`src/renderer/chart/echartsRuntime.ts` is the only runtime ECharts registration point. It
imports from `echarts/core`, registers every supported chart/component plus
`CanvasRenderer`, and is explicitly declared as side-effectful package code. Type-only
imports may still come from `echarts` without pulling the full runtime into the bundle.

The normal ESM/CJS builds externalize `echarts/*` and JSZip for application bundlers. The
`./browser` entry bundles JSZip and the registered ECharts subset while keeping PDF.js
optional and external.

### Tables, two-dimensional charts, and formulas

Tables remain native DOM rather than canvas content. `TableNode` preserves row and column sizes,
merge continuations, cell text, and direct properties; `TableRenderer` combines those values with
the table-style hierarchy. The bounded native matrix contains eight isolated cases for common
styles, banding, first/last columns, horizontal and vertical merges, variable grid dimensions,
cell margins and anchors, CJK/mixed text, and direct border variants. Combinations outside that
matrix still render, but do not inherit its native-fidelity claim.

Two-dimensional charts use the modular ECharts canvas runtime. A 21-case native matrix spans the
implemented chart families, while the capability remains `approximate` until the family-specific
plot-area, axis, label, and legend gates pass. Chart data semantics and visual layout are tested as
separate concerns so layout tuning cannot conceal a dropped series or malformed cache. Automatic
Cartesian layout has a native-calibrated path for compact columns, negative-value zero crossings,
horizontal bars, and right-side line/area legends; explicit plot layouts and top/bottom legend
reservations retain their OOXML-defined behavior.

`test/e2e/oracle/chart_metrics.py` adds a separate local-evidence path for eligible single-chart
column, bar, line, and area slides. It follows `presentation.xml` slide order, resolves the chart
part through the slide relationship, and constrains raster analysis to the chart frame from
`p:graphicFrame/p:xfrm`. Within that frame it detects the neutral axis/grid field, removes a
neutral or stable solid plot background, compares plot bounds and aggregate chromatic series
geometry/color, and emits plot, orientation-correct axis, and right-legend diagnostics. A detected
series-mask erasure sanity check must fail before a local pass is accepted. The server attaches
this result as `perSlide[].cartesianChart`; it does not alter the established full-slide
`supported` or `needsReview` result. Combo charts, grouped or unresolved chart frames, more than
eight series, neutral-only series, unsupported chromatic backgrounds, unstable axis/grid
detections, and mismatched oracle pages remain explicitly unevaluable by this local metric.

PowerPoint math is an Office Drawing extension: an `mc:AlternateContent` choice contains a shape
whose paragraph includes `a14:m` and OMML, while the fallback contains a `p:sp` or
`p:graphicFrame`. The current MCE path deliberately does not advertise the whole `a14` namespace;
it opts into a Choice only when every `a14:m` wrapper contains a fully recognized math subtree.
`MathNode` parses that OMML into a JSON-safe renderer-owned model, and `MathRenderer` emits native
Presentation MathML. The first direct subset handles runs, fractions, radicals, scripts, delimiters,
n-ary operators, functions, and matrices with one inherited formula run style. Unknown subtrees retain the source
fallback rather than disappear or cause unrelated `a14` choices to be selected. An eight-case
native matrix fixes those target constructs and their fallbacks. The capability remains approximate
while font outlines, operator sizing, and detailed OMML run styling differ. Because a sparse equation can
produce a high full-slide SSIM even with the wrong topology, low foreground overlap is always a
manual-review condition.

## OOXML Geometry Compilation Boundary

The handwritten `src/shapes/presets.ts` registry remains the compatibility geometry engine. The
tooling under `scripts/ooxml-geometry/` pins and validates the ECMA-376 DrawingML geometry
addendum, implements the complete guide-formula contract, compiles all unique definitions into
renderer-independent plain data, and emits deterministic SVG paths. The generator also writes a
tree-shakeable production subset to `src/shapes/generated/ooxmlPresetGeometrySubset.ts`.
`src/shapes/ooxmlGeometryRuntime.ts` evaluates that data before the handwritten lookup.
The subset contains 29 definitions: all 28 zero-adjustment flowcharts in shape IDs 61-88 (20
single-path definitions and eight ordered three-path definitions), plus `donut`. Donut generation
pins the source default (`adj=25000`) and its polar-handle bounds (`0..50000`) before admitting the
definition. The 28 flowcharts have one native PowerPoint case each; every case exercises a square
standalone shape with explicit paint, a wide standalone shape using a theme style reference, and a
tall shape under a non-identity group transform. Other shapes continue through the handwritten
registry.

The compiled IR retains ordered adjustment/calculated guides, adjustment handles, connection
sites, text rectangles, path coordinate systems, path styling metadata, and the six DrawingML
path command kinds. Its evaluator resolves a concrete width, height, and named adjustment map
without DOM or SVG dependencies. The generation gate fingerprints the structural IR and
evaluates the complete corpus at square, wide, and tall extents.

Path emission scales each declared path coordinate space into the shape extent and converts
DrawingML visual-angle arcs into SVG ellipse segments. Full circles are split at serialization,
and output rounding is confined to that boundary. The runtime subset supports the same 17 formula
operators and predefined guides as the build-time evaluator. SVG fill/theme resolution, browser
masks, connector markers, picture/media ownership, effects, and render lifecycle stay in their
existing render modules. The multi-path adapter preserves each definition's ordered fill/stroke
records; the renderer still owns theme paint, dash/cap/join attributes, masks, effects, and image
layering. Generated paths retain the current per-node geometry cache and are not added to the
serialized presentation model. Picture preset clipping uses the first generated fill-bearing
silhouette, without adding detail or outline paths to the clip geometry. Picture nodes retain
preset-geometry adjustments so generated clipping uses the same bounded guide values as ordinary
and grouped shapes.

ECMA source differences are recorded through `source-reconciliation.json`. The validator rejects active
alternative definitions because it does not yet verify their bytes or native PowerPoint
evidence. A later override gate must verify the local source bytes and hash, confirm the
requested shape exists, and resolve native-oracle metadata before activation. Production
migration is per shape or shape family, so the existing handwritten implementation remains
active for shapes that have not passed that gate. Expanding the production subset requires
formula/IR parity, SVG structure, parent renderer, picture clip, browser, package, and current
native PowerPoint oracle evidence for the selected shape family.

### Text wrapping and shape autofit

`ShapeRenderer` resolves `a:bodyPr` through the existing shape/layout/master inheritance chain
before it chooses CSS wrapping, overflow, and autofit behavior. `wrap="square"` uses browser line
wrapping and `wrap="none"` uses a single-line container; both are written as inline styles so a
host page's `white-space` rule cannot replace the presentation semantics. Explicit
`horzOverflow` and `vertOverflow` values are resolved independently. Paragraph `eaLnBrk="0"`
uses the browser's unrestricted break opportunity, while the omitted/true default retains East
Asian typographic rules; both values are explicit so inherited host CSS cannot change the result.
Paragraph `hangingPunct="1"` keeps terminal closing punctuation with the preceding glyph and lets
the mark occupy the text frame's trailing inset instead of wrapping onto a line by itself.
For horizontal left-to-right paragraphs, explicit `a:tabLst/a:tab@pos` targets are resolved after
fonts load from the current browser-laid-out cursor. This preserves the text-frame-relative OOXML
position across paragraph margins, first-line indents, inline or mixed-run tabs, multiple stops,
and bullet gutters. Left, center, right, and decimal alignments use the measured following field;
paragraphs without `a:tabLst` retain the browser `tab-size` path. Right-to-left and vertical text
also retain that fallback, except for the native-verified East Asian vertical left-tab lane, which
measures the stop on the vertical inline axis.

For `a:bodyPr@vert`, the renderer maps all six non-horizontal DrawingML values to their matching
column direction and glyph orientation. Stacked WordArt adds PowerPoint's character advance, and
the CJK sans fallback stack prefers Korean platform fonts before the generic Unicode fallback so
mixed CJK/Hangul vertical text keeps native-like glyph metrics and column breaks.

The three autofit choices remain mutually exclusive:

- `noAutofit` keeps the authored font size and applies the requested clip or overflow axes;
- `normAutofit` applies the serialized `fontScale` and `lnSpcReduction` within the fixed shape;
- `spAutoFit` measures the final browser text after fonts are ready. A square-wrapped,
  top/default-anchored standalone horizontal `txBox` with no explicit overflow override can grow
  when it contains multiple visible
  paragraphs, or when an explicit visible-run font size would otherwise require material
  single-line shrinking. The wrapper and its main SVG receive the same grown dimensions, while
  absolutely positioned siblings keep their coordinates.

Before every measurement pass, the renderer restores the authored wrapper, SVG, whitespace, and
transform state. This prevents fallback-font measurements from leaving stale growth after the
declared fonts become available. Other wrapping modes, center/bottom anchors, vertical text,
diagram-specific text bounds, non-text-box shapes, explicit overflow overrides, and compact labels
whose size comes only from inheritance remain on the bounded fit path. The native evidence is
therefore a finite text-box cohort, not a claim of editor-level parity for every PowerPoint autofit
context.

### Text fill precedence

`TextRenderer` resolves run styles through the existing master/layout/shape/paragraph/run cascade,
then applies container color options with an explicit local-precedence check. A fill declared on
the run wins first; otherwise a `solidFill` on paragraph `defRPr` wins over the shape's resolved
`fontRef`. The shape `fontRef` is used only when both local levels omit a text fill. Solid, gradient,
pattern, stretched-picture, and no-fill choices remain mutually exclusive. Stretched picture fills
resolve embedded or lazy media through the current part's relationships and clip the image to the
run glyphs. Direct `srgbClr` and theme-backed `schemeClr` still resolve in `StyleResolver`.

The native matrix includes positive paragraph defaults, an explicit run override, the no-local-color
inverse fallback, and square, wide, and tall containers. This boundary verifies color selection; it
does not claim pixel-identical font metrics across every host font installation.

### Bounded ordinary-shape outer shadows

`ShapeRenderer` resolves a direct `p:sp/p:spPr/a:effectLst/a:outerShdw` independently from the fill
and visible stroke. The native lane is deliberately limited to `rect`, `roundRect`, and `ellipse`
with direct opaque solid or simple-gradient paint, no other effect-list child, no skew or 3D, and no
shape rotation/flip. A group child may enter only for the verified single group level with no
rotation/flip and a uniform 1.25 child-coordinate scale. `GroupRenderer` propagates the
ancestor rotation/flip fact rather than trying to infer it after coordinates have been flattened.

At 100% scale, the shape path receives the shadow filter without changing the fill or stroke. The
verified 92% and 102% uniform `sx=sy` values clone the filled silhouette into a sibling SVG group
behind the visible shape and scale it around the matrix's `tr` or `ctr` anchor. The clone carries
no stroke. Its filter bounds are computed in user space from the transformed silhouette, offset, and
blur margin so expanded and displaced shadows remain visible. Native evidence requires distinct
Gaussian calibration for bounded zero-distance and scaled-silhouette shadows; directional 100%
effects and combinations outside the seven exact positive matrix rows keep the general approximation
path; parameter values observed in different rows are not combined implicitly. The anchor helper
implements all nine OOXML positions, but positions without native rows are not promoted by this
capability.

The capability is verified by an eight-slide native PowerPoint matrix plus the schema-v1
`shadow-local` report. The report derives applicable slides from the exact XML ancestor path, binds
source/ground-truth and per-slide raster hashes to one clean renderer revision, compares exterior
darkness energy and field geometry, and must reject a deterministic exterior-shadow erasure. This
keeps a nearly white full-slide background from masking a locally missing shadow.

### Bounded ordinary-shape reflections

`ShapeRenderer` passes a direct `p:sp/p:spPr/a:effectLst/a:reflection` to
`ReflectionRenderer`. The helper clones the completed shape wrapper before inserting the effect
layer, resets the clone to shape-local `left=0` and `top=0`, and rewrites every cloned SVG ID plus
`url(#...)` or fragment reference. This avoids both double application of the shape's absolute slide
offset and cross-shape gradient/filter collisions.

The helper resolves the `CT_ReflectionEffect` defaults at the rendering boundary: zero blur,
distance, direction, and skew; full start alpha at position zero; zero end alpha at position 100%;
90-degree fade direction; 100% X/Y scale; and bottom alignment. It builds the OOXML affine matrix
from scale, skew, alignment anchor, direction, and distance, computes the transformed local bounds,
and places the clone inside an overflow-visible sibling layer. Blur belongs to that layer. The alpha
mask remains outside the negatively scaled source so the fade direction stays in final visual
coordinates.

The native capability is restricted to the six positive rows in the seven-slide reflection matrix:
the declared `rect`, `roundRect`, `ellipse`, and `upArrow` paint/geometry tuples, bottom-left
vertical reflection, bounded blur/alpha/distance values, no local transform or other effect, and at
most one unrotated, unflipped group with uniform 1.25 child scale. `GroupRenderer` also applies the
same helper to a direct group-level reflection as a diagnostic approximation, but that path is not
promoted by the shape capability. Picture reflection keeps its existing image-specific fallback;
live no-fill text is retained as separate discovery evidence.

The schema-v1 `reflection-local` report derives positive regions from the exact shape effect path,
binds source, ground-truth, and raster hashes to the clean renderer revision, and compares reflection
energy, overshoot, field cosine/IoU/error, and centroid displacement. It must reject an erased
candidate reflection region. The browser suite separately locks local-coordinate invariance and
cloned SVG reference isolation.

### Bounded static DrawingML 3D

`src/model/nodes/Shape3D.ts` parses direct `a:scene3d` and `a:sp3d` children into typed camera,
field-of-view, zoom, light, bevel, contour, extrusion, material, and color observations. It attaches
those observations to shape, picture, and group nodes; only malformed numeric values become parse issues. Serialization
removes the retained `SafeXmlNode` color source while preserving its JSON-safe observation, so
detection remains independent from renderer support policy. `CT_Bevel` omission is resolved at the
model boundary: `prst` defaults to `circle`, while `w` and `h` default independently to 76200 EMU
(6 pt / 8 CSS px at 96 dpi). Explicit zeros remain zeros and therefore do not become a positive
bevel plan.

`src/renderer/Shape3DRenderer.ts` is a narrow decision and effect layer. It returns either an
`orthographic-top-bevel` plan, a `camera-projected-plane` plan, a
`camera-projected-text-plane` plan, a `camera-projected-picture-plane` plan, a bounded
`camera-projected-group-plane` plan, or an explicit
flat-fallback reason before touching the DOM. The camera-plane plan records whether its SVG source
is the verified rectangular preset or bounded custom-path profile.
The top-bevel plan requires all of the following:

- `orthographicFront` without camera rotation;
- `twoPt:t` or `threePt:t` light, with no rotation except the real-corpus
  `twoPt:t/lat=0/lon=0/rev=120°` tuple;
- a positive circular top bevel, zero or omitted extrusion and `z`, no scene backdrop or extrusion
  color, an absent/zero contour or a positive contour with a resolvable color, no bottom bevel or
  preset material, and only an optional outer shadow in `effectLst`;
- an opaque resolved solid-fill `donut`/`ellipse`/`rect`/`roundRect` shape, or a rectangular
  stretch-filled picture; the ellipse lane is pinned across square, wide, and tall silhouettes,
  explicit and theme paint sources, and standalone or non-identity-group containers; the donut
  lane also pins its `0..50000` adjustment bounds and `25000` default;
- for pictures, no `a:srcRect`, or finite nonnegative crop fractions whose left/right and
  top/bottom sums each leave more than the renderer's `0.001` visible-fraction tolerance.

The renderer treats `bevelT@w` as the inward face extent and `bevelT@h` as elevation that scales
lighting contrast. A six-slide native matrix pairs omitted/default encodings with explicit
`circle`/76200-EMU values for a square rectangle, wide round rectangle, and tall ellipse. Both
PowerPoint and renderer pairs must have identical raster hashes. It immediately paints four clipped
`userSpaceOnUse` gradients as a synchronous
fallback. When a render context is available, it rasterizes the exact even-odd SVG path into a
Canvas alpha mask at up to 2x scale within a 262,144-pixel budget. `DistanceField.ts` computes the
exact interior Euclidean distance transform, and `BevelLighting.ts` smooths its gradient into
continuous perimeter normals, applies a circular bevel cross-section, and evaluates the bounded
light direction. This allows rounded corners to bend the light field around their silhouette rather
than retaining rectangular face boundaries.

The resulting transparent texture replaces only the fallback lighting after its object URL decodes.
Solid shapes map light and shadow through material-color lookup tables so highlights retain the
source hue; pictures use relative black/white overlays so their pixels remain visible. The render
plan carries material intensity separately from bevel geometry. Solid-shape highlights preserve the
common material response, while shadow attenuation starts with a log-aspect curve and then applies
native-backed geometry anchors: `0.415` at 2.5:1 for wide rect/ellipse surfaces, `0.370` for the
wide donut, the prior rounded-rectangle response for `roundRect`, and `0.646` at 0.46875:1 for a
10 pt tall rectangle. A separate 6 pt square-rectangle anchor corrects its native dark face, while
a `0.572` square-donut anchor preserves the native peak amplitude. Square ellipse/donut rows use an
effective 330° three-point bearing fitted from their native directional fields; non-square verified
rows retain 350°, with a continuous transition near square. Solid donuts also use a log-aspect
profile that combines a broad edge-opacity floor with a compressed directional shadow lobe. The
profile is bounded by the native tall, square, and wide matrices, then verified between those anchors
by a nine-slide `0.75|1.25|2.0` aspect × `10000|default25000|40000` adjustment matrix. It leaves
positive key highlights on the common material response. A grouped donut is rasterized in its child
OOXML coordinate system before the parent group's non-identity stretch; grouped rect and ellipse
lighting keep their separately verified screen-space path. The schema-v8 local metric caps general
candidate/native shadow amplitude at `1.05`, tightened to `1.01` for solid donut faces, and also
caps the donut's mean negative shadow energy at `1.05` and non-cancelling per-pixel local shadow
excess at `0.30` of native mean shadow energy. It also caps each salient 30° donut contour sector at
`1.60` candidate/native shadow energy. This prevents a locally over-dark sector from passing because
its peak or total energy is offset by a lighter sector elsewhere. Native
evidence calibrates the implicit `twoPt:t` picture response
independently from the solid-shape `threePt:t` response. Texture
work is serialized through the slide's `asyncTasks`, cached in `mediaUrlCache` by geometry,
dimensions, bevel, light, intensity, surface, raster size, and algorithm version, and guarded by the
slide abort signal.
Failure, insufficient raster scale, or disposal leaves the vector fallback in place and prevents
late DOM writes or cache repopulation.

The bottom-bevel front-material planner is a separate edge-on lane. It accepts only direct slide
rectangles that are not placeholders, use explicit opaque `#4472C4` without a visible outline, and
match the native matrix's 2:1, 1:1, or 3.2:5.2 aspect ratio. Scene requirements are
`orthographicFront`, zero depth/contour/`z`, and `threePt:t` with absent rotation or exactly
`lat=0`, `lon=0`, `rev=50°`. Shape requirements are a default-size 76200-EMU `relaxedInset` or
`circle` bottom bevel and either `dkEdge` or absent preset material. The renderer reuses the
camera-plane SVG replacement for the uniform front response (`#4676CB` or `#4B7BD0`) and does not
invent a bottom rim that PowerPoint does not show in this view. `RenderContext.nodeOrigin` and
`groupDepth` carry parent provenance through slide, layout, master, placeholder, and recursive group
paths, so a matching child cannot accidentally enter the standalone-only lane. Live text stays in
its existing overlay. A 5% alpha fill remains on the ordinary composition path because the paired
native 3D/flat rows differ by at most one RGB level.

The camera-plane plan is a separate zero-depth lane with preset/custom solid SVG, live DOM text, and
live picture modalities. All require no local rotation or flip, backdrop, nonzero `z`, explicit
effect list, bevel, contour, extrusion color, material, or extrusion. The preset solid modality
requires rectangular geometry, an opaque supported fill, no visible text, and no visible stroke. The
custom solid modality is limited to a standalone shape with no `p:style` or `a:sp3d`, explicit
opaque `#2F75B5` or `#FFFFFF` paint, no visible text or stroke, and one `1000×1000` `a:custGeom`
path. Its `avLst`, `gdLst`, `ahLst`, and `cxnLst` must be present and empty; its text rectangle must
be the identity `l/t/r/b` rectangle; and it must contain at least two closed numeric contours made
only from `moveTo`, `lnTo`, `cubicBezTo`, and `close`, with no path-level paint attributes. The only
accepted physical bounds are `403.2×403.2`, `768×307.2`, and `307.2×518.4` CSS pixels. The text modality requires
no shape fill, an absent line element and `p:style`, plus local `bodyPr wrap="none"` with the bounded
anchor tuple and `a:spAutoFit`; inherited body properties, vertical text, and independent text bounds
remain flat. The picture modality requires `a:stretch` without `a:fillRect`, a rectangular preset,
no style reference, outline, picture background fill, or blip effect, and an absent or finite
nonnegative source crop with positive remaining width and height. All modalities reject explicit
effect lists; solid matrix rows retain the generator's exact theme `effectRef=2` outer-shadow style.
The accepted camera/light tuples are deliberately finite:

- `orthographicFront` with absent rotation;
- `orthographicFront` with `lat=20°`, `lon=30°`, `rev=0°`;
- `perspectiveRelaxedModerately` with `fov=120°`, `lat=18590633/60000°`, `lon=0°`, `rev=0°`;
- `perspectiveContrastingRightFacing` live text with `fov=85°`, `lat=0°`,
  `lon=19532225/60000°`, `rev=0°`;
- `perspectiveLeft` live text with `fov=120°`, absent explicit rotation, and implicit
  `lat=0°`, `lon=20°`, `rev=0°`;
- `perspectiveRight` live pictures with `fov=95°`, absent explicit rotation, and implicit
  `lat=0°`, `lon=-20°`, `rev=0°`;
- `threePt:t` lighting without light rotation and no camera zoom.

`shape3d/CameraProjection.ts` rotates the four local plane corners around Y, then X, applies camera
revolution, and performs perspective division when required. The perspective distance uses the
presentation width and field of view; preset constants describe the native-observed viewport and
projected-plane scales. The bounded custom family uses its independently calibrated `1.1` viewport
and projection scales across the square/wide/tall native matrix. The renderer emits one replacement
SVG path and hides the ordinary flat path only after that replacement exists. Perspective solid rows receive a vertical `linearRGB`
material field; identity and rotated orthographic controls use their native-observed flat material
responses. The scene-only solid row's theme `effectRef=2` outer shadow is transferred from the
hidden source path to this projected path. Its SVG filter uses the projected four-corner bounds to
avoid clipping overflow, scales blur and distance by the plane's measured horizontal projection,
applies a native-calibrated `0.95` footprint factor to orthographic planes, and uses sRGB filter
interpolation for the native-verified camera tuple. For the exact text tuples,
`projectiveTransformToCssMatrix3d()` solves a rectangle-to-quad
homography and applies it after text layout, while preserving the text DOM. The picture path applies
the same homography to the existing crop-clipping stage, preserving the image pipeline and its
source-crop semantics. The group path creates one child layer in group coordinates,
renders the two supported pictures into it, and applies the homography only after child layout.
This preserves sibling composition and avoids projecting each child around a separate origin. It
requires positive explicit group and child-coordinate extents, exactly two direct embedded
stretch-filled rectangular picture children, optional valid source crops, no target shape format or
effects, and no local or ancestor rotation, flip, or 3D scene. Coordinate-only ancestors remain
eligible. Its native-calibrated lighting response applies a bounded log-aspect brightness correction
to the live child content and a low-alpha white overlay after child rendering.
`RenderContext.groupAncestorHas3dScene` propagates scene ancestry even when an ancestor
falls back, preventing nested partial projection. For the custom SVG lane, the same homography projects each absolute line
point directly. A projective transform maps polynomial cubics to rational cubics, so the renderer
adaptively flattens each supported cubic in projected screen space with a maximum `0.25px` error,
ten subdivision levels, and bounded token/point budgets while preserving closed contours and
even-odd fill. This is independent planar math and does not introduce a mesh or WebGL dependency.

The twenty-five-slide leaf camera native matrix covers identity and rotated orthographic controls, explicit
`a:sp3d`, scene-only implicit depth, square/wide/tall perspective shapes, explicit and theme paint,
a non-identity group, two square/wide/tall live-text camera tuples, and four live-picture rows with
absent, horizontal, vertical, and asymmetric source crops. It also crosses the bounded custom-path
silhouette over square/wide/tall physical bounds and explicit blue/white paint. Public solid-paint
support remains limited to the exact registry rows. A separate eight-slide native group matrix crosses
square/wide/tall standalone groups and a nested source-cropped group under a coordinate-only ancestor
against scene-absent inverses. The schema-v7 local metric binds the
exact native rasters and checks normalized four-corner geometry, material color, gradient response,
and required external-shadow evidence for solid planes; resolution-tolerant foreground, bounds, and
ink retention for live text; and inverse-projected picture color plus tolerant edge fidelity for
picture planes, in addition to the full-page oracle gate. Its `picture-group` modality reuses the
picture corner, rectified-color, edge, and crop-mutation checks for the composed surface; schema-v6
reports remain backward compatible for the existing modalities. Custom rows require tolerant foreground
F1 `0.95`, tolerant bounds score `0.98`, candidate/reference foreground area ratio `0.90`, centroid
score `0.99`, and color score `0.98`. Bottom-front rows add normalized corner
coverage and three interior material bands with mean RGB error at most `1.0`. The report also runs
deterministic sensitivity mutations against the same rasters: erasing a measurable exterior shadow,
applying a 12% left crop plus rescale to rectified picture content, and restoring bottom-front rows
to the source flat fill. It vertically squashes every custom candidate to 20% height and requires
that mutation to fail the custom silhouette gate. The derived gate fails if any applicable mutation
still passes its target metric.

The contour remains a separate SVG path, shape text stays outside the lighting group, and a 3D
picture's ordinary outline remains centered on its source bounds. Unique per-effect IDs prevent
cross-slide collisions. Existing wrapper transforms, outer shadows, media ownership, and cleanup
remain in their owning renderers. Group reflection remains diagnostic outside the promoted
group-camera matrix, but its clone is now created
after child rendering so the reflected source contains the completed subtree, including a projected
child layer.

Anything outside the registry's bounded tuples stays on the existing flat path with a stable planner reason.
Other perspective and rotated cameras, nonzero extrusion, materials/bevels/lights outside the
verified top-bevel, camera-plane, and bottom-front tuples, negative
or degenerate picture source crops, custom geometry outside the exact path profile or verified
physical bounds, gradient/pattern/group/image-filled leaf shapes, tiled pictures, arbitrary group
scene tuples or child mixtures,
chart `view3D`, and Office 2017 `model3d` are separate capability lanes. The raster lighting backend
can consume arbitrary silhouettes, but support is still constrained by the planner and native
evidence. This is bounded static rendering, not a general mesh or PowerPoint material engine.

## Rendering Strategies

`renderList()` supports:

- Default (`windowed: false`): mount all slide DOM nodes.
- Windowed (`windowed: true`): mount near-viewport slides via `IntersectionObserver`, with fallback to full mode when unavailable.

This keeps default behavior backward compatible while enabling lower memory pressure for large decks.
For large viewer surfaces, `windowed: true` pairs with `lazySlides: true` so off-screen
slides do not pay shape/table/chart parsing cost before the first visible slides render.
For media-heavy decks, `lazyMedia: true` also keeps package media compressed until a
rendered slide references it.

## Search, Highlights, and Scaled Previews

Text search is a model-layer feature. `buildTextIndex()`, `searchText()`, and
`searchPresentation()` read normalized shape, table, and group text from `PresentationData`
instead of scanning rendered DOM nodes. `PptxViewer.searchText()` is the viewer-level
convenience wrapper around the same search model.

String queries default to case-insensitive matching and can opt into exact casing with
`matchCase: true`. RegExp queries keep caller-provided flags; the search layer only adds
`g` so all matches can be collected.

Search results return `TextSearchResult` metadata such as `slideIndex`, `nodeId`,
`nodePath`, match offsets, snippet text, and node `bounds`. The bounds are intrinsic
slide coordinates for the matched shape or table cell owner. This keeps the public API
stable even when a slide is not currently mounted.

`highlightSearchResult()` is a DOM helper for the common viewer UI case. It draws a
node-level overlay using default highlight styling, and accepts `SearchHighlightOptions`
for custom class names, border colors, background colors, shadows, padding, radius, and
z-index. The returned `SearchHighlightHandle` is owned by the caller; call
`dispose()` or `clearSearchHighlights()` to remove overlays.

The renderer intentionally does not provide character-level text highlighting today.
Mapping match offsets back to shaped Office text runs, wrapped lines, bullets, and
vertical text is a separate renderer problem. The current boundary is model-level search
plus node-level highlight overlays.

`renderThumbnailToContainer()` renders a slide at intrinsic size and scales the result
with CSS transforms inside a clipped wrapper. It is a scaled DOM/SVG preview for
navigation surfaces, not a separate bitmap generation pipeline. The caller owns the
returned `SlideHandle` and must dispose it when the preview is no longer needed.

## Design Constraints

- Keep parser/model deterministic for reproducible QA runs.
- Keep rendering resilient: per-node/per-slide failures should not crash the whole deck.
- Keep security boundaries explicit at parse and navigation boundaries.
- Keep optional heavy dependencies such as `pdfjs-dist` outside the core render path unless
  the consumer explicitly configures them.

## Non-Goals (Current)

- Full fidelity parity with Microsoft PowerPoint for every OOXML edge case.
- Server-side rendering runtime in this repository.
- Full EMF/WMF vector instruction rendering. EMF support is limited to fallback previews.
