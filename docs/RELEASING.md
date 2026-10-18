# Release Process

## Pre-Release Checklist

- [ ] Update the version in `package.json`, move changes from `Unreleased` into the dated changelog entry, and add `docs/releases/vX.Y.Z.md` to the docs index
- [ ] Verify tests pass: `pnpm test`
- [ ] Verify build passes: `pnpm build`
- [ ] Verify package entries, packlist/notices, and real browser paths: `pnpm test:package && pnpm test:browser`
- [ ] Verify PDF.js contracts: `pnpm test:pdfjs-contract` and the CI PDF.js 6 matrix job
- [ ] Verify lint/format/types/exports: `pnpm lint && pnpm format:check && pnpm typecheck && pnpm knip && pnpm publint`
- [ ] Verify generated geometry and capability contracts: `pnpm geometry:check && pnpm capability:check`
- [ ] Verify bundle size: `pnpm size`
- [ ] Check README API options/examples/support boundaries, architecture, security, testing/oracle case counts, and release workflow against the final candidate
- [ ] Retest available bug-report PPTX inputs on the final candidate; record original vs generated inputs, missing private originals, matching font/runtime provenance, and remaining differences
- [ ] Confirm security-impacting changes include option defaults, covered paths, and exclusions
- [ ] Confirm the exact candidate commit passes required CI before merging, and the release tree matches that candidate

## Versioning

Use semantic versioning:

- `MAJOR`: breaking API changes
- `MINOR`: backward-compatible features
- `PATCH`: backward-compatible fixes

## Suggested Steps

1. Create a release branch and PR.
2. Bump version in `package.json`.
3. Run the full pre-release checklist above.
4. Merge the verified candidate and synchronize local `main` without discarding unrelated work.
5. Tag the release (`vX.Y.Z`) and publish one verified archive to GitHub and npm.
6. Read back both distribution endpoints before declaring the release available.

## Command Scenario (GitHub + npm)

Replace `X.Y.Z`, `PR_NUMBER`, and `TESTED_HEAD_SHA` below with the reviewed release values.

1. Complete the pre-release checklist and build the final candidate. Stage only the intended
   release files, commit them, push the release branch, and wait for its required CI checks.
2. Merge exactly the verified PR head, then synchronize `main`:
   - `gh pr merge PR_NUMBER --squash --match-head-commit TESTED_HEAD_SHA`
   - `git switch main`
   - `git pull --ff-only origin main`
   - `git diff --exit-code TESTED_HEAD_SHA HEAD` (the squash commit must have the tested tree)
   - `git status --short` and `git rev-list --left-right --count HEAD...origin/main`
3. Pack the already-built, verified output once; do not run this before the build/package checks:
   - `mkdir -p docs/agent-tmp/release-artifacts`
   - `npm pack --ignore-scripts --pack-destination docs/agent-tmp/release-artifacts`
   - Retain the generated archive, hash, version, and source commit as release evidence. Confirm
     the packlist contains the intended README, changelog, license/notices, and distribution files.
4. Tag the merged commit and create the GitHub Release with that archive:
   - `git tag -a vX.Y.Z -m "vX.Y.Z"`
   - `git push origin vX.Y.Z`
   - `gh release create vX.Y.Z docs/agent-tmp/release-artifacts/aiden0z-pptx-renderer-X.Y.Z.tgz --verify-tag --title "vX.Y.Z" --notes-file docs/releases/vX.Y.Z.md`
5. Publish the same archive to npm:
   - `npm whoami --registry=https://registry.npmjs.org`
   - If needed, run `npm login --registry=https://registry.npmjs.org` locally.
   - `npm publish docs/agent-tmp/release-artifacts/aiden0z-pptx-renderer-X.Y.Z.tgz --access public --tag latest --registry=https://registry.npmjs.org`
   - Complete any additional publishing authentication in npm's official browser flow. Login
     alone may not satisfy publishing 2FA; do not put passwords, tokens, or one-time codes in chat.
6. Verify availability and contents:
   - `npm view @aiden0z/pptx-renderer@X.Y.Z version dist dist-tags --json --prefer-online --registry=https://registry.npmjs.org`
   - Confirm `latest` is `X.Y.Z`, download `dist.tarball`, and compare its bytes or integrity with
     the retained archive and GitHub asset.
   - npm scans new publishes before making them installable. A successful upload can precede
     registry visibility; allow for this delay rather than republishing. See the
     [npm publishing notice](https://github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning-and-dual-use-metadata/).
   - While npm is pending, state that separately in the GitHub Release. Update it after registry
     verification, and check post-merge CI and demo deployment before closing the release task.

Documentation-only corrections after publication can follow in a separate PR. They update the
repository documentation; they do not rewrite the README or changelog inside an already published
npm archive or the tagged source tree. Include those corrections in the next package version.

## Release Notes Template

- Summary
- Added
- Changed
- Fixed
- Security
- Migration Notes
