# Performance Guide

This document describes practical tuning options for `@aiden0z/pptx-renderer` without changing render output semantics.

## Renderer Options

List mode tuning knobs:

- `listRenderBatchSize`: number of slides appended per frame batch.
- `listMountStrategy`:
  - `full` (default): mount all slide DOM nodes.
  - `windowed`: mount only near-viewport slides.
- `windowedInitialSlides`: how many slides to mount immediately in windowed mode.
- `windowedOverscanViewport`: pre-mount range in viewport heights.

ZIP parser safety/performance knobs:

- `zipLimits.maxEntries`
- `zipLimits.maxEntryUncompressedBytes`
- `zipLimits.maxTotalUncompressedBytes`
- `zipLimits.maxMediaBytes`
- `zipLimits.maxConcurrency`

## Recommended Presets

### Small deck (<= 30 slides)

```ts
{
  mode: 'list',
  listMountStrategy: 'full',
  listRenderBatchSize: 12
}
```

### Medium deck (30-150 slides)

```ts
{
  mode: 'list',
  listMountStrategy: 'windowed',
  listRenderBatchSize: 8,
  windowedInitialSlides: 4,
  windowedOverscanViewport: 1.5
}
```

### Large deck (> 150 slides)

```ts
{
  mode: 'list',
  listMountStrategy: 'windowed',
  listRenderBatchSize: 4,
  windowedInitialSlides: 2,
  windowedOverscanViewport: 2
}
```

## Strategy Selection

- Use `full` when you need all slides in DOM at once (some compare/export pipelines).
- Use `windowed` when memory pressure and long first-render latency are the bottleneck.
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
