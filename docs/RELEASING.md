# Release Process

## Pre-Release Checklist

- [ ] Update changelog/release notes
- [ ] Verify tests pass: `pnpm test`
- [ ] Verify build passes: `pnpm build`
- [ ] Verify lint/types/exports: `pnpm lint && pnpm typecheck && pnpm knip && pnpm publint`
- [ ] Verify bundle size: `pnpm size`
- [ ] Confirm `README` and docs are up to date
- [ ] Confirm security-impacting changes are documented

## Versioning

Use semantic versioning:

- `MAJOR`: breaking API changes
- `MINOR`: backward-compatible features
- `PATCH`: backward-compatible fixes

## Suggested Steps

1. Create release branch or prepare release commit on `main`.
2. Bump version in `package.json`.
3. Run full verification (`pnpm test`, `pnpm build`).
4. Tag release (`vX.Y.Z`).
5. Publish release notes with migration notes if needed.

## Command Scenario (GitHub + npm)

Use this sequence for an actual release:

1. Verify and build:
   - `pnpm test`
   - `pnpm build`
2. Commit release metadata:
   - `git add -A`
   - `git commit -m "chore: release vX.Y.Z"`
3. (Optional) Flatten history to one initial commit:
   - `/bin/zsh -lc 'NEW_ROOT=$(git commit-tree HEAD^{tree} -m "First commit") && git reset --hard "$NEW_ROOT"'`
4. Create annotated tag:
   - `git tag -a vX.Y.Z -m "vX.Y.Z"`
5. Push branch and tag:
   - `git push origin main`
   - `git push origin vX.Y.Z`
6. Create GitHub Release:
   - `gh release create vX.Y.Z --title "vX.Y.Z" --notes-file CHANGELOG.md`
7. Publish npm package:
   - `npm whoami`
   - `npm publish --access public`

## Release Notes Template

- Summary
- Added
- Changed
- Fixed
- Security
- Migration Notes
