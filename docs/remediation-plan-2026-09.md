# Agentic Remediation Plan — September 2026

**Generated:** 2026-09-04
**Scope:** All 13 open GitHub issues across Cloudflare Migration, AOS Remediation, and Cognitive-Core Activation
**Status:** Execution-ready

---

## Executive Summary

This remediation plan covers 13 open issues organized into three workstreams:

| Workstream | Issues | Critical | High | Medium |
|------------|--------|----------|------|--------|
| Cloudflare Workers Migration | 6 (#979, #981, #982, #984, #985, #986) | 1 | 2 | 2 + 1 epic |
| AOS Remediation & Production Proof | 5 (#142, #143, #144, #145, #152) | 0 | 5 | 0 |
| Cognitive-Core Activation | 2 (#1006, #1011) | 0 | 0 | 1 + 1 roadmap |

**Recommended execution order:** Cloudflare P0 → AOS Production Proof → Cloudflare P1 → Cognitive-Core → Cloudflare P2

---

## Finding 1: node:fs Isolation from Workers Bundle

| Field | Detail |
|-------|--------|
| **Issue** | [#979](https://github.com/leonardwongly/agentic/issues/979) — F4/A3: Isolate node:fs file-store/health/local-notes from the Workers bundle |
| **Priority** | 🔴 **Critical (P0)** |
| **Workstream** | Cloudflare Workers Migration |
| **Dependencies** | F1 (#977 ✅ closed) |
| **Blocks** | All subsequent Cloudflare deployment work |
| **Owner** | TBD |
| **Status** | Not Started |

### Finding Description

`node:fs` is used across ~10 modules in the worker/packages path: the file-backed store (`packages/repository/src/file-store-lock.ts`), append logs, the file worker-health sink (`packages/worker-runtime/src/worker-health.ts`), and the local-notes integration (`packages/integrations/src/local-notes.ts`). Cloudflare Workers have no persistent filesystem. The current code assumes a writable shared filesystem for dev and self-hosted modes.

**Current behaviour:** File-based storage, health sinks, and local-notes write directly to disk using `node:fs`.
**Expected behaviour:** Workers must use R2, KV, D1, or Hyperdrive-backed alternatives. Dev/self-hosted modes should continue using `node:fs` via a runtime adapter pattern.
**Symptoms:** Workers bundle will fail at build time or runtime when `node:fs` calls are reached.

### Root Cause Analysis

Dev and self-hosted modes assume a writable shared filesystem. No abstraction layer exists to swap storage backends based on runtime environment. The file-backed store, health sink, and local-notes were implemented before the Cloudflare migration target was ratified.

### Impact Assessment

- **Functionality:** Workers deployment is completely blocked. No Worker can boot without resolving this.
- **Reliability:** File-based state is incompatible with Workers' ephemeral execution model.
- **Security:** File locks and health sinks have no equivalent in Workers without adaptation.
- **Severity:** Production-blocking for the Cloudflare deployment target.

### Actionable Remediation Tasks

1. **Design a storage adapter interface** that abstracts file operations (read, write, lock, append) with two implementations: `NodeFsAdapter` (existing behaviour) and `CloudflareStorageAdapter` (R2/KV-backed).
2. **Refactor `packages/repository/src/file-store-lock.ts`** to use the adapter interface instead of direct `node:fs` calls.
3. **Refactor `packages/worker-runtime/src/worker-health.ts`** to support a pluggable health sink (file for Node, R2/KV for Workers).
4. **Refactor `packages/integrations/src/local-notes.ts`** to use the adapter for note persistence.
5. **Add runtime detection** (`getRuntimeAdapter()`) that returns the appropriate adapter based on environment (check for `caches` global or `process.env.AGENTIC_RUNTIME`).
6. **Update vitest config** to ensure tests use the Node adapter.
7. **Add Workers-specific integration tests** using Miniflare or wrangler dev.

### Testing and Validation

- Unit tests for both adapter implementations
- Integration test: Worker boots successfully without `node:fs` errors
- Regression test: Self-hosted/dev mode continues using file-backed storage
- Bundle size check: `wrangler deploy --dry-run` succeeds
- Edge case: Concurrent lock acquisition under R2 backend

### Dependencies

- None (foundational — blocks all other Cloudflare work)

---

## Finding 2: Watcher Scheduler in Scheduled Handler

| Field | Detail |
|-------|--------|
| **Issue** | [#981](https://github.com/leonardwongly/agentic/issues/981) — F8/B2: Run the watcher scheduler pass in the scheduled handler |
| **Priority** | 🟠 **High (P1)** |
| **Workstream** | Cloudflare Workers Migration |
| **Dependencies** | F3 (#980 ✅ closed), F4 (#979) |
| **Owner** | TBD |
| **Status** | Not Started |

### Finding Description

The watcher scheduler currently runs inside the always-on loop (`runWatcherSchedulerLoop`). In run-once mode it is drained via `runWatcherSchedulerOnce`. The scheduled Cloudflare handler (`worker.ts` `scheduled()`) must run one watcher-scheduler pass alongside the job drain so watchers continue to fire on the cron cadence.

**Current behaviour:** Watcher evaluation is coupled to the long-lived worker loop.
**Expected behaviour:** The `scheduled()` handler invokes `runWatcherSchedulerOnce()` per cron tick.
**Symptoms:** Time-based watchers never evaluate on Workers; only event-driven watchers function.

### Root Cause Analysis

Watcher evaluation was designed for a persistent Node process with an interval timer. The Cloudflare Cron Trigger provides discrete invocations, not a persistent loop.

### Impact Assessment

- **Functionality:** Time-based watchers (hourly, daily) silently stop working on Workers.
- **Reliability:** Users depending on scheduled notifications/briefings receive nothing.
- **User Experience:** Degraded — watchers appear configured but never fire.

### Actionable Remediation Tasks

1. **Wire `runWatcherSchedulerOnce()` into `worker.ts` `scheduled()` handler** alongside the existing job drain call.
2. **Ensure idempotency** — the watcher pass must be safe to run on every cron tick without duplicate evaluations.
3. **Add logging/telemetry** for watcher scheduler invocations in the scheduled handler.
4. **Document the cron cadence tuning** in the deployment runbook.

### Testing and Validation

- Unit test: `scheduled()` handler invokes watcher scheduler
- Integration test: Watcher fires after cron tick in Miniflare
- Regression test: Event-driven watchers still work
- Edge case: Overlapping cron ticks don't cause duplicate evaluations

### Dependencies

- Finding 1 (#979) — node:fs isolation must be complete first

---

## Finding 3: Validate googleapis & Model SDKs Under workerd

| Field | Detail |
|-------|--------|
| **Issue** | [#982](https://github.com/leonardwongly/agentic/issues/982) — F5/B3: Validate/lazy-load googleapis & model SDKs under workerd nodejs_compat |
| **Priority** | 🟠 **High (P1)** |
| **Workstream** | Cloudflare Workers Migration |
| **Dependencies** | F1 (#977 ✅ closed) |
| **Owner** | TBD |
| **Status** | Not Started |

### Finding Description

`googleapis` (^178), `@anthropic-ai/sdk`, and `openai` are Node-oriented SDKs used by integrations and `packages/agents/src/model-runner.ts`. They must be validated under `workerd` + `nodejs_compat` and kept out of cold paths to avoid bundle-size and compatibility issues.

**Current behaviour:** SDKs are imported at module top-level and bundled into the Worker.
**Expected behaviour:** SDKs are lazy-loaded only when needed, and verified to work under `workerd`'s `nodejs_compat` flag.
**Symptoms:** Potential bundle-size overflow, runtime errors from unsupported Node APIs, slow cold starts.

### Root Cause Analysis

Heavy Node SDKs were chosen for a Node server runtime. Bundle size and Node-API surface matter on Workers. No lazy-loading or conditional import pattern exists.

### Impact Assessment

- **Performance:** Large bundle size increases cold start latency and may exceed Workers free-tier limits.
- **Reliability:** Unsupported Node APIs in SDKs could cause runtime crashes.
- **Functionality:** Google OAuth, AI model calls may fail silently on Workers.

### Actionable Remediation Tasks

1. **Audit bundle size** with `wrangler deploy --dry-run` and identify top contributors.
2. **Convert SDK imports to dynamic `import()`** in integration modules and model-runner.
3. **Test each SDK under Miniflare** with `nodejs_compat` enabled:
   - `googleapis`: Gmail send, Calendar list, OAuth2 token refresh
   - `@anthropic-ai/sdk`: Message creation
   - `openai`: Chat completion
4. **Add fallback/error handling** for SDKs that fail under workerd.
5. **Document which features are unavailable on Workers** if any SDK is incompatible.

### Testing and Validation

- Bundle size report before/after lazy-loading
- Integration test: Each SDK function works under Miniflare
- Edge case: SDK timeout/retry behaviour under Workers
- Performance: Cold start time comparison

### Dependencies

- None (can proceed in parallel with #979)

---

## Finding 4: Config, Secrets, Request Identity & CSP Parity on Workers

| Field | Detail |
|-------|--------|
| **Issue** | [#984](https://github.com/leonardwongly/agentic/issues/984) — F7/C1: Config, secrets, request identity, CSP/headers & readiness parity on Workers |
| **Priority** | 🟡 **Medium (P2)** |
| **Workstream** | Cloudflare Workers Migration |
| **Dependencies** | F1 (#977 ✅), F2 (#978 ✅), F3 (#980 ✅) |
| **Owner** | TBD |
| **Status** | Not Started |

### Finding Description

Production parity on Workers for environment/secrets, client-IP identity, readiness probes, and security headers/CSP. Config, request-identity, and header behaviour were designed for a Node host behind a configured reverse proxy, not Cloudflare's edge.

**Current behaviour:** Client IP derived from `X-Forwarded-For`; secrets from `process.env`; CSP headers set for Node-origin responses.
**Expected behaviour:** Client IP from `request.cf.connectingIp` or `CF-Connecting-IP`; secrets from Workers Secrets Store or env bindings; CSP adapted for edge-origin responses.
**Symptoms:** Mis-set identity breaks OAuth redirects, share links, request attribution, rate limiting, and security posture.

### Root Cause Analysis

Request identity and header logic was built for a traditional Node reverse-proxy topology. Cloudflare's edge provides different primitives (`cf` object, Workers bindings).

### Impact Assessment

- **Security:** Incorrect client IP attribution undermines rate limiting and audit trails.
- **Functionality:** OAuth redirect URIs and public share links may break.
- **Compliance:** CSP headers may not match edge-origin requirements.

### Actionable Remediation Tasks

1. **Update `request-client-identity.ts`** to prefer `CF-Connecting-IP` / `request.cf.connectingIp` when available, falling back to `X-Forwarded-For`.
2. **Audit all `process.env` accesses** and map to Workers env bindings or Secrets Store.
3. **Verify CSP headers** are correct for edge-origin responses (no `localhost` references).
4. **Update readiness probe** to check Hyperdrive connectivity instead of file-store availability.
5. **Add Workers-specific integration tests** for identity resolution and header generation.

### Testing and Validation

- Unit test: Client IP resolution with CF headers present/absent
- Integration test: OAuth flow completes on Workers
- Security review: CSP headers validated against edge-origin policy
- Regression test: Self-hosted mode unaffected

### Dependencies

- Findings 1-3 should be complete for full parity validation

---

## Finding 5: Cloudflare Workers Deployment Runbook + Rollback

| Field | Detail |
|-------|--------|
| **Issue** | [#985](https://github.com/leonardwongly/agentic/issues/985) — C2: Cloudflare Workers deployment runbook + rollback |
| **Priority** | 🟡 **Medium (P2)** |
| **Workstream** | Cloudflare Workers Migration |
| **Dependencies** | F1-F3 (✅), F6 (#983 ✅), F7 (#984) |
| **Owner** | TBD |
| **Status** | Not Started |

### Finding Description

Document the Cloudflare Workers deployment as a first-class option alongside existing self-hosted and free-tier-serverless guides, with an explicit rollback path.

**Current behaviour:** `docs/deployment/cloudflare-workers.md` exists but may lack rollback procedures, secret provisioning steps, and operational runbooks.
**Expected behaviour:** Complete runbook covering: prerequisites, secret setup, deploy command, health verification, rollback to previous version, monitoring.

### Root Cause Analysis

Documentation was created during the initial adapter spike but not updated as the migration progressed.

### Impact Assessment

- **Maintainability:** Operators cannot deploy or roll back without tribal knowledge.
- **Reliability:** Failed deployments have no documented recovery path.
- **User Experience:** New operators face unnecessary friction.

### Actionable Remediation Tasks

1. **Expand `docs/deployment/cloudflare-workers.md`** with:
   - Prerequisites (Wrangler CLI, Cloudflare account, R2 bucket, Hyperdrive)
   - Secret provisioning (Workers Secrets Store or `wrangler secret put`)
   - Step-by-step deploy command sequence
   - Health verification checklist (readiness endpoint, cron trigger firing)
   - Rollback procedure (`wrangler rollback` or version pinning)
   - Monitoring/alerting setup (Workers Observability)
2. **Cross-reference with existing runbooks** in `docs/runbooks/`.
3. **Add a "Cloudflare Workers" section to the main README** linking to the runbook.

### Testing and Validation

- Peer review of documentation accuracy
- Walkthrough test: Fresh operator follows runbook end-to-end
- Rollback drill: Simulate failed deploy and verify rollback steps work

### Dependencies

- Finding 4 (#984) for accurate config/secrets documentation

---

## Finding 6: [Epic] Cloudflare Workers Migration

| Field | Detail |
|-------|--------|
| **Issue** | [#986](https://github.com/leonardwongly/agentic/issues/986) — [Epic] Cloudflare Workers (OpenNext) migration |
| **Priority** | 📋 **Meta/Epic** |
| **Workstream** | Cloudflare Workers Migration |
| **Owner** | TBD |
| **Status** | In Progress (5/11 sub-issues closed) |

### Finding Description

Parent tracking issue for the entire Cloudflare Workers migration. Make Agentic deployable to Cloudflare Workers via `@opennextjs/cloudflare`.

### Actionable Remediation Tasks

1. Keep open until all sub-issues (#979, #981, #982, #984, #985) are resolved.
2. Update epic body with progress checklist as sub-issues close.
3. Close when Workers deployment is production-verified.

---

## Finding 7: Enable and Evaluate Model-Backed Planner

| Field | Detail |
|-------|--------|
| **Issue** | [#1006](https://github.com/leonardwongly/agentic/issues/1006) — [AOS-26] Enable and evaluate the model-backed planner and agent runners |
| **Priority** | 🟡 **Medium (P2)** |
| **Workstream** | Cognitive-Core Activation |
| **Dependencies** | Provider key provisioned, deployment available |
| **Owner** | TBD |
| **Status** | Not Started |

### Finding Description

The governed model-backed planner and structured AgentResult envelope + runners shipped behind `AGENTIC_MODEL_PLANNER` flag, defaulting to deterministic fallback. This issue graduates them from flag-gated to measured default.

**Current behaviour:** Model planner disabled by default; deterministic fallback used.
**Expected behaviour:** Model planner enabled with evaluation metrics proving decision quality meets thresholds.

### Root Cause Analysis

Feature shipped behind flag pending real-world evaluation evidence. No provider key has been provisioned in a test runtime.

### Impact Assessment

- **Functionality:** Advanced AI planning capabilities remain unused.
- **User Experience:** Users don't benefit from model-backed intelligence.

### Actionable Remediation Tasks

1. **Provision a model provider key** (Anthropic/OpenAI) in a staging runtime.
2. **Enable `AGENTIC_MODEL_PLANNER=true`** in staging.
3. **Run evaluation suite** (`scripts/model-eval.ts`, `run-agent-with-model*` tests).
4. **Capture decision-quality metrics**: acceptance rate, edit-distance, policy compliance.
5. **Define graduation thresholds** and document in the issue.
6. **If thresholds met**, enable by default in production with kill-switch.

### Testing and Validation

- Model eval suite passes defined thresholds
- Regression: Deterministic fallback still works when flag is off
- Performance: Model call latency within acceptable bounds
- Cost: Token usage within budget

### Dependencies

- Live deployment with provider credentials

---

## Finding 8: Configure GitHub App Sync Runtime and Repo Settings

| Field | Detail |
|-------|--------|
| **Issue** | [#142](https://github.com/leonardwongly/agentic/issues/142) — sec(config): configure GitHub App sync runtime and repo settings |
| **Priority** | 🟠 **High (P1)** |
| **Workstream** | AOS Remediation |
| **Dependencies** | Live deployment |
| **Owner** | TBD |
| **Status** | Not Started |

### Finding Description

Configure the runtime and GitHub repository settings required for scheduled/manual GitHub App issue sync. Implementation is merged, but the deployed runtime must hold GitHub App credentials while GitHub Actions receives only the route-specific sync secret and public endpoint URL.

**Current behaviour:** Scripts and workflow exist but runtime is not configured with live credentials.
**Expected behaviour:** GitHub App installed, credentials provisioned, sync workflow active.

### Root Cause Analysis

Implementation completed but operational configuration deferred pending production deployment.

### Impact Assessment

- **Functionality:** GitHub App issue sync doesn't work in production.
- **Reliability:** Manual intervention required for issue tracking.

### Actionable Remediation Tasks

1. **Install GitHub App** on the target repository/organization.
2. **Provision App credentials** (private key, app ID) in the deployed runtime's secrets store.
3. **Set `AGENTIC_GITHUB_APP_ISSUE_SYNC_URL`** repository variable pointing to the deployed endpoint.
4. **Run preflight check** (`scripts/github-app-sync-live-preflight.ts`) to validate configuration.
5. **Trigger a manual sync** and verify end-to-end flow.

### Testing and Validation

- Preflight script passes all checks
- Manual sync creates/updates issues correctly
- Scheduled sync fires on cron cadence
- Error handling: Invalid credentials produce clear error messages

### Dependencies

- Live deployment with secrets management

---

## Finding 9: Prove Postgres and Shared-Auth Production Bootstrap

| Field | Detail |
|-------|--------|
| **Issue** | [#143](https://github.com/leonardwongly/agentic/issues/143) — ops(runtime): prove Postgres and shared-auth production bootstrap |
| **Priority** | 🟠 **High (P1)** |
| **Workstream** | AOS Remediation |
| **Dependencies** | Live Postgres instance |
| **Owner** | TBD |
| **Status** | Not Started |

### Finding Description

Prove Agentic can boot in a production-like runtime using Postgres-backed durable state and safe auth/readiness behaviour. Repository CI is green, but production readiness requires validating the deployed runtime does not fall back to file-backed or process-local state unexpectedly.

**Current behaviour:** CI validates against ephemeral Postgres; no live production proof exists.
**Expected behaviour:** Deployed runtime boots with Postgres, shared-auth state persists across restarts, readiness probe confirms DB connectivity.

### Root Cause Analysis

Production bootstrap validation deferred pending deployment infrastructure.

### Impact Assessment

- **Reliability:** Risk of silent fallback to file-backed state in production.
- **Correctness:** Auth state may not persist across worker restarts.
- **Security:** Process-local auth stores are inappropriate for multi-instance deployments.

### Actionable Remediation Tasks

1. **Deploy to staging** with Postgres connection string.
2. **Run `scripts/production-bootstrap-check.ts`** against the live deployment.
3. **Verify shared-auth state** persists across multiple API requests.
4. **Verify readiness endpoint** returns healthy with DB connectivity confirmed.
5. **Test restart resilience**: Kill and restart the worker, verify state recovery.
6. **Document results** in the issue.

### Testing and Validation

- Bootstrap check script passes against live deployment
- Auth state survives worker restart
- Readiness probe returns 200 with DB status
- Negative test: Removing DB connection string produces clear error (not silent fallback)

### Dependencies

- Live Postgres instance and deployment

---

## Finding 10: Verify Deployed Worker Durability and Recovery

| Field | Detail |
|-------|--------|
| **Issue** | [#144](https://github.com/leonardwongly/agentic/issues/144) — ops(worker): verify deployed worker durability and recovery behavior |
| **Priority** | 🟠 **High (P1)** |
| **Workstream** | AOS Remediation |
| **Dependencies** | Live deployment |
| **Owner** | TBD |
| **Status** | Not Started |

### Finding Description

Verify the deployed worker process runs against the same durable runtime state as the web/API process and that queue handling remains safe under leases, retries, duplicate delivery, and failure states.

**Current behaviour:** Worker durability tested in CI with mocked state; no live verification.
**Expected behaviour:** Live worker processes jobs durably, handles failures gracefully, and recovers from crashes.

### Root Cause Analysis

Worker durability validation deferred pending production deployment.

### Impact Assessment

- **Reliability:** Jobs may be lost or duplicated in production.
- **Correctness:** Lease expiry and retry logic untested under real load.
- **Data Integrity:** Duplicate processing could corrupt state.

### Actionable Remediation Tasks

1. **Deploy worker to staging** with Postgres-backed state.
2. **Submit test jobs** and verify processing completes.
3. **Simulate worker crash** mid-job and verify lease expiry + re-queue.
4. **Submit duplicate job IDs** and verify idempotency guards.
5. **Test circuit breaker** by injecting consecutive failures.
6. **Verify dead-letter queue** captures permanently failed jobs.
7. **Document results** with timestamps and evidence.

### Testing and Validation

- Job submitted → processed → completed (happy path)
- Worker killed mid-job → job re-queued after lease expiry
- Duplicate submission → only one execution
- 6+ consecutive failures → circuit breaker opens
- Dead-letter job visible in dashboard/API

### Dependencies

- Finding 9 (#143) — Postgres bootstrap must be proven first

---

## Finding 11: Validate Live GitHub App Issue Sync End-to-End

| Field | Detail |
|-------|--------|
| **Issue** | [#145](https://github.com/leonardwongly/agentic/issues/145) — test(github): validate live GitHub App issue sync end to end |
| **Priority** | 🟠 **High (P1)** |
| **Workstream** | AOS Remediation |
| **Dependencies** | Finding 8 (#142) — GitHub App must be configured first |
| **Owner** | TBD |
| **Status** | Not Started |

### Finding Description

Prove the merged GitHub App issue sync path works against the deployed Agentic endpoint and allowlisted live GitHub issues. Route tests and CI are green, but completion requires exercising the real deployment, GitHub App installation auth, workflow caller settings, queueing, and worker processing together.

**Current behaviour:** Unit/integration tests pass; no live end-to-end validation.
**Expected behaviour:** GitHub issue opened → webhook received → job queued → worker processes → issue updated with sync metadata.

### Root Cause Analysis

End-to-end validation requires live infrastructure that wasn't available during development.

### Impact Assessment

- **Functionality:** GitHub App sync unproven in production.
- **Reliability:** Webhook delivery, auth, and queue processing untested together.

### Actionable Remediation Tasks

1. **Complete Finding 8** (#142) — configure GitHub App credentials.
2. **Create a test issue** on the allowlisted repository.
3. **Verify webhook delivery** to the deployed endpoint.
4. **Verify job creation** in the queue.
5. **Verify worker processing** and issue update.
6. **Test error scenarios**: Invalid webhook signature, expired token, rate-limited API.
7. **Document the full flow** with screenshots/logs.

### Testing and Validation

- Test issue created → synced → updated (happy path)
- Invalid webhook signature → rejected with 401
- Rate-limited GitHub API → retried with backoff
- Worker offline → job queued and processed on recovery

### Dependencies

- Finding 8 (#142) must be complete

---

## Finding 12: Roadmap — Close Capability and Operations Gaps

| Field | Detail |
|-------|--------|
| **Issue** | [#152](https://github.com/leonardwongly/agentic/issues/152) — plan(roadmap): close Agentic capability and operations gaps after production proof |
| **Priority** | 🟠 **High (P1)** |
| **Workstream** | AOS Remediation |
| **Owner** | TBD |
| **Status** | In Progress (tracking issue) |

### Finding Description

Parent roadmap for the next Agentic action plan after production-readiness closeout. Based on repository reconnaissance, live GitHub issue state, capability smoke output, remediation tracker output, and validation/security surface review.

### Actionable Remediation Tasks

1. **Update roadmap** as findings 8-11 are completed with live evidence.
2. **Identify new gaps** surfaced during production proof.
3. **Create child issues** for newly discovered work items.
4. **Close when** all Tier 1 capabilities have production evidence.

### Dependencies

- Findings 8-11 provide input evidence

---

## Finding 13: Cognitive-Core Activation Roadmap (Tiers 1-3)

| Field | Detail |
|-------|--------|
| **Issue** | [#1011](https://github.com/leonardwongly/agentic/issues/1011) — [AOS] Cognitive-core activation roadmap (Tiers 1-3) |
| **Priority** | 📋 **Roadmap/Planning** |
| **Workstream** | Cognitive-Core Activation |
| **Owner** | TBD |
| **Status** | Planning |

### Finding Description

Consolidation roadmap from the real-state map. The cognitive-core machinery (AOS-19..27) is merged and coherent, but the operating loop has 6 operational / 5 preview capabilities. Preview surfaces are blocked on operational/deployment evidence, not code.

**Tier 1:** Enablement + real-world validation (#1006, #142, #144, #152)
**Tier 2:** Connector expansion + multi-provider support
**Tier 3:** Autonomous improvement loops

### Actionable Remediation Tasks

1. **Track Tier 1 progress** via linked issues.
2. **Define Tier 2 scope** once Tier 1 evidence is collected.
3. **Update this issue** with quarterly status updates.

### Dependencies

- Tier 1 issues (#1006, #142, #144, #152)

---

## Execution Sequence

```
Phase 1 — Foundation (Weeks 1-3)
├── Finding 1 (#979): node:fs isolation [CRITICAL]
└── Finding 3 (#982): SDK validation under workerd [HIGH, parallel]

Phase 2 — Production Proof (Weeks 2-4, overlaps Phase 1)
├── Finding 8 (#142): GitHub App config [HIGH]
├── Finding 9 (#143): Postgres bootstrap proof [HIGH]
├── Finding 10 (#144): Worker durability [HIGH, depends on #143]
└── Finding 11 (#145): GitHub App E2E [HIGH, depends on #142]

Phase 3 — Cloudflare Completion (Weeks 3-5)
├── Finding 2 (#981): Watcher scheduler [HIGH, depends on #979]
├── Finding 4 (#984): Config/secrets parity [MEDIUM]
└── Finding 5 (#985): Deployment runbook [MEDIUM, depends on #984]

Phase 4 — Cognitive-Core (Weeks 4-6)
├── Finding 7 (#1006): Model planner evaluation [MEDIUM]
└── Finding 12 (#152): Roadmap update [HIGH, ongoing]

Ongoing
├── Finding 6 (#986): Epic tracking [META]
└── Finding 13 (#1011): Cognitive-core roadmap [PLANNING]
```

---

## Summary Matrix

| # | Finding | Priority | Status | Dependencies | Estimated Effort |
|---|---------|----------|--------|-------------|-----------------|
| 1 | node:fs isolation | 🔴 Critical | Not Started | None | 2-3 weeks |
| 2 | Watcher scheduler | 🟠 High | Not Started | #979 | 2-3 days |
| 3 | SDK validation | 🟠 High | Not Started | None | 1 week |
| 4 | Config/secrets parity | 🟡 Medium | Not Started | #977-980 ✅ | 1 week |
| 5 | Deployment runbook | 🟡 Medium | Not Started | #984 | 3-5 days |
| 6 | Epic tracking | 📋 Meta | In Progress | Sub-issues | Ongoing |
| 7 | Model planner | 🟡 Medium | Not Started | Provider key | 1-2 weeks |
| 8 | GitHub App config | 🟠 High | Not Started | Live deploy | 2-3 days |
| 9 | Postgres bootstrap | 🟠 High | Not Started | Live Postgres | 2-3 days |
| 10 | Worker durability | 🟠 High | Not Started | #143 | 3-5 days |
| 11 | GitHub App E2E | 🟠 High | Not Started | #142 | 2-3 days |
| 12 | Roadmap | 🟠 High | In Progress | #142-145 | Ongoing |
| 13 | Cognitive-core | 📋 Planning | Planning | Tier 1 | Ongoing |

---

## Risk Register & Contingency Planning

Each critical and high-priority finding includes a fallback strategy if the primary remediation approach fails.

| # | Finding | Primary Risk | Likelihood | Impact | Contingency / Fallback |
|---|---------|-------------|------------|--------|----------------------|
| 1 | node:fs isolation | R2/KV adapter introduces latency or consistency issues not present in file-backed store | Medium | High | Maintain dual-mode adapter; self-hosted continues using `node:fs`. Workers deployment proceeds with documented limitations. Add feature flag `AGENTIC_STORAGE_BACKEND` to select adapter at runtime. |
| 2 | Watcher scheduler | Cron granularity (1-min minimum) insufficient for sub-minute watcher intervals | Low | Medium | Document minimum cadence. For sub-minute watchers, fall back to event-driven triggers only on Workers. Self-hosted retains interval-based scheduling. |
| 3 | SDK validation | `googleapis` fundamentally incompatible with `workerd` even under `nodejs_compat` | Medium | High | Lazy-load googleapis behind a runtime check. On Workers, disable Google integrations and surface clear "not available on this platform" messaging. File upstream issue with Cloudflare. Consider REST API alternative to googleapis SDK. |
| 4 | Config/secrets parity | Workers Secrets Store has different rotation semantics than `process.env` | Low | Medium | Implement secret versioning in the adapter layer. Support both env-var and Secrets Store backends transparently. |
| 7 | Model planner | Model provider API costs exceed budget during evaluation | Medium | Medium | Set hard token/cost caps in eval harness. Use smaller/cheaper model for initial evaluation. Define cost-per-decision threshold before graduating to default. |
| 8 | GitHub App config | GitHub App installation permissions insufficient for target org | Low | High | Document required permissions upfront. Provide pre-flight permission checker script. Fall back to PAT-based sync if App install blocked. |
| 9 | Postgres bootstrap | Hyperdrive connection pooling behaves differently than direct `pg` driver | Medium | High | Test connection pooling under load before production. Maintain direct `pg` fallback for non-Workers deployments. Add connection health monitoring. |
| 10 | Worker durability | Lease expiry timing differs between Node timers and Workers `waitUntil()` | Medium | High | Validate lease mechanics under Miniflare first. Add configurable lease grace period. Monitor dead-letter queue for unexpected failures post-deploy. |
| 11 | GitHub App E2E | Webhook delivery delayed or dropped by GitHub | Low | Medium | Implement webhook retry with exponential backoff. Add webhook receipt logging. Provide manual sync trigger as fallback. |

### Escalation Path

| Severity | Response Time | Escalate To | Action |
|----------|--------------|-------------|--------|
| Critical blocker (deployment blocked) | Same day | Project Lead + Platform Team | Swarm resolution; consider temporary workaround |
| High blocker (feature broken) | Within 2 business days | Tech Lead | Assign dedicated engineer; daily standup tracking |
| Medium issue | Within 1 week | Team Lead | Schedule into sprint; weekly review |
| Assumption invalidated | Immediate | All stakeholders | Re-evaluate affected findings; update plan |

---

## Resource & Capacity Planning

### Effort Estimates (Person-Weeks)

| # | Finding | Estimated Effort | Required Skills | Notes |
|---|---------|-----------------|----------------|-------|
| 1 | node:fs isolation | 2-3 person-weeks | TypeScript, Cloudflare Workers/R2/KV, storage abstraction patterns | Largest single finding; requires architectural design |
| 2 | Watcher scheduler | 0.5 person-weeks | TypeScript, Cloudflare Cron Triggers | Straightforward wiring once #979 done |
| 3 | SDK validation | 1 person-week | Cloudflare workerd, Node.js compatibility, bundle analysis | Investigation-heavy; may uncover additional issues |
| 4 | Config/secrets parity | 1 person-week | Cloudflare Workers bindings, security headers, CSP | Testing-heavy across environments |
| 5 | Deployment runbook | 0.5-1 person-week | Technical writing, Cloudflare operations | Documentation; requires completed findings for accuracy |
| 7 | Model planner | 1-2 person-weeks | AI/ML evaluation, Anthropic/OpenAI APIs, metrics design | Requires provider credentials and staging environment |
| 8 | GitHub App config | 0.5 person-weeks | GitHub Apps, secrets management, CI/CD | Operational configuration; low code change |
| 9 | Postgres bootstrap | 0.5 person-weeks | Postgres, Hyperdrive, deployment ops | Validation against live infrastructure |
| 10 | Worker durability | 0.5-1 person-weeks | Distributed systems, lease mechanics, failure injection | Requires staging environment with Postgres |
| 11 | GitHub App E2E | 0.5 person-weeks | GitHub webhooks, integration testing | Depends on #142 being complete |
| 12 | Roadmap | Ongoing (0.25 pw) | Project management, stakeholder alignment | Tracking/planning overhead |
| 13 | Cognitive-core | Ongoing (0.25 pw) | Architecture, product planning | Strategic planning |

**Total estimated effort:** 8-11 person-weeks of focused engineering work

### Skill Requirements

| Skill Area | Findings Requiring It | Availability | Gap? |
|-----------|----------------------|-------------|------|
| Cloudflare Workers / Wrangler | #979, #981, #982, #984, #985 | TBD | Assess team familiarity |
| Storage Abstraction Design | #979 | TBD | May require senior engineer |
| Postgres / Hyperdrive | #979, #143, #144 | TBD | DBA or backend engineer |
| GitHub Apps / Webhooks | #142, #145 | TBD | DevOps or platform engineer |
| AI/ML Evaluation | #1006 | TBD | ML engineer or experienced backend |
| Technical Writing | #985 | TBD | Any engineer with docs experience |

---

## Definition of Done / Acceptance Criteria

Each finding is considered complete only when **all** acceptance criteria are met.

| # | Finding | Acceptance Criteria |
|---|---------|-------------------|
| 1 | node:fs isolation | ✅ `wrangler deploy --dry-run` succeeds with zero `node:fs` errors<br>✅ Self-hosted mode passes full test suite using file adapter<br>✅ Workers mode boots and serves requests using R2/KV adapter<br>✅ Runtime adapter selection is automatic based on environment<br>✅ Code review approved by at least 1 reviewer |
| 2 | Watcher scheduler | ✅ `scheduled()` handler invokes watcher pass on every cron tick<br>✅ Time-based watchers fire correctly under Miniflare<br>✅ No duplicate evaluations on overlapping ticks<br>✅ Telemetry logs watcher scheduler invocations |
| 3 | SDK validation | ✅ Bundle size report documented (< target threshold)<br>✅ Each SDK function tested under Miniflare with `nodejs_compat`<br>✅ Lazy-loading verified (SDKs not in cold path)<br>✅ Incompatible features documented with user-facing messaging |
| 4 | Config/secrets parity | ✅ Client IP correctly resolved from CF headers<br>✅ All secrets accessible via Workers bindings<br>✅ CSP headers validated for edge-origin responses<br>✅ Readiness probe checks Hyperdrive connectivity<br>✅ Self-hosted mode unaffected (regression tests pass) |
| 5 | Deployment runbook | ✅ Runbook covers prerequisites, deploy, verify, rollback<br>✅ Fresh operator successfully follows runbook end-to-end<br>✅ Rollback procedure tested and documented<br>✅ Cross-referenced with existing runbooks |
| 7 | Model planner | ✅ Evaluation metrics captured against defined thresholds<br>✅ Cost-per-decision within budget<br>✅ Graduation decision documented with evidence<br>✅ Kill-switch verified functional |
| 8 | GitHub App config | ✅ Preflight script passes all checks<br>✅ Manual sync creates/updates issues correctly<br>✅ Credentials stored securely (not in repo/env plaintext)<br>✅ Error handling produces actionable messages |
| 9 | Postgres bootstrap | ✅ Bootstrap check passes against live deployment<br>✅ Auth state persists across worker restarts<br>✅ Readiness endpoint returns 200 with DB status<br>✅ Removing DB string produces explicit error (no silent fallback) |
| 10 | Worker durability | ✅ Happy-path job completes end-to-end<br>✅ Crash recovery re-queues job after lease expiry<br>✅ Duplicate submissions produce single execution<br>✅ Circuit breaker opens after threshold failures<br>✅ Dead-letter queue captures permanent failures |
| 11 | GitHub App E2E | ✅ Full flow: issue created → webhook → queue → process → updated<br>✅ Invalid webhook signature rejected with 401<br>✅ Rate-limited API retried with backoff<br>✅ Worker offline → job queued → processed on recovery |

---

## Known Risks & Assumptions

### Assumptions (Validate Before Proceeding)

| # | Assumption | Validation Task | Owner | Status |
|---|-----------|----------------|-------|--------|
| A1 | `workerd` `nodejs_compat` supports all Node APIs used by googleapis, @anthropic-ai/sdk, and openai | Run each SDK's core functions under Miniflare; document unsupported APIs | TBD | Not Validated |
| A2 | Hyperdrive connection latency is acceptable for real-time API responses (< 100ms p95) | Benchmark Hyperdrive vs direct pg under load | TBD | Not Validated |
| A3 | R2/KV provides sufficient consistency guarantees for the file-store lock replacement | Design review + prototype test with concurrent writers | TBD | Not Validated |
| A4 | Cloudflare Workers free-tier limits (10MB bundle, 30s CPU) are sufficient for the application | `wrangler deploy --dry-run` bundle size check; CPU profiling | TBD | Not Validated |
| A5 | Provider API keys (Anthropic/OpenAI) are obtainable within budget for evaluation | Confirm with finance/stakeholder | TBD | Not Validated |
| A6 | GitHub App can be installed on the target organization with required permissions | Pre-flight permission check | TBD | Not Validated |
| A7 | Existing self-hosted/Docker deployments are unaffected by storage adapter changes | Full regression test suite on self-hosted mode | TBD | Not Validated |

### Risks (Monitor Throughout Execution)

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Cloudflare deprecates or changes `nodejs_compat` behaviour | Low | High | Pin Wrangler version; monitor Cloudflare changelog; maintain fallback paths |
| googleapis SDK bundle exceeds Workers limits even with lazy-loading | Medium | High | Evaluate REST API alternative; consider tree-shaking or subset import |
| Hyperdrive enters beta/breaking changes during migration | Low | Medium | Pin Hyperdrive version; maintain direct pg fallback |
| Team lacks Cloudflare Workers expertise | Medium | Medium | Allocate learning time in Phase 1; pair programming; Cloudflare docs/discord |
| Production proof reveals fundamental architecture gaps | Low | Critical | Fail fast; escalate immediately; reassess migration viability |
| Dependency updates during migration cause regressions | Medium | Medium | Freeze dependency updates during active migration phases; use dependabot pause |

---

## Cross-Cutting Concerns

These concerns span multiple findings and should be addressed holistically rather than per-finding.

### Observability & Monitoring for Workers

| Concern | Affected Findings | Action |
|---------|------------------|--------|
| Workers Observability setup | #979, #981, #982, #984 | Enable Workers Logs + Tail Workers in wrangler.jsonc. Define log levels and structured fields consistent with existing observability package. |
| Error tracking integration | All Cloudflare findings | Integrate Sentry or equivalent error tracker for Workers. Ensure unhandled exceptions are captured with request context. |
| Metrics export from Workers | #981, #982, #144 | Adapt `@agentic/observability` to support Workers Analytics Engine or external metrics endpoint. Verify counter/gauge/histogram exports work under workerd. |
| Alerting thresholds | #143, #144 | Define alerting rules for: error rate > 1%, p95 latency > 2s, dead-letter queue depth > 10, circuit breaker open events. |

### Secret Management & Rotation

| Concern | Affected Findings | Action |
|---------|------------------|--------|
| Workers Secrets Store provisioning | #984, #142 | Document `wrangler secret put` workflow for all required secrets. Create secrets inventory checklist. |
| Secret rotation procedure | #984 | Define rotation cadence and zero-downtime rotation steps for each secret type (API keys, OAuth tokens, DB passwords). |
| Local dev secret parity | #979, #984 | Ensure `.dev.vars` file mirrors Workers Secrets Store structure for local development. |

### CI/CD Pipeline Updates

| Concern | Affected Findings | Action |
|---------|------------------|--------|
| Workers build step in CI | #983 ✅, #979 | Add `wrangler deploy --dry-run` to CI pipeline after #979 is complete. Gate merge on successful dry-run. |
| Staging environment for production proof | #142, #143, #144, #145 | Provision staging Cloudflare account with R2, Hyperdrive, and Secrets Store. Document staging setup in runbook. |
| E2E test environment for Workers | #981, #982 | Add Miniflare-based E2E tests to CI. Separate from Playwright browser tests. |

### Backward Compatibility

| Concern | Affected Findings | Action |
|---------|------------------|--------|
| Self-hosted mode preservation | #979, #984 | All adapter changes must be opt-in for Workers. Self-hosted mode uses existing code paths by default. Feature flag `AGENTIC_RUNTIME=workers\|node` controls adapter selection. |
| API contract stability | #984 | No API response format changes. Client IP resolution change is internal only. Security headers remain superset of current. |
| Database schema compatibility | #143 | No schema changes required for Hyperdrive. Connection string format differs but schema is identical. |

---

## Timeline with Milestones & Go/No-Go Gates

```
Week 1 (Sep 8-12)
├── MILESTONE: Phase 1 Kickoff
│   ├── Validate Assumptions A1, A3, A4 (SDK compat, R2 consistency, bundle size)
│   ├── Begin Finding 1 (#979): Storage adapter design
│   └── Begin Finding 3 (#982): SDK validation under Miniflare
├── GO/NO-GO GATE 1 (Sep 12): Are Workers fundamentals viable?
│   ├── YES → Continue to Week 2
│   └── NO → Escalate; reassess migration target; consider Vercel/Deno alternative
│
Week 2 (Sep 15-19)
├── MILESTONE: Storage Adapter Prototype
│   ├── Finding 1 (#979): Adapter interface + R2/KV implementation
│   ├── Finding 3 (#982): SDK validation results documented
│   └── Begin Finding 8 (#142): GitHub App config (parallel, no CF dependency)
├── CHECKPOINT: Weekly sync review
│
Week 3 (Sep 22-26)
├── MILESTONE: Phase 1 Complete + Phase 2 Start
│   ├── Finding 1 (#979): Complete + reviewed
│   ├── Finding 2 (#981): Watcher scheduler wired
│   ├── Finding 9 (#143): Postgres bootstrap proof initiated
│   └── GO/NO-GO GATE 2 (Sep 26): Is node:fs isolation production-ready?
│       ├── YES → Proceed to Phase 2 production proof
│       └── NO → Extend Phase 1; defer Phase 2
│
Week 4 (Sep 29 - Oct 3)
├── MILESTONE: Production Proof Evidence
│   ├── Finding 9 (#143): Postgres bootstrap proven
│   ├── Finding 10 (#144): Worker durability verified
│   ├── Finding 8 (#142): GitHub App configured
│   └── Finding 11 (#145): E2E sync validated
├── CHECKPOINT: Stakeholder demo of production proof results
│
Week 5 (Oct 6-10)
├── MILESTONE: Cloudflare Completion
│   ├── Finding 4 (#984): Config/secrets parity verified
│   ├── Finding 5 (#985): Runbook drafted + reviewed
│   └── GO/NO-GO GATE 3 (Oct 10): Is Workers deployment production-ready?
│       ├── YES → Announce Workers as supported deployment target
│       └── NO → Document gaps; schedule remediation sprint
│
Week 6 (Oct 13-17)
├── MILESTONE: Cognitive-Core Evaluation
│   ├── Finding 7 (#1006): Model planner evaluation complete
│   ├── Finding 12 (#152): Roadmap updated with evidence
│   └── Finding 13 (#1011): Tier 2 scope defined
├── FINAL REVIEW: Full plan retrospective + next quarter planning
```

### Go/No-Go Decision Criteria

| Gate | Date | Decision Maker | Criteria for GO | Criteria for NO-GO |
|------|------|---------------|-----------------|-------------------|
| Gate 1 | Sep 12 | Tech Lead + Platform | SDKs work under workerd; bundle < 10MB; R2 prototype functional | Fundamental incompatibility; bundle > 15MB; no viable storage alternative |
| Gate 2 | Sep 26 | Tech Lead | Storage adapter passes all tests; self-hosted regression clean; Workers boots successfully | Adapter introduces data loss risk; self-hosted regressions; > 3 unresolved bugs |
| Gate 3 | Oct 10 | Project Lead + Stakeholders | All P0/P1 Cloudflare findings closed; runbook reviewed; staging deployment verified | > 2 P1 findings incomplete; no working rollback procedure; security review not passed |

---

## Communication Plan

### Stakeholder Matrix

| Stakeholder | Information Need | Cadence | Channel | Owner |
|------------|-----------------|---------|---------|-------|
| Engineering Team | Task assignments, blockers, technical decisions | Daily | Standup / Slack | Tech Lead |
| Project Lead | Progress against milestones, risks, go/no-go readiness | Weekly | Status report / meeting | Project Lead |
| Platform/Ops Team | Infrastructure requirements, secret provisioning, deployment access | As needed | Ticket / Slack | Platform Lead |
| Product/Stakeholders | Capability status, timeline, go/no-go outcomes | Bi-weekly | Demo / email | Project Lead |
| Security Team | Security review requests, CSP/header changes, secret handling | Per finding | Review request | Security Lead |

### Reporting Cadence

| Report | Audience | Frequency | Contents |
|--------|---------|-----------|----------|
| Daily standup update | Engineering team | Daily | Blockers, progress, next steps |
| Weekly status report | Project lead + stakeholders | Friday | Milestone progress, risk register updates, upcoming gates |
| Go/No-Go brief | Decision makers | At each gate | Evidence summary, recommendation, contingency status |
| Phase completion report | All stakeholders | End of each phase | Completed findings, evidence links, lessons learned |
| Final retrospective | All stakeholders | End of plan | Overall outcomes, remaining gaps, next quarter recommendations |

### Escalation Triggers

| Trigger | Escalate To | Within |
|---------|-----------|--------|
| Critical finding blocked > 2 days | Project Lead + Platform Team | Same day |
| Assumption invalidated | All stakeholders + Tech Lead | Immediate |
| Go/No-Go gate criteria not met | Project Lead + Stakeholders | Before gate date |
| Security concern discovered | Security Lead + Tech Lead | Same day |
| Budget/resource constraint | Project Lead + Finance | Within 2 days |

---

## Change Management

### User Impact Assessment

| Change | Affected Users | Impact Level | Communication Required | Migration Path |
|--------|---------------|-------------|----------------------|---------------|
| Storage adapter (#979) | Self-hosted operators | Low (transparent) | Release notes | Automatic; no action required |
| Workers deployment option (#986) | New deployers | Positive (new option) | Documentation + announcement | Opt-in; existing deployments unaffected |
| Model planner graduation (#1006) | All users | Medium (behaviour change) | Release notes + feature flag docs | Gradual rollout via feature flag; kill-switch available |
| GitHub App sync activation (#142) | Repo admins | Low (additive) | Setup guide | Opt-in configuration |
| Zod 4.5.4 error messages | API consumers | Low (message text only) | Changelog | No code change needed; error codes unchanged |

### Rollout Strategy

| Finding | Rollout Approach | Feature Flag | Rollback Method |
|---------|-----------------|-------------|----------------|
| #979 Storage adapter | Dual-mode from day 1 | `AGENTIC_STORAGE_BACKEND=node\|cloudflare` | Set flag to `node`; restart |
| #981 Watcher scheduler | Enabled with cron trigger | `AGENTIC_WATCHER_SCHEDULER_DISABLED` | Set flag to `true`; redeploy |
| #1006 Model planner | Gradual: staging → canary → production | `AGENTIC_MODEL_PLANNER` | Set flag to `false`; no restart needed |
| #142 GitHub App sync | Opt-in per repository | Repository-level config | Remove App installation or disable workflow |

### Backward Compatibility Guarantees

1. **All existing deployment modes (Docker, self-hosted, free-tier serverless) continue to work unchanged.** Workers is an additional option, not a replacement.
2. **No API contract changes.** Response formats, status codes, and error structures remain identical.
3. **No database schema changes.** Hyperdrive uses the same Postgres schema.
4. **Feature flags default to existing behaviour.** New capabilities are opt-in until graduated.
5. **Rollback to any previous version remains possible** at any point during the migration.

---

## Appendix: Iterative Implementation Workflow

Each finding follows this 10-step lifecycle:

```
1. CONFIRM    → Validate finding still applies; gather latest context
2. ANALYSE    → Root cause investigation; impact quantification
3. DESIGN     → Solution design; peer review of approach
4. PRIORITISE → Confirm priority; assign owner; schedule
5. IMPLEMENT  → Code changes; unit tests; local verification
6. TEST       → Integration tests; edge cases; regression suite
7. REVIEW     → Code review; security review (if applicable); docs update
8. REFINE     → Address review feedback; re-test if needed
9. DEPLOY     → Merge to main; CI passes; staging verification
10. MONITOR   → Production observation; alert verification; close finding
```

### Status Tracking

Each finding moves through these statuses:

| Status | Meaning |
|--------|---------|
| Not Started | Finding confirmed but no work begun |
| In Progress | Active implementation underway |
| Under Review | Implementation complete; awaiting code/security review |
| Staged | Merged to main; deployed to staging; awaiting verification |
| Complete | All acceptance criteria met; deployed to production; monitored |
| Deferred | Deprioritised due to changed circumstances; revisit date set |
| Won't Fix | Finding no longer applicable; rationale documented |
