# Governance

Agentic currently uses a maintainer-led governance model.

## Maintainer Responsibilities

Maintainers are responsible for:

- keeping `main` reviewable, buildable, and safe to run locally
- triaging issues and pull requests
- protecting security-sensitive reports from public disclosure
- deciding release scope and compatibility tradeoffs
- maintaining documentation, validation gates, and project direction

## Decision Making

Most decisions are made through pull request review and issue discussion. Maintainers should prefer decisions that are secure, testable, documented, and aligned with existing architecture.

When tradeoffs are required, the decision should state:

- what changed
- why that option was chosen
- what risk remains
- how the team can revisit the decision later

## Becoming A Maintainer

Maintainer access is granted by existing maintainers based on sustained, high-quality contributions, judgment around security and operations, and demonstrated care for review discipline.

## Release Management

The project is pre-1.0. Releases should include:

- a clean validation run
- dependency and security gate results
- notes for migrations, environment changes, or rollback
- acknowledgement of known limitations
