# Performance Guide

This document describes practical tuning options for `@aiden0z/pptx-renderer` without
changing rendered output semantics. Defaults stay eager for backward compatibility; the
large-deck optimizations below are opt-in.

## List Render Options

Pass these via `renderList(options)` or `PptxViewer.open(input, container, { listOptions })`:

- `batchSize`: number of slides appended per frame batch (default: `12`).
- `windowed`: enable IntersectionObserver-based windowed mounting (default: `false`).
- `initialSlides`: how many slides to mount immediately in windowed mode (default: `4`).
- `overscanViewport`: pre-mount range in viewport heights (default: `1.5`).

ZIP parser safety/performance knobs (pass via `ViewerOptions.zipLimits` or `PptxViewer.open()`):

- `zipLimits.maxEntries`
- `zipLimits.maxEntryUncompressedBytes`
- `zipLimits.maxTotalUncompressedBytes`
- `zipLimits.maxMediaBytes`
- `zipLimits.maxConcurrency`

Use `RECOMMENDED_ZIP_LIMITS` as a safe starting point for untrusted PPTX input.

```ts
import { PptxViewer, RECOMMENDED_ZIP_LIMITS } from '@aiden0z/pptx-renderer';
```

| Limit                       | Recommended value | Effect                                                |
| --------------------------- | ----------------- | ----------------------------------------------------- |
| `maxEntries`                | `4000`            | Rejects archives with excessive file counts           |
| `maxEntryUncompressedBytes` | `32 MiB`          | Rejects a single oversized uncompressed entry         |
| `maxTotalUncompressedBytes` | `256 MiB`         | Rejects large total decompressed archives             |
| `maxMediaBytes`             | `192 MiB`         | Rejects large total media payloads under `ppt/media/` |
| `maxConcurrency`            | `8`               | Bounds concurrent ZIP entry reads                     |

If JSZip metadata does not provide a trustworthy uncompressed size, parsing still checks the actual decoded entry size before accepting the entry. This fallback applies to XML/text entries and media entries, so the same limits remain effective for archives whose size metadata is unavailable.

## Lazy Media Decoding

Large decks often spend most memory on decompressed `ppt/media/*` entries. By default,
`parseZip()` keeps backward-compatible eager behavior and decodes all package media during
ZIP parsing. For media-heavy decks, enable `lazyMedia` so media entries are indexed during
parse and decoded only when a rendered slide references them.

```ts
await PptxViewer.open(buffer, container, {
  zipLimits: RECOMMENDED_ZIP_LIMITS,
  lazyMedia: true,
  listOptions: {
    windowed: true,
    initialSlides: 4,
    batchSize: 4,
  },
});
```

If you use the manual parse/model/render pipeline, call `parseZipLazyMedia()`:

```ts
import {
  PptxViewer,
  parseZipLazyMedia,
  buildPresentation,
  RECOMMENDED_ZIP_LIMITS,
} from '@aiden0z/pptx-renderer';

const files = await parseZipLazyMedia(buffer, RECOMMENDED_ZIP_LIMITS);
const presentation = buildPresentation(files);

const viewer = new PptxViewer(container);
viewer.load(presentation);
await viewer.renderList({ windowed: true, initialSlides: 4 });
```

Use this when memory pressure is the bottleneck. In the current local benchmark,
windowed rendering reduced decompressed media bytes by:

- Large media-heavy deck: 70.9 MiB -> 3.5 MiB (95.0% lower)
- Medium media-heavy deck: 30.9 MiB -> 0.9 MiB (97.1% lower)
- Smaller image-heavy deck: 3.2 MiB -> 0.9 MiB (72.5% lower)

This is primarily a memory optimization. It moves some media decompression from parse
time to visible-slide render time, so small decks and full-DOM rendering may not get
lower wall-clock render time. The best fit is `lazyMedia: true` plus `windowed: true`
for large, media-heavy decks.

## Lazy Slide Node Parsing

Large decks can also spend significant time building every slide's shape, table, chart,
picture, and group nodes before the first visible slide is rendered. Enable `lazySlides`
to keep those per-slide nodes deferred until a slide is rendered, searched, serialized,
or explicitly materialized by a model consumer.

```ts
await PptxViewer.open(buffer, container, {
  zipLimits: RECOMMENDED_ZIP_LIMITS,
  lazySlides: true,
  listOptions: {
    windowed: true,
    initialSlides: 4,
    batchSize: 4,
  },
});
```

If you use the manual pipeline, pass the same option to `buildPresentation()`:

```ts
import { buildPresentation, parseZip, RECOMMENDED_ZIP_LIMITS } from '@aiden0z/pptx-renderer';

const files = await parseZip(buffer, RECOMMENDED_ZIP_LIMITS);
const presentation = buildPresentation(files, { lazySlides: true });
```

Use this when first-render latency is the bottleneck and your UI mounts only a subset of
slides initially. In the current local benchmark, `lazySlides` reduced model build time
by about 52-66% on medium and large decks, and reduced parse + build + render time for
the first window by about 16-22%. Materialized slide nodes in the initial window dropped
from hundreds or thousands of nodes to only the visible-window nodes.

This is primarily a startup and first-window optimization. Full-DOM rendering still has
to parse every slide before it can finish, so `lazySlides` may only move work from model
build time into render time for full-render/export-style workflows. For those workflows,
prefer the default eager model unless first visible content is more important than total
completion time. Combining `lazySlides` with `lazyMedia` can lower media memory by more
than 95% on media-heavy decks, but it also moves media decoding into visible-slide render
time, so total wall-clock time depends on deck shape and browser cache state.

