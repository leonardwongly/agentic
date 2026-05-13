# Contributing

Agentic is a TypeScript monorepo with a Next.js web app, worker runtime, shared packages, checked-in migrations, and security/compliance gates. Contributions should keep the system safe to run locally and predictable to review.

## Development Setup

1. Install Node.js 20 or newer.
2. Install dependencies:

```bash
npm install
```

3. Create a local environment file:

```bash
cp .env.example .env.local
```

4. Set at least a local access key before running shared or browser-visible environments:

```bash
export AGENTIC_ACCESS_KEY=replace-this-with-a-long-random-secret
```

5. Validate the environment:

```bash
npm run setup:check
```

6. Start the web app and worker in separate terminals when testing queued flows:

```bash
npm run dev
npm run worker:start
```

## Contribution Workflow

- Keep pull requests focused on one logical change.
- Follow existing module boundaries and helper APIs before introducing new abstractions.
- Include tests with behavior changes and bug fixes.
- Update README, runbooks, specs, or examples when behavior or setup changes.
- Do not commit secrets, credentials, local stores, generated build output, coverage, logs, or machine-local paths.

## Validation Before Opening A Pull Request

Run the narrowest relevant tests while working, then run the broader gates before review:

```bash
npm test
npm run test:security:regression
npm run test:architecture:fitness
npm run test:performance:fitness
npm run build
```

For browser-facing changes, also run:

```bash
npx playwright install chromium
npm run test:e2e
```

For dependency, release, or supply-chain changes, also run:

```bash
npm run security:audit-runtime
npm run security:sbom
```

## Security Issues

Do not open a public issue for vulnerabilities, exploit details, secrets, or sensitive operational evidence. Use the private reporting flow in [SECURITY.md](SECURITY.md).

## Commit Style

Use concise conventional commits where possible:

```text
feat(scope): add governed workflow template import
fix(auth): reject missing session unlock tokens
docs(readme): clarify production startup checks
test(api): cover oversized request rejection
```

## Review Expectations

Reviewers should verify correctness, security boundaries, tests, operational impact, and documentation. Pull requests that affect externally reachable routes, auth, persistence, CI, deployment, or dependency policy should include explicit validation evidence.
