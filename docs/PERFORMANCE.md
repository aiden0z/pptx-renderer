# Performance Guide

This document describes practical tuning options for `@aiden0z/pptx-renderer` without changing render output semantics.

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

## Built-In Resource Guards

These guards are applied by the renderer even when ZIP byte limits are configured, because some PPTX structures can be small on disk but expensive after parsing:

- Chart cache point indexes are capped at `10,000` per cache. Oversized `c:ptCount` values do not drive array allocation.
- EMF bitmap previews are rejected above `16,777,216` decoded pixels, above `8192x8192` dimensions, or when the declared bitmap payload is truncated.
- External audio/video media is not preloaded automatically; rendered media elements use `preload="none"`.

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
- Validate visual parity with existing unit/e2e tests after tuning.