`serializePresentation()`, `buildTextIndex()`, `searchPresentation()`, and viewer search
materialize deferred slide nodes before reading them, so search/export behavior remains
compatible with eager presentations. Manual consumers can call `materializeSlideNodes()`
for one slide or `materializeAllSlideNodes()` for the full model.

## Built-In Resource Guards

These guards are applied by the renderer even when ZIP byte limits are configured, because some PPTX structures can be small on disk but expensive after parsing:

- Chart cache point indexes are capped at `10,000` per cache. Oversized `c:ptCount` values do not drive array allocation.
- EMF bitmap previews are rejected above `16,777,216` decoded pixels, above `8192x8192` dimensions, or when the declared bitmap payload is truncated.
- External audio/video media is not preloaded automatically; rendered media elements use `preload="none"`.
- EMF-PDF fallback Workers are short-lived and have a 15-second deadline. Disposing the
  slide cancels the work immediately. At most four PDF fallback Workers run concurrently;
  callers should dispose off-screen slide and thumbnail handles so queued work is removed.

## Browser Bundle and Charts

The standalone `./browser` entry uses ECharts' tree-shakeable core API and bundles only
the chart types/components used by the renderer. The regular package entry keeps
`echarts/*` external so the host bundler can deduplicate it. Do not replace the central
runtime registration with `import * as echarts from 'echarts'`; that restores the full
ECharts bundle and bypasses the standalone size budget.

Chart animation is disabled because the renderer produces static slide content and does
not implement OOXML animation timelines. This makes first paint and screenshot/export
timing deterministic while avoiding transition work that cannot match PowerPoint.

Chart registrations and the standalone package are exercised in Chromium by
`pnpm test:browser`. Run it together with `pnpm size` after changing chart imports,
package side-effect metadata, or Vite configuration.

## Recommended Presets

### Small deck (<= 30 slides)

```ts
await PptxViewer.open(buffer, container, {
  zipLimits: RECOMMENDED_ZIP_LIMITS,
  listOptions: { batchSize: 12 },
});
```

### Medium deck (30-150 slides)

```ts
await PptxViewer.open(buffer, container, {
  zipLimits: RECOMMENDED_ZIP_LIMITS,
  lazySlides: true,
  listOptions: {
    windowed: true,
    batchSize: 8,
    initialSlides: 4,
    overscanViewport: 1.5,
  },
});
```

### Large deck (> 150 slides)

```ts
await PptxViewer.open(buffer, container, {
  zipLimits: RECOMMENDED_ZIP_LIMITS,
  lazySlides: true,
  lazyMedia: true,
  listOptions: {
    windowed: true,
    batchSize: 4,
    initialSlides: 2,
    overscanViewport: 2,
  },
});
```

## Strategy Selection

- Omit `windowed` (or set to `false`) when you need all slides in DOM at once (some compare/export pipelines).
- Use `windowed: true` when memory pressure and long first-render latency are the bottleneck.
- Use `lazySlides: true` with windowed rendering when model build time is delaying first paint.
- Use `lazyMedia: true` with windowed rendering when decompressed media memory is the bottleneck.
- If `IntersectionObserver` is unavailable, windowed mode automatically falls back to full mounting.
- A newer render request supersedes older queued or batched work. This keeps rapid calls such as `setZoom()`, `setFitMode()`, `renderList()`, and `renderSlide()` from continuing stale list batches after the next request has been queued.

## Search and Preview UI

`PptxViewer.searchText()` searches the parsed presentation model. Prefer it over DOM
scanning for in-app search because it works before slides are mounted, avoids forcing
windowed slides into the DOM, and returns stable node bounds for highlight overlays.

`highlightSearchResult()` draws a node-level overlay on an existing rendered slide. It is
cheap compared with full slide rendering, but callers should still dispose returned
handles or call `clearSearchHighlights()` when changing active search results.

`renderThumbnailToContainer()` is not a bitmap thumbnail generator. It renders real
DOM/SVG slide content at the slide's intrinsic layout size and then scales that content
inside a clipped preview wrapper. This avoids the layout drift caused by rendering a
PowerPoint slide directly into a tiny container, but it still has the CPU, DOM, SVG,
image, and chart cost of rendering a slide.

For large decks:

- Keep thumbnail containers small and fixed-size so selection state does not resize the
  sidebar.
- Mount previews lazily with `IntersectionObserver` or a virtual/windowed list.
- Limit concurrent preview rendering; avoid eagerly rendering every slide preview on
  initial load.
- Dispose thumbnail `SlideHandle`s when previews leave the navigation surface.
- Use model search results plus `highlightSearchResult()` for active hits instead of
  re-rendering slides for every search step.

## E2E/Test Page Overrides

Dev pages support URL overrides:

- `listStrategy=full|windowed`
- `listBatchSize=<int>`
- `windowedInitialSlides=<int>`
- `windowedOverscanViewport=<number>`

Examples:

- `/test/pages/index.html?listStrategy=windowed&listBatchSize=6`
- `/test/pages/e2e-compare.html?file=sample&listStrategy=full`

## Benchmarking Notes

- Compare both first contentful render and interaction smoothness.
- Measure memory (DOM node count + browser heap) on long decks.
- Use `test/perf/render_benchmark.py --lazy-slides --lazy-media` to measure the combined large-deck path.
- Validate visual parity with existing unit/e2e tests after tuning.
