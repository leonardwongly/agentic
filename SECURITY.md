# Security Policy

## Supported Versions

Agentic security fixes target the current `main` branch and published release lines announced by maintainers.

## Reporting A Vulnerability

Do not open a public GitHub issue for vulnerabilities, exploit details, secrets, credentials, logs, screenshots with sensitive data, or operational evidence that could help an attacker.

Use GitHub Private Vulnerability Reporting:

https://github.com/leonardwongly/agentic/security/advisories/new

This advisory link is for the canonical upstream repository. Fork maintainers
who redistribute or operate their own instance should publish their own security
reporting path for fork-specific deployments, secrets, infrastructure, and
provider configuration.

If that private reporting flow is unavailable, contact a maintainer privately and share only the minimum details needed to establish severity and a safe communication path.

## What To Include

When using a private channel, include:

- affected version, commit, route, workflow, package, or deployment mode
- high-level impact and suspected severity
- safe reproduction guidance that does not expose live secrets or third-party data
- whether exploitation appears active
- any temporary mitigation already known

## Response Expectations

Maintainers should:

1. acknowledge credible reports as soon as practical
2. confirm scope, severity, and affected versions
3. prepare the smallest safe fix or mitigation
4. run relevant security and regression validation
5. coordinate disclosure timing when public detail is appropriate

## Security Validation

The project includes local security gates:

```bash
npm run security:audit-runtime
npm run test:security:regression
npm run test:architecture:fitness
npm run build
```

Dependency exceptions, incident handling, and evidence collection are documented in:

- [docs/runbooks/vulnerability-management.md](docs/runbooks/vulnerability-management.md)
- [docs/runbooks/security-incident-response.md](docs/runbooks/security-incident-response.md)
- [docs/security/supply-chain-controls.md](docs/security/supply-chain-controls.md)
