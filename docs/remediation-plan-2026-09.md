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
