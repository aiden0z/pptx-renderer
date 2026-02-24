# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
