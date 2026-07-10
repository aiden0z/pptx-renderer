# Security Policy

## Supported Versions

The `main` branch is considered the actively supported line.

## Reporting a Vulnerability

Please do not open public issues for unpatched vulnerabilities.

Report security concerns via GitHub Security Advisories (preferred).  
If Security Advisories are unavailable, open a GitHub issue with minimal details
and request private coordination.

Include:

- Affected component and version/commit
- Reproduction steps
- Impact assessment
- Suggested mitigation (if available)

Maintainers will acknowledge as soon as possible on GitHub.

## Disclosure Process

1. Acknowledge and triage report
2. Reproduce issue and assess severity
3. Prepare patch and regression tests
4. Coordinate disclosure timeline
5. Publish patch notes and mitigation guidance

## Hardening Guidance for Integrators

- Treat all PPTX files as untrusted input.
- Configure `zipLimits` in production; `RECOMMENDED_ZIP_LIMITS` is the package-provided starting point.
- Run rendering in constrained browser/container contexts when possible.
- Keep dependencies and runtime updated.
- Disable or limit external navigation integration if your application does not need it.
- Pin exact standalone and PDF.js asset versions; do not use mutable CDN URLs in production.
- If EMF-PDF fallback is enabled, permit only the required module origin and `blob:` in
  `worker-src`; self-host the assets when a tighter CSP is required.

## Resource Limits

`RECOMMENDED_ZIP_LIMITS` protects the ZIP parsing stage:

- `maxEntries`: `4000`
- `maxEntryUncompressedBytes`: `32 MiB`
- `maxTotalUncompressedBytes`: `256 MiB`
- `maxMediaBytes`: `192 MiB`
- `maxConcurrency`: `8`

These limits are checked from ZIP metadata when available and from the actual decoded entry size when metadata is unavailable. The decoded-size fallback covers XML/text entries as well as media entries, which prevents oversized entries from bypassing limits through missing JSZip private size metadata.

The renderer also applies semantic limits after ZIP parsing:

- Chart data caches cap point indexes at `10,000` and ignore oversized `c:ptCount` allocation hints.
- EMF bitmap previews are rejected when decoded pixels exceed `16,777,216`, dimensions exceed `8192x8192`, or the declared pixel payload is incomplete.
- External audio/video URLs require `TargetMode="External"` and safe `http`/`https` protocols; media elements are created with `preload="none"` to avoid automatic fetches during render.
- CSS length, tile-position, and SVG path parsing use bounded linear scanners rather than
  backtracking expressions on attacker-controlled PPTX values.
- EMF-PDF fallback uses one short-lived isolated Worker per render. The Worker is
  terminated on success, error, cancellation, or after a 15-second timeout. At most four
  PDF fallback Workers run concurrently; additional work waits in an abortable queue.
- Disposing a slide aborts pending PDF fallback work and prevents late results from
  mutating detached DOM or repopulating a shared blob URL cache.
