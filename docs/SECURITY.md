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
- Configure `zipLimits` in production.
- Run rendering in constrained browser/container contexts when possible.
- Keep dependencies and runtime updated.
- Disable or limit external navigation integration if your application does not need it.
