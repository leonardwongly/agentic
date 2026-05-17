# Privacy Control Registry

## Purpose

Phase 2 privacy work now keeps a versioned data-handling registry in [config/privacy/data-controls.json](/Users/leonardwongly/.codex/worktrees/g10/Agentic/config/privacy/data-controls.json). The registry exists so minimization, masking, tokenization, retention, and lifecycle coverage stay explicit instead of being inferred from scattered route logic.

## What Is Covered

The registry currently enumerates six privacy-relevant datasets:

- Workspace collaboration records
- Goal share records
- Audit and export packages
- Connector operational telemetry
- Dashboard cockpit telemetry and feedback
- Learning capture memory and episodes

Each dataset records:

- classification
- operator-facing product surfaces
- representative record examples
- code paths that own the behavior
- minimization rules
- masking rules
- tokenization strategy
- retention defaults and deletion flow
- access rules
- lifecycle operations that touch the dataset

## Runtime Integration

The policy layer validates the registry through `packages/policy/src/privacy-controls.ts`. The governance privacy route exposes a summarized view so the operator dashboard can render the same source of truth without duplicating policy logic.

Learning capture uses the same policy layer as a preflight before persistence:

- tenant boundaries are checked against the goal owner, workflow, task, artifact, approval, action log, and actor context before records are created
- workspace shadow-replay opt-out blocks automatic learning capture before memory or episode writes
- email addresses, bearer tokens, cookie/session identifiers, passwords, private keys, and secret assignments are redacted before persistence
- auto-captured `MemoryRecord`s receive review and expiry timestamps derived from workspace governance retention
- self-improvement episodes receive `learningPrivacy` metadata with dataset id, user/workspace scope, capture source, expiry, and export/delete eligibility so lifecycle operations can address them without re-inferring ownership

This keeps three layers aligned:

- design intent in the registry
- runtime access through `GET /api/governance/privacy`
- operator visibility in the privacy lifecycle dashboard card

## Review Expectations

When a new privacy-relevant surface is added, update the registry in the same change that introduces the behavior. Do not rely on documentation-only updates after the fact.

A privacy-scope change is incomplete if it does not update:

- the registry entry or add a new dataset
- the validation tests in `tests/privacy-controls.test.ts`
- the route exposure test in `tests/governance-privacy-route.test.ts`
- compliance control evidence when the ownership or evidence path changes
