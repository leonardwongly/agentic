# Governance Defaults

Agentic uses the enterprise governance profile by default. New workspaces fail closed for risky autonomy, public sharing, data retention, provider-backed side effects, and escalation behavior.

## Enterprise Defaults

The source of truth for code defaults is `enterpriseWorkspaceGovernanceDefaults` in `packages/contracts/src/index.ts`. The operator-facing classification is mirrored in `config/governance/defaults.json`.

| Surface | Default | Rationale |
| --- | --- | --- |
| Approval mode | `always_review` | Confidence, learning, and scorecards can explain decisions, but they do not widen live autonomy by default. |
| Auto-run ceiling | `R1` | Only low-risk read/search work can be considered below the review boundary. |
| Public sharing | `false` | Public goal share links are externally visible and must be enabled by the workspace owner before creation succeeds. |
| Audit exports | `true` | Reviewers can preserve evidence for approvals, sharing, privacy operations, and execution history. |
| Provider access approval | `true` | Connector-backed side effects stay approval-gated unless the workspace owner changes policy. |
| Escalation approval | `true` | Escalation stays an operator decision rather than an ambient automation behavior. |
| External send approval | `true` | Outbound communications stay behind explicit review. |
| Calendar write approval | `true` | Scheduling changes stay behind explicit review. |
| Retention | `90` days | Evidence is retained long enough for review without defaulting to long-lived data holding. |
| Learning promotion | `shadow_only` | Replay evidence is collected, but learned paths cannot widen live autonomy by default. |
| Learning rollback | `downgrade_to_draft` | Unsafe learned paths fall back to draft behavior. |

## Compatibility And Overrides

Existing file-backed runtime stores without the newer governance fields parse into the same enterprise-safe defaults. Postgres deployments add the default-deny columns through `0005_governance_default_deny.sql`; existing rows receive `public_sharing_enabled=false`, `provider_access_requires_approval=true`, and `escalation_requires_approval=true`.

Local demo workflows can opt into more permissive new-workspace defaults with:

```bash
AGENTIC_GOVERNANCE_DEFAULT_PROFILE=demo npm run dev
```

Production rejects `AGENTIC_GOVERNANCE_DEFAULT_PROFILE=demo` at repository startup unless the deployment also sets:

```bash
AGENTIC_ALLOW_DEMO_GOVERNANCE_DEFAULTS=true
```

That override is intentionally loud. Use it only for an isolated demo deployment, and roll it back by removing both environment variables and restarting the web and worker runtimes.

## Rollout And Rollback

Rollout:

```bash
npm run db:migrate
npm test -- repository-production-config.test.ts governance-route.test.ts share-route.test.ts policy.test.ts
```

Rollback:

1. Disable public sharing in workspace governance before downgrading if any workspaces enabled it during the rollout.
2. Revert the application change.
3. Leave the added Postgres columns in place; they are backward-compatible and ignored by older code.

Residual risk: existing users may see public share creation denied until an owner enables it in governance. That is intentional for AOS-03 and should be handled through operator messaging rather than by weakening the default.
