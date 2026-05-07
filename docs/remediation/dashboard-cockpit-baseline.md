# Dashboard Cockpit Baseline

Issue: [#49](https://github.com/leonardwongly/agentic/issues/49)

## Scope

This baseline records the clean starting point for the dashboard cockpit remediation workstream before implementing the behavior-preserving dashboard split, exception-first cockpit lanes, and bounded dashboard data contracts.

## Branch And Source

- Branch: `task/dashboard-cockpit-49-52`
- Base: `origin/main`
- Base commit: `45be859dfc93ddbdb46aa3fa4ed50ee602aa58e6`
- Worktree state before implementation: clean

## Baseline Validation

| Command | Result | Notes |
| --- | --- | --- |
| `git status --short --branch` | Passed | `## task/dashboard-cockpit-49-52...origin/main` |
| `npm test` | Passed | 119 files, 831 passed, 14 skipped |
| `npm run test:architecture:fitness` | Passed | Architecture fitness checks passed |
| `npm run test:performance:fitness` | Passed | Performance fitness checks passed; 1 file, 4 tests passed |
| `npm run security:audit-runtime` | Passed | 0 moderate-or-higher runtime findings |
| `npm run test:security:regression` | Passed | 21 files, 304 passed, 14 skipped |
| `npm run build` | Passed | Next.js build and worker TypeScript check passed |

## Baseline Warning

`npm run build` emitted the existing Turbopack NFT warning for `apps/web/app/api/ready/route.ts` through `apps/web/lib/runtime-readiness.ts` and `packages/db/src/schema-status.ts`. The build still completed successfully. This warning is tracked as baseline behavior and is not caused by dashboard cockpit implementation.

## Implementation Gate

The dashboard implementation may proceed only after this baseline remains isolated from feature changes. Any later validation failure should be classified as either:

- a baseline/environment drift, if reproducible before dashboard changes; or
- a dashboard implementation regression, if introduced by the cockpit workstream.
