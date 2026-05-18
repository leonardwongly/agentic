# High-Risk External Side-Effects Threat Model

## Scope

This threat model covers Agentic paths that can trigger externally visible side effects, including provider webhooks, connector callbacks, Gmail or Calendar mutations, issue-intake automations, approval follow-up jobs, and worker retries. It is intentionally narrower than the general security regression suite: the focus is on preventing forged, replayed, misdirected, prompt-influenced, or irreversible actions from leaving the system boundary without approval-grade evidence.

## Trust Boundaries

| Boundary | Inputs | Trust level | Required control |
| --- | --- | --- | --- |
| Public webhook ingress | GitHub, provider, and scheduled workflow payloads | Untrusted until signature, timestamp, origin, and target validation pass | Verify signatures and secrets, reject unknown repositories or tenants, cap payload size, and fail closed on malformed events. |
| Connector callback ingress | OAuth callback parameters, provider tokens, and provider API responses | Untrusted until state, tenant, and credential ownership checks pass | Bind callback state to the requesting user and workspace, validate response shape, and avoid logging tokens or provider identifiers beyond required audit references. |
| Agent and model outputs | Plans, tool arguments, generated URLs, and action recommendations | Untrusted suggestions | Treat model output as proposal data only; require typed action validation, policy checks, approval gates, and side-effect ledger reservation before execution. |
| Worker retry and recovery | Queue payloads, leases, idempotency keys, and previous attempt records | Partially trusted durable state | Require idempotency keys, tenant ownership, ledger lookups, stale-lease checks, and duplicate-delivery suppression before adapter calls. |
| Provider mutation adapters | Outbound email, calendar, issue, document, or future payment-like operations | Privileged side-effect boundary | Enforce least-privilege credentials, allowlisted operation types, request timeouts, safe retries, and auditable completion evidence. |

## Threats And Required Mitigations

| Threat | Failure mode | Required mitigation | Evidence gate |
| --- | --- | --- | --- |
| SSRF through user or model supplied URLs | Agentic fetches an internal, metadata, loopback, link-local, private-network, or credential-bearing URL while preparing a side effect. | Do not fetch arbitrary user/model URLs on privileged paths. When a URL is required, parse with the platform URL API, require HTTPS, reject credentials, fragments, query-bearing callback destinations unless explicitly expected, and deny loopback, link-local, private, local, and temporary tunnel hosts. | URL validation tests in route, workflow, or connector surfaces; CodeQL findings reviewed before merge; security regression suite green. |
| Webhook forgery | An attacker posts a synthetic GitHub/provider event that queues jobs or records approvals. | Verify HMAC or provider signature with constant-time comparison where applicable, require minimum secret length, bind event name and delivery ID to accepted types, reject unsupported repositories or tenants, and never accept client-supplied roles or workspace IDs as authority. | Webhook route tests for missing, malformed, stale, and mismatched signatures; workflow tests asserting secrets are only passed through protected env. |
| Prompt injection | External content or model output instructs the agent to bypass approval, change recipients, disclose secrets, or mutate unrelated resources. | Treat all prompt/model output as untrusted. Convert it into typed action proposals, run schema validation and policy authorization, require human approval for high-risk actions, re-check tenant ownership at execution time, and never allow prompt text to select credentials or authority. | Action contract tests, governed route tests, approval-grade readiness checks, and red-team prompts in security regression coverage. |
| Replay and duplicate delivery | Retries, webhook redelivery, queue reclaims, or worker restarts create duplicate emails, calendar events, issue comments, or irreversible provider objects. | Require stable idempotency keys at ingress and execution, reserve the provider side-effect ledger before adapter execution, return existing provider references for completed ledger rows, and make retry behavior resume from provider drafts or recorded attempts. | Idempotency/replay tests for typed actions, worker retries, webhook redelivery, stale leases, and provider side-effect ledger rows. |
| Confused deputy | A valid approval or credential for one workspace/user/repository is used to mutate another target. | Bind approvals, credentials, repository allowlists, action targets, and ledger rows to the same user/workspace/tenant tuple. Resolve authority server-side; reject mismatched actor, tenant, provider account, repository, or target identifiers. | Authorization and tenant isolation tests; evidence includes actor, workspace, target, approval, and credential reference without exposing secret material. |
| Irreversible external side effects | A high-impact mutation is executed before approval, readiness, dry-run, or rollback evidence exists. | Default deny high-risk side effects until policy, approval, connector readiness, idempotency reservation, and dry-run/preview evidence pass. Require explicit irreversible-action copy in approval records and route destructive or hard-to-undo operations through manual review. | Approval batch tests, policy tests, side-effect ledger evidence, and manual release checklist for new provider mutation classes. |
| Secrets or PII in logs | Tokens, authorization headers, private keys, session IDs, provider payloads, email body text, or sensitive recipient data are logged during failures. | Redact known sensitive keys, log stable references instead of raw secrets, cap payload snippets, avoid echoing provider responses, and make user-facing errors generic while preserving safe internal correlation IDs. | Log redaction tests, workflow tests that reject secret logging, runtime audit review, and incident-retrospective sampling. |
| Unsafe rollback or disablement | Operators cannot stop an unsafe automation quickly, or rollback replays queued mutations. | Provide per-provider and per-workflow disablement switches, pause scheduled workflows, drain or quarantine queues before rollback, preserve side-effect ledger rows for duplicate suppression, and document restore order before schema rollback. | Runbook entry for each new side-effect class; rollback rehearsal notes for migrations or queue contract changes. |

## Evidence Gates Before Enabling A New Side-Effect Class

1. Threat model update: add the new provider/action class to this document or a more specific provider runbook.
2. Contract tests: cover schema validation, authorization, ownership binding, unknown fields, malformed payloads, oversized payloads, and safe error messages.
3. Abuse tests: cover SSRF inputs, forged webhooks/callbacks, prompt-injection attempts, replay, duplicate delivery, and confused-deputy target swaps.
4. Operational tests: prove idempotency ledger behavior, retry classification, timeout handling, queue recovery, and disablement behavior.
5. Static analysis: CodeQL must complete for JavaScript/TypeScript and provenance validation must pass for every workflow action reference.
6. Review evidence: include approval policy, side-effect ledger evidence, logs with redaction confirmed, rollback/disablement steps, and a release-owner signoff.

## Rollback And Disablement

- Pause scheduled workflows before disabling runtime handlers so no new events are accepted during rollback.
- Disable the affected connector/provider capability flag or configuration first; then drain, quarantine, or requeue jobs according to the provider runbook.
- Preserve side-effect ledger records during rollback unless an operator-approved restore plan explicitly replaces them with equivalent duplicate-delivery evidence.
- Re-enable only after the targeted regression tests, provenance gate, CodeQL workflow, and provider-specific smoke test have passed.

## Maintenance

Review this threat model whenever Agentic adds a provider mutation, expands a webhook/callback surface, changes approval policy, changes worker retry semantics, or introduces a new class of irreversible action. The owner for the change must update the evidence gates in the same patch that enables the side effect.
