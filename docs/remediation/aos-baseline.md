# Agentic OS Remediation Baseline

This baseline is the engineering source-of-truth bridge for `AOS-*` work. It keeps the Agentic OS blueprint, repo assessment, GitHub tracker, and implementation evidence separate so the team does not confuse strategy artifacts with shipped capability.

## Source Of Truth

| Source | Role | Rule |
| --- | --- | --- |
| `agentic.docx` | Blueprint / target operating model | Strategic direction only; not implementation proof. |
| `docs/superpowers/plans/2026-04-13-agentic-findings-implementation-plan.md` | Gap analysis and sequencing | Must be refreshed against current repo evidence before each implementation slice. |
| GitHub `AOS-*` issues | Engineering tracker | Defines active ownership lanes, dependencies, and validation gates. |
| Code, tests, CI, and generated artifacts | Implementation proof | Only merged code and passing evidence prove a capability is implemented. |

## Tracker Manifest

The checked-in manifest lives at `config/remediation/aos-tracker.json`.

It records:

- `AOS-00` through `AOS-18`
- GitHub issue numbers
- ownership lanes
- priorities
- dependencies
- validation gates
- baseline commands required before closing remediation work

Render the local dashboard:

```bash
npm run remediation:dashboard
```

Verify the manifest against the live GitHub tracker:

```bash
npm run remediation:verify
```

## Kickoff Branch Baseline

Captured on 2026-04-28 after refreshing `origin` and fast-forwarding the local `feat/parallel-spine` worktree to `origin/feat/parallel-spine`.

| Signal | Value |
| --- | --- |
| Branch | `feat/parallel-spine` |
| Head | `c60df05` |
| Divergence from `origin/main` | behind `42`, ahead `29` |
| Divergence from `origin/feat/parallel-spine` | behind `0`, ahead `0` |
| Working tree before AOS-00 edits | clean |
| Live AOS issue coverage | `#11` through `#29`, representing `AOS-00` through `AOS-18` |

## Baseline Validation Commands

Run these before closing `AOS-00` and repeat the relevant subset before closing each dependent remediation issue.

| Gate | Command |
| --- | --- |
| Branch divergence | `git fetch origin --prune && git rev-list --left-right --count origin/main...HEAD` |
| Tracker coverage | `gh issue list --repo leonardwongly/agentic --search 'AOS- in:title' --state all --limit 100` |
| Capability baseline | `npm run test:smoke:capabilities` |
| Raw supply-chain risk | `npm audit --json` |
| Runtime audit policy | `npm run security:audit-runtime` |
| Unit and integration | `npm test` |
| Security regression | `npm run test:security:regression` |
| Architecture fitness | `npm run test:architecture:fitness` |
| Performance fitness | `npm run test:performance:fitness` |
| Build | `npm run build` |

## Ownership Lanes

| Lane | Label | Owner | Scope |
| --- | --- | --- | --- |
| Trust spine | `aos-trust-spine` | `platform-security` | API boundaries, governance defaults, public sharing, supply chain, auth state, and security headers. |
| Execution spine | `aos-execution-spine` | `runtime-platform` | Durable approvals, runner contracts, typed actions, workflow DAGs, watchers, worker priority, and concurrency. |
| Intelligence fabric | `aos-intelligence-fabric` | `agent-intelligence` | Context provenance, execution provenance, streamed state, and continuous governance simulation. |
| Shell | `aos-shell` | `product-platform` | Operator dashboard decomposition and migration discipline. |

## Rollout And Rollback

This baseline introduces no runtime behavior change. Rollout is limited to documentation, manifest validation, and a local dashboard script.

Rollback is safe by reverting the manifest, script, docs, package scripts, and test added for `AOS-00`. No migrations, data writes, secrets, or production configuration changes are involved.
