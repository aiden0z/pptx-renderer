# Documentation

## Core

- [Architecture](ARCHITECTURE.md) — Three-layer pipeline (Parse -> Model -> Render), SafeXmlNode pattern, DOM construction strategy
- [Testing](TESTING.md) — Unit tests (vitest), E2E visual comparison, baseline-driven shape/SmartArt evaluation, two-layer metric system
- [Performance](PERFORMANCE.md) — Windowed mounting, batch tuning, large-deck optimization

## Quality & Process

- [Contributing](CONTRIBUTING.md) — PR checklist, code style, test requirements
- [Security](SECURITY.md) — ZIP parse limits, URL filtering, vulnerability reporting
- [Releasing](RELEASING.md) — Release checklist and versioning

## Community

- [Community](COMMUNITY.md) — Issue labels and collaboration expectations
- [Code of Conduct](CODE_OF_CONDUCT.md) — Community behavior policy

## Baseline Pipeline

The baseline-driven E2E testing system is documented across:

- [Testing Guide](TESTING.md) — Metric system, evaluation commands, shape fix protocol
- [Baseline Pipeline](../test/e2e/oracle/README.md) — Case format, VBA macro, ground truth generation
- [CLAUDE.md](../CLAUDE.md) — Shape/SmartArt fix workflow quick reference (for AI-assisted development)

## GitHub Templates

- PR template: `.github/pull_request_template.md`
- Issue templates:
  - `.github/ISSUE_TEMPLATE/bug_report.md`
  - `.github/ISSUE_TEMPLATE/feature_request.md`
  - `.github/ISSUE_TEMPLATE/compatibility_gap.md`
