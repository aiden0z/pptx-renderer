# Documentation

## Core

- [Architecture](ARCHITECTURE.md) — Three-layer pipeline (Parse -> Model -> Render), template export, visibility/background ownership, search/highlight API boundaries, DOM construction strategy
- [Testing](TESTING.md) — Unit tests (vitest), E2E visual comparison, dev-page model search and thumbnail navigation, two-layer metric system
- [OOXML geometry source contract](../scripts/ooxml-geometry/README.md) — Pinned ECMA source, formula/IR compiler, SVG emitter, deterministic catalog, and migration gates
- [Performance](PERFORMANCE.md) — Windowed mounting, lazy slide parsing, lazy media decoding, batch tuning, scaled preview guidance, large-deck optimization

## Quality & Process

- [Contributing](CONTRIBUTING.md) — PR checklist, code style, test requirements
- [Security](SECURITY.md) — ZIP parse limits, external-media controls and boundaries, URL filtering, vulnerability reporting
- [Releasing](RELEASING.md) — Release checklist and versioning
- [v1.4.0 Release Notes](releases/v1.4.0.md) — External media controls, template export, hidden shapes, text and chart fixes
- [v1.3.0 Release Notes](releases/v1.3.0.md) — Equations, bounded static 3D and effects, CJK text, tables, charts, and standards-based geometry
- [v1.2.4 Release Notes](releases/v1.2.4.md) — Browser distribution, optional runtime lifecycle, parser hardening, and compact text overflow fixes
- [v1.2.3 Release Notes](releases/v1.2.3.md) — Connector marker and compact numeric text wrapping fixes
- [v1.2.2 Release Notes](releases/v1.2.2.md) — Chart, gradient, picture effect, table, text, shape, and SmartArt fidelity fixes
- [v1.2.1 Release Notes](releases/v1.2.1.md) — Flipped grouped content and compact chart fixes
- [v1.2.0 Release Notes](releases/v1.2.0.md) — Lazy slide parsing, lazy media decoding, performance notes, and demo updates
- [v1.1.0 Release Notes](releases/v1.1.0.md) — Search, highlights, scaled previews, and migration notes
- [v1.0.4 Release Notes](releases/v1.0.4.md) — PDF.js fallback setup and rendering fidelity notes

## Community

- [Community](COMMUNITY.md) — Issue labels and collaboration expectations
- [Code of Conduct](CODE_OF_CONDUCT.md) — Community behavior policy

## Baseline Pipeline

The baseline-driven E2E testing system is documented across:

- [Testing Guide](TESTING.md) — Metric system, evaluation commands, shape fix protocol
- [Baseline Pipeline](../test/e2e/oracle/README.md) — Case format, VBA macro, ground truth generation
- [AGENTS.md](../AGENTS.md) — Repo-local skills, current validation rules, and Shape/SmartArt fix workflow (for AI-assisted development)

## GitHub Templates

- PR template: `.github/pull_request_template.md`
- Issue templates:
  - `.github/ISSUE_TEMPLATE/bug_report.md`
  - `.github/ISSUE_TEMPLATE/feature_request.md`
  - `.github/ISSUE_TEMPLATE/compatibility_gap.md`
