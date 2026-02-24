# Contributing Guide

Thanks for contributing to `@aiden0z/pptx-renderer`.

## Ways to Contribute

- Report bugs with reproducible PPTX samples.
- Propose compatibility improvements for OOXML edge cases.
- Improve performance and memory behavior.
- Add tests (unit or e2e) for rendering regressions.
- Improve documentation.

## Development Setup

```bash
pnpm install
pnpm dev
pnpm test
```

## Branch and PR Workflow

1. Create a feature branch from `main`.
2. Keep changes focused and small.
3. Add or update tests for behavior changes.
4. Run test suite locally before opening PR.
5. Open PR with summary, risk notes, and test evidence.

Branch naming examples:

- `fix/zip-parse-limits`
- `feat/windowed-list-mounting`
- `docs/readme-faq`

## Commit Guidance

Use clear, scoped commit messages.

Example:

- `fix(parser): enforce zip media size limits`
- `feat(renderer): add hyperlink protocol whitelist`
- `docs: add open-source governance docs`

## Pull Request Checklist

- [ ] Code builds locally.
- [ ] Tests pass locally.
- [ ] New behavior is covered by tests.
- [ ] Backward compatibility impact is documented.
- [ ] Security implications are documented when relevant.
- [ ] PR template sections are filled with concrete verification output.

## Reporting Bugs

Include:

- Expected behavior
- Actual behavior
- Minimal PPTX that reproduces the issue
- Browser/runtime info
- Console logs or stack traces

Prefer GitHub issue templates:

- Bug report: `.github/ISSUE_TEMPLATE/bug_report.md`
- Compatibility gap: `.github/ISSUE_TEMPLATE/compatibility_gap.md`
- Feature request: `.github/ISSUE_TEMPLATE/feature_request.md`

## Code Quality Tools

Run before opening a PR:

```bash
pnpm lint          # ESLint (src/ only)
pnpm format:check  # Prettier check
pnpm typecheck     # tsc --noEmit
pnpm test          # vitest unit tests
pnpm knip          # detect unused exports/dependencies
```

Auto-fix shortcuts: `pnpm lint:fix`, `pnpm format`.

**Git hooks (enforced automatically):**

- `pre-commit`: runs `eslint --fix` + `prettier --write` on staged `src/**/*.ts` files via lint-staged.
- `commit-msg`: enforces [Conventional Commits](https://www.conventionalcommits.org/) via commitlint (e.g. `fix(parser):`, `feat(renderer):`, `docs:`).

## Code Style Notes

- Single quotes, trailing commas, 100 char print width, 2-space indent.
- Unused vars prefixed `_` are allowed; `no-console` warns (except `console.warn/error`).
- Prefer explicit, readable logic over clever shortcuts.
- Keep parser and renderer behavior deterministic.
- Avoid adding large dependencies unless necessary.

## Documentation Change Guidance

- Update `README.md` when user-facing behavior or API usage changes.
- Update `docs/*` pages when process, architecture, or release behavior changes.
- Add a short entry to `CHANGELOG.md` for user-visible updates.
