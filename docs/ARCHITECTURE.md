# Architecture

`@aiden0z/pptx-renderer` follows a three-stage pipeline:

1. Parse
2. Model
3. Render

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

Responsibilities:

- Build normalized in-memory presentation model.
- Resolve layout/master/theme inheritance.
- Parse node-level geometry, text, style, and relationship references.

## 3) Render Layer

Core modules:

- `src/core/Renderer.ts`
- `src/renderer/SlideRenderer.ts`
- `src/renderer/*Renderer.ts`

Responsibilities:

- Convert model into DOM elements per slide.
- Handle list/single-slide modes.
- Manage media object URL lifecycle.
- Handle internal/external navigation (with URL safety checks).

## Rendering Strategies

List mode supports:

- `full`: mount all slide DOM nodes.
- `windowed`: mount near-viewport slides via `IntersectionObserver`, with fallback to full mode when unavailable.

This keeps default behavior backward compatible while enabling lower memory pressure for large decks.

## Design Constraints

- Keep parser/model deterministic for reproducible QA runs.
- Keep rendering resilient: per-node/per-slide failures should not crash the whole deck.
- Keep security boundaries explicit at parse and navigation boundaries.

## Non-Goals (Current)

- Full fidelity parity with Microsoft PowerPoint for every OOXML edge case.
- Server-side rendering runtime in this repository.
