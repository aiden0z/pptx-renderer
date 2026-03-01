# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-03-01

### Added

- **`PptxViewer`** — new recommended API class extending `EventTarget`. Separates parsing, model loading, and rendering into distinct steps:
  - `PptxViewer.open(input, container, options?)` — static factory that parses, builds, and renders in one call.
  - `viewer.load(presentation)` — load a `PresentationData` model without rendering.
  - `viewer.renderList(options?)` — render all slides in a scrollable list.
  - `viewer.renderSlide(index?)` — render a single slide (no built-in nav UI).
- **`SlideHandle`** — per-slide resource lifecycle returned by `renderSlide()` and `renderSlideToContainer()`. Tracks chart instances and blob URLs for deterministic cleanup via `handle.dispose()`.
- **`ListRenderOptions`** — dedicated options type for `renderList()`: `windowed`, `batchSize`, `initialSlides`, `overscanViewport`.
- **EventTarget events** — `slidechange`, `sliderendered`, `slideerror`, `slideunmounted`, `nodeerror`. Typed via `PptxViewerEventMap`. Shorthand callbacks (`onSlideChange`, etc.) also supported.
- **`Symbol.dispose`** — `PptxViewer` implements TC39 Explicit Resource Management (`using viewer = ...`).
- `scrollContainer` option: custom scroll root for `IntersectionObserver` in windowed list mode.
- `onSlideUnmounted` callback / `slideunmounted` event: fires after a slide is unmounted in windowed list mode.
- `isSlideMounted(index)` and `getMountedSlides()` methods: query which slides are currently mounted in the DOM.
- `AbortSignal` support in `PptxViewer.open()` and `PptxRenderer.preview()`.
- `ScrollIntoViewOptions` parameter in `goToSlide(index, scrollOptions?)`.
- Scroll-based slide tracking in list mode via `IntersectionObserver` (fires `slidechange` for the most-visible slide).
- **`renderstart` / `rendercomplete` events** — bracket every render cycle (renderList, renderSlide, setZoom, setFitMode). `rendercomplete` fires even when render throws.
- **`isRendering` getter** — `true` between `renderstart` and `rendercomplete`.
- **`on()` / `off()` typed event helpers** — convenience wrappers over `addEventListener`/`removeEventListener` with proper generics. Returns `this` for chaining.
- **`zoomPercent` / `fitMode` getters** — read current zoom level and fit mode.
- **Instance-level `open()` method** — parse, build, and render from binary input on an existing viewer. Cleans up previous state on re-open. Static `PptxViewer.open()` now delegates to this.
- `onRenderStart` / `onRenderComplete` shorthand options in `ViewerOptions`.

### Changed

- `renderSlide()` (from `SlideRenderer`) now returns `SlideHandle` instead of `HTMLElement`.
- `renderSlideToContainer()` now returns `SlideHandle` instead of `HTMLElement | null`.
- `onSlideChange` now fires in both list mode (scroll tracking) and slide mode (navigation). Previously only documented for slide mode.
- **`slidechange` now fires after every render cycle** (renderList, renderSlide, setZoom, setFitMode), reporting the current slide index. This means consumers always receive an initial `slidechange` after the first render.
- **`goToSlide()` now returns `Promise<void>`** instead of `void`. In list mode, resolves after initiating mount + scroll. In slide mode, resolves synchronously.
- **`renderSingleSlide` error handling** — errors in slide mode now show an error placeholder (consistent with list mode) instead of propagating.
- `pdfjs-dist` moved from `dependencies` to optional `peerDependencies`. Install separately if using SmartArt PDF fallback rendering: `npm install pdfjs-dist`.

### Deprecated

- **`PptxRenderer`** — use `PptxViewer` instead. `PptxRenderer` extends `PptxViewer` and provides the legacy `preview()` API with built-in nav buttons in slide mode.
- **`RendererOptions`** — use `ViewerOptions` instead.

### Fixed

- `renderSlideToContainer()` now passes `chartInstances` to `renderSlide()`, preventing ECharts memory leaks in external containers.
- `renderSingleSlide()` (slide mode) now passes `chartInstances` to `renderSlide()` for proper chart lifecycle tracking.
- Main-thread pdfjs fallback no longer sets `GlobalWorkerOptions.workerSrc` to a URL, eliminating global pollution when host apps use their own pdfjs instance.

## [1.0.0] - 2026-02-28

### Added

- Browser-side PPTX parsing and rendering (`list` and `slide` modes).
- **Shape geometry**: 187+ preset shapes from ECMA-376 spec, plus custom geometry (`<a:custGeom>`) interpreter. 33+ multi-path 3D shapes with lighten/darken face modifiers.
- **Text rendering**: 7-level OOXML style inheritance, theme fonts, numbered/symbol/picture bullets, vertical text, superscript/subscript, hyperlinks.
- **Charts**: bar, line, area, pie, doughnut, radar, scatter, surface (2D and 3D variants) via ECharts.
- **Fill & stroke**: solid, linear/radial/rectangular gradient, 52+ pattern fills, image fills; 8 dash styles, 5 arrowhead types, compound lines.
- **Color pipeline**: full OOXML resolution — schemeClr → colorMap → theme lookup → modifiers (lumMod, lumOff, tint, shade, alpha, satMod, etc.). All 6 color spaces supported.
- **SmartArt**: 134+ layouts via PowerPoint fallback data.
- **Tables**: OOXML table styles, cell merge (gridSpan + rowSpan), border inheritance.
- **Images**: blob URL rendering with crop, stretch/tile, video/audio placeholders.
- **Groups**: coordinate remapping (chOff/chExt) with recursive child rendering.
- **Backgrounds**: slide → layout → master inheritance chain (solid, gradient, image, pattern).
- **Security**: ZIP parsing limits (`ZipParseLimits`), external hyperlink protocol filtering.
- **Performance**: windowed list mounting via `IntersectionObserver`, batch rendering, large-deck tuning knobs.
- **Visual regression testing**: 352+ automated cases (187+ shapes, 134+ SmartArt, 37+ fill/stroke variants) verified against PowerPoint output using SSIM + color histogram correlation. Zero failures.
- **Quality tooling**: ESLint, Prettier, commitlint (Conventional Commits), husky pre-commit hooks, knip (dead code detection), publint, size-limit.
- **Documentation**: architecture, testing, performance, contributing, security, and releasing guides.

### API

- Main class: `new PptxRenderer(container, options)`
- Core render call: `await renderer.preview(input)` where `input` is `ArrayBuffer | Uint8Array | Blob`
- Navigation/lifecycle: `goToSlide(index)`, `destroy()`
- Runtime scaling: `setZoom(percent)`, `setFitMode('contain' | 'none')`
- Utility exports: `parseZip`, `buildPresentation`, `serializePresentation`
