# Changelog

## v1.0.0 - 2026-05-27

Initial open-source GitHub release candidate.

### Included

- Next.js dashboard/API for governed goals, approvals, automations, memory,
  documents, readiness, and public-share flows.
- Separate worker runtime for durable jobs, retries, leases, scheduling,
  privacy operations, document rendering, autopilot processing, and GitHub issue
  intake.
- Postgres-backed production state with migrations, schema readiness checks, and
  shared auth runtime state.
- File-backed development mode for local exploration.
- Security, architecture, performance, release-context, supply-chain, and
  compliance validation gates.
- Provider-neutral self-hosting documentation and Docker Compose example.
- Installer-owned runtime defaults for OSS forks and self-hosted deployments.

### Release Notes

- Package metadata keeps `leonardwongly/agentic` as the canonical upstream.
- Runtime ownership is configured by the installer with
  `AGENTIC_BOOTSTRAP_USER_ID`, `AGENTIC_BOOTSTRAP_DISPLAY_NAME`, and
  `AGENTIC_DEFAULT_TIMEZONE`.
- Render remains an optional provider example; it is not required for
  self-hosting.
- GitHub App issue sync must be configured with a GitHub App owned by the
  installing user or organization.
