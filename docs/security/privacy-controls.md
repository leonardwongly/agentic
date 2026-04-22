# Privacy Control Registry

## Purpose

Phase 2 privacy work now keeps a versioned data-handling registry in [config/privacy/data-controls.json](/Users/leonardwongly/.codex/worktrees/c9fe/Agentic/config/privacy/data-controls.json). The registry exists so minimization, masking, tokenization, retention, and lifecycle coverage stay explicit instead of being inferred from scattered route logic.

## What Is Covered

The registry currently enumerates four privacy-relevant datasets:

- Workspace collaboration records
- Goal share records
- Audit and export packages
- Connector operational telemetry

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
