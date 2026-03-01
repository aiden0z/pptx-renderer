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

## Recommended Presets

### Small deck (<= 30 slides)

```ts
await PptxViewer.open(buffer, container, {
  listOptions: { batchSize: 12 },
});
```

### Medium deck (30-150 slides)

```ts
await PptxViewer.open(buffer, container, {
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
