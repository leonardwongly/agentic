# Cloudflare Live Provisioning & Validation Runbook

> **Audience:** Operator deploying Agentic to Cloudflare Workers for the first time, or validating an existing deployment against the acceptance criteria for open issues #979, #981, #982, #984, #985, #986, #1006.
>
> **Companion docs:**
> - [Cloudflare Workers Deployment Guide](../deployment/cloudflare-workers.md) — build, deploy, rollback
> - [Remediation Plan](../remediation-plan-2026-09.md) — issue traceability and priority
> - [Worker Durability](./worker-durability.md) — lease expiry, retry, dead-letter
> - [Worker Concurrency Controls](./worker-concurrency-controls.md) — backpressure, limits

---

## Overview

All code for the Cloudflare Workers migration is merged. The remaining work is **operational**: provision live Cloudflare infrastructure, deploy the Worker, and validate each open issue's acceptance criteria against the running deployment. This runbook is the sequential checklist.

**Estimated time:** 60–90 minutes for first-time provisioning; 15–20 minutes for re-validation.

**Prerequisites:**
- Cloudflare account (Workers Paid recommended for production proof; Free works for smoke tests)
- Wrangler CLI authenticated (`npx wrangler login` or `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`)
- Postgres instance accessible from the public internet (Supabase, Neon, RDS, etc.)
- `git` working tree on `main` with all migration code merged

---

## Phase 1: Infrastructure Provisioning

### 1.1 Postgres Schema

Apply migrations out-of-band. Workers never run migrations.

```bash
# From the repo root:
DATABASE_URL=postgres://USER:PASS@HOST:5432/agentic npm run db:migrate
DATABASE_URL=postgres://USER:PASS@HOST:5432/agentic npm run db:status -- --require-ready
```

**Verify:** `db:status` exits 0 with all migrations `ready`.

### 1.2 Hyperdrive

Hyperdrive provides a per-request connection-string binding that pg on Workers resolves through Cloudflare's edge proxy. This replaces the persistent connection pool that Node self-hosted mode uses.

```bash
npx wrangler hyperdrive create agentic-db \
  --connection-string="postgres://USER:PASS@HOST:5432/agentic"
```

Capture the output `id` (e.g. `819b9b7ecf14441cbbd1e456ed3e50d1`).

Update `apps/web/wrangler.jsonc` → `hyperdrive[0].id` with the real value.

**Verify:**

```bash
cd apps/web
npx wrangler hyperdrive list
# Confirm agentic-db appears with the correct connection string host
```

### 1.3 Cron Trigger

Already configured in `apps/web/wrangler.jsonc`:

```jsonc
"triggers": {
  "crons": ["*/5 * * * *"]
}
```

No additional provisioning needed. The cron fires automatically after deploy.

### 1.4 R2 (Future — Not Yet Wired)

R2 is available but not yet integrated. The storage adapter for `node:fs` isolation (#979) will target R2 when implemented. No action required in this runbook.

---

## Phase 2: Secrets & Configuration

### 2.1 Machine Token Minting

The cron trigger authenticates to `POST /api/worker/tick` via a machine token. Mint the hash:

```bash
# Choose a raw token (store it securely):
RAW_TOKEN='<generate-a-random-string>'

# Hash for AGENTIC_MACHINE_TOKENS_JSON:
node -e 'const c=require("node:crypto");console.log(`sha256:${c.createHash("sha256").update(process.argv[1].trim()).digest("hex")}`)' "$RAW_TOKEN"
```

Record both values. The raw token goes to `AGENTIC_WORKER_TICK_TOKEN`; the hash goes into the machine tokens JSON.

### 2.2 Machine Tokens JSON

Construct the JSON record:

```json
[
  {
    "name": "worker-tick",
    "tokenHash": "sha256:<hash-from-above>",
    "scopes": ["worker:tick"],
    "routeGroups": ["worker"]
  }
]
```

### 2.3 Push Secrets

From `apps/web/`:

```bash
cd apps/web

# Public origin (use your actual worker domain after first deploy, or set as var):
npx wrangler secret put AGENTIC_PUBLIC_BASE_URL
# Enter: https://<your-worker-domain>.workers.dev

# Core auth:
npx wrangler secret put AGENTIC_ACCESS_KEY
npx wrangler secret put AGENTIC_BOOTSTRAP_USER_ID
npx wrangler secret put AGENTIC_BOOTSTRAP_DISPLAY_NAME
npx wrangler secret put AGENTIC_SHARED_AUTH_STATE        # enter: true
npx wrangler secret put AGENTIC_REQUIRE_SHARED_AUTH_STATE # enter: true

# Cron worker tick:
npx wrangler secret put AGENTIC_WORKER_TICK_TOKEN         # enter: $RAW_TOKEN
npx wrangler secret put AGENTIC_MACHINE_TOKENS_JSON       # enter: the JSON array from 2.2
```

**Committed vars** (already in `wrangler.jsonc`, no action needed):
- `AGENTIC_TRUST_PROXY_HEADERS=true`
- `AGENTIC_PROXY_HEADER_OVERWRITE_CONFIRMED=true`
- `AGENTIC_TRUSTED_CLIENT_IP_HEADER=cf-connecting-ip`
- `AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES=leonardwongly/agentic`

### 2.4 Optional Provider Secrets

Only if testing model-backed planner (#1006) or connector integrations:

```bash
npx wrangler secret put ANTHROPIC_API_KEY      # for model planner eval
npx wrangler secret put OPENAI_API_KEY          # alternative provider
# Google/Slack/Telegram/GitHub as needed for connector tests
```

---

## Phase 3: Build & Deploy

```bash
# From repo root:
npm run cf:build -w @agentic/web      # Webpack build + OpenNext transform
npm run cf:check-size                 # Must pass (~2.4 MiB < 3 MiB free limit)

# From apps/web:
cd apps/web
npx wrangler versions upload          # Preview — does not promote
npx wrangler deploy                   # Promote to production
```

Capture the **version ID** from the deploy output for rollback.

**Workers Paid CPU budget** (if authenticated routes hit Cloudflare 1102):

```jsonc
// Add to wrangler.jsonc only on Workers Paid:
"limits": { "cpu_ms": 30000 }
```

Do **not** commit this on Workers Free — Cloudflare rejects it with API error `100328`.

---

## Phase 4: Smoke Tests

Run these immediately after deploy to confirm the Worker is alive.

```bash
WORKER_URL="https://<your-worker-domain>.workers.dev"

# 1. Health (unauthenticated):
curl -s "$WORKER_URL/api/health" | jq .
# Expected: 200 with status "ok"

# 2. Readiness summary (unauthenticated):
curl -s "$WORKER_URL/api/ready" | jq .
# Expected: 200 with status "ready" or "not_ready" (heartbeat may be stale before first cron)

# 3. Readiness details (authenticated):
curl -s -H "x-agentic-access-key: $AGENTIC_ACCESS_KEY" "$WORKER_URL/api/ready/details" | jq .
# Expected: 200 with individual check statuses
```

---

## Phase 5: Issue-by-Issue Validation

### 5.1 #979 — node:fs Isolation from Workers Bundle

**Status:** Code merged. File-backed features (local notes, self-improvement memory persistence) are documented as unsupported on Workers. The Worker boots without `node:fs` errors.

**Validation:**

| Check | Command | Expected |
|-------|---------|----------|
| Worker boots without `node:fs` errors | `npx wrangler tail` (watch for 60s after deploy) | No `node:fs` module-not-found errors in logs |
| Bundle builds clean | `npm run cf:build -w @agentic/web && npm run cf:check-size` | Exit 0, size under limit |
| Health endpoint responds | `curl $WORKER_URL/api/health` | 200 OK |
| DB-backed readiness works | `curl -H "x-agentic-access-key: $KEY" $WORKER_URL/api/ready/details` | `database` check: `pass` |

**Evidence to capture:** `wrangler tail` output showing clean boot; `/api/health` response; `/api/ready/details` JSON with `storageBackend: "postgres"`.

**Close criteria met when:** Worker boots, serves requests, and no `node:fs` errors appear in invocation logs.

### 5.2 #981 — Watcher Scheduler in Scheduled Handler

**Status:** Code merged. `worker.ts` `scheduled()` calls `POST /api/worker/tick` with `runWatchers: true`. The tick route invokes `runWatcherSchedulerOnce()`.

**Validation:**

| Check | Command | Expected |
|-------|---------|----------|
| Cron trigger registered | Deploy output or Cloudflare dashboard → Triggers | `*/5 * * * *` listed |
| Cron fires successfully | `npx wrangler tail` — wait for next cron tick | `[cron] worker tick 200` in logs |
| Tick processes jobs | Inspect tick response body in tail | `processedCount >= 0`, `ranWatchers: true` |
| Watcher scheduler runs | Same tail output | `watcherDecisionCount` present in `api.worker.tick.completed` telemetry |

**How to trigger an immediate tick** (without waiting for cron):

```bash
curl -s -X POST "$WORKER_URL/api/worker/tick" \
  -H "content-type: application/json" \
  -H "x-agentic-machine-token: $RAW_TICK_TOKEN" \
  -d '{"maxJobs": 10, "maxDurationMs": 10000, "runWatchers": true}' | jq .
```

**Evidence to capture:** `wrangler tail` log lines showing `[cron] worker tick 200` and `api.worker.tick.completed` with `ranWatchers: true`.

**Close criteria met when:** At least one cron tick fires, the tick route responds 200, and `ranWatchers: true` appears in telemetry.

### 5.3 #982 — googleapis & Model SDKs Under workerd

**Status:** Code merged. SDKs are used via `packages/agents/src/model-runner.ts` and integration modules. Validation requires live provider keys.

**Validation:**

| Check | Command | Expected |
|-------|---------|----------|
| Bundle size under limit | `npm run cf:check-size` | Pass (~2.4 MiB) |
| Worker boots with SDKs in bundle | `npx wrangler tail` after deploy | No module resolution errors |
| Model call works (if provider key provisioned) | Enqueue a goal that triggers model planning | Goal completes without SDK errors |

**Bundle size audit:**

```bash
npm run cf:build -w @agentic/web
npm run cf:check-size
# For detailed breakdown:
cd apps/web
npx wrangler deploy --dry-run --outdir=.wrangler-build
ls -lh .wrangler-build/worker.js
```

**Evidence to capture:** Bundle size output; clean `wrangler tail` logs post-deploy; if provider key available, a successful model invocation log.

**Close criteria met when:** Bundle builds under size limit, Worker boots without SDK-related errors, and (if provider key available) at least one model call succeeds.

### 5.4 #984 — Config, Secrets, Request Identity & CSP Parity

**Status:** Code merged. `request-client-identity.ts` prefers `cf.connectingIp` when `AGENTIC_TRUST_PROXY_HEADERS=true` and `AGENTIC_TRUSTED_CLIENT_IP_HEADER=cf-connecting-ip`.

**Validation:**

| Check | Command | Expected |
|-------|---------|----------|
| Client IP from CF, not spoofable header | Send request with fake `cf-connecting-ip` header | Response uses edge IP, not spoofed value |
| Secrets populate `process.env` | `curl -H "x-agentic-access-key: $KEY" $WORKER_URL/api/ready/details` | `access_key` check: `pass` |
| CSP headers present | `curl -I $WORKER_URL/api/health` | `Content-Security-Policy`, `X-Frame-Options: DENY` present |
| No `localhost` in CSP | Inspect CSP header value | No `localhost` or `127.0.0.1` references |
| Request identity uses trusted-ip | `/api/ready/details` → `request_identity` check | `identitySource: "trusted-ip"` |

**Spoof test:**

```bash
# This should NOT change the client IP used for rate limiting:
curl -H "cf-connecting-ip: 1.2.3.4" -H "x-agentic-access-key: $KEY" \
  "$WORKER_URL/api/ready/details" | jq '.checks[] | select(.name=="request_identity")'
# The identity should reflect the actual edge IP, not 1.2.3.4
```

**Evidence to capture:** Response headers from `/api/health` showing CSP; `/api/ready/details` JSON showing all checks pass; spoof test result.

**Close criteria met when:** Secrets authenticate successfully, CSP headers are correct for edge origin, and client IP is derived from the edge (not spoofable).

### 5.5 #985 — Deployment Runbook & Rollback

**Status:** This runbook + the existing [deployment guide](../deployment/cloudflare-workers.md) satisfy the documentation requirement.

**Validation:**

| Check | Method | Expected |
|-------|--------|----------|
| Runbook exists | Verify this file + deployment guide | Both present in `docs/` |
| Rollback works | `npx wrangler deployments list` → `npx wrangler rollback <version-id>` | Previous version restored |
| Fresh operator can follow runbook | Peer review or walkthrough | All steps executable without tribal knowledge |

**Rollback drill:**

```bash
cd apps/web

# List versions:
npx wrangler deployments list

# Roll back to previous:
npx wrangler rollback <previous-version-id>

# Verify:
curl -s "$WORKER_URL/api/health" | jq .
```

**Evidence to capture:** Rollback command output; post-rollback health check.

**Close criteria met when:** Documentation is comprehensive, rollback has been exercised successfully, and a fresh operator can deploy from the runbook alone.

### 5.6 #986 — [Epic] Cloudflare Workers Migration

**Status:** Parent tracking issue. Close when all sub-issues (#979, #981, #982, #984, #985) are closed.

**Validation:** Confirm each sub-issue's close criteria above. Update the epic body with a progress checklist.

### 5.7 #1006 — Model-Backed Planner Evaluation

**Status:** Code merged behind `AGENTIC_MODEL_PLANNER` flag. Requires a live provider key and deployment.

**Validation:**

| Check | Command | Expected |
|-------|---------|----------|
| Provider key provisioned | `npx wrangler secret put ANTHROPIC_API_KEY` | Secret stored |
| Planner flag enabled | Set in wrangler.jsonc vars or as secret: `AGENTIC_MODEL_PLANNER=true` | Planner active |
| Eval suite passes | `npx tsx scripts/model-eval.ts` (locally with provider key) | Metrics meet thresholds |
| Model call works on Workers | Enqueue a goal that triggers planning | Goal completes with model-produced plan |

**Local eval (requires provider key in local env):**

```bash
ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/model-eval.ts
```

**On-Workers eval:**

```bash
# Ensure AGENTIC_MODEL_PLANNER=true is set:
npx wrangler secret put AGENTIC_MODEL_PLANNER  # enter: true

# Enqueue a goal via the API:
curl -X POST "$WORKER_URL/api/goals" \
  -H "content-type: application/json" \
  -H "x-agentic-access-key: $KEY" \
  -d '{"request": "Send a test notification"}' | jq .

# Wait for cron tick to process it:
npx wrangler tail
```

**Metrics to capture:**
- Decision acceptance rate
- Edit distance from deterministic fallback
- Policy compliance (no capability escalation)
- Token usage and cost per planning call
- P95 model call latency

**Evidence to capture:** Eval suite output; `/api/worker/tick` response showing model-backed plan execution; token usage logs.

**Close criteria met when:** Eval metrics meet defined thresholds (to be documented in the issue), and at least one goal completes via model-backed planning on Workers.

---

## Phase 6: AOS Remediation Issues (#142–#152)

These issues require a live deployment with secrets management. Validation depends on the Cloudflare deployment being operational.

### 6.1 #142 — GitHub App Sync Configuration

| Check | Method | Expected |
|-------|--------|----------|
| GitHub App installed | GitHub org settings → Apps | App present with correct permissions |
| Credentials provisioned | `wrangler secret put` for App private key + ID | Secrets stored |
| Sync URL configured | Repository variable `AGENTIC_GITHUB_APP_ISSUE_SYNC_URL` | Points to deployed endpoint |
| Preflight passes | `npx tsx scripts/github-app-sync-live-preflight.ts` | All checks green |
| Manual sync works | Trigger sync workflow | Issues created/updated correctly |

### 6.2 #143–#152 — AOS Production Proof

These issues cover the broader AOS cognitive-core activation (Tiers 1–3). They require:
- Live deployment with all connectors configured
- Provider credentials for AI model access
- End-to-end goal execution through the durable queue

Validation is sequential: Tier 1 (basic goal execution) → Tier 2 (connector integration) → Tier 3 (model-backed planning graduation).

---

## Phase 7: Evidence Bundle & Issue Closure

After all validations pass:

1. **Collect evidence** from each phase above into a single document or issue comment.
2. **Update each issue** with a validation comment linking to the evidence.
3. **Close sub-issues** (#979, #981, #982, #984, #985) individually.
4. **Close the epic** (#986) last, after all sub-issues are closed.
5. **Update the remediation plan** to reflect closed status.

### Evidence Template

```markdown
## Validation Evidence — [Issue #] — [Date]

**Deployment:** `https://<worker-domain>.workers.dev`
**Worker version:** <version-id>
**Wrangler version:** <version>

### Checks

| Check | Result | Evidence |
|-------|--------|----------|
| [check name] | PASS/FAIL | [link to log/output] |

### Logs

<details>
<summary>wrangler tail (post-deploy boot)</summary>

```
[paste relevant log lines]
```

</details>

### Sign-off

- [ ] Operator: <name>
- [ ] Date: <date>
- [ ] Rollback tested: yes/no
```

---

## Troubleshooting

### Secrets not reaching `process.env`

**Symptom:** Auth requests fail with 401 despite correct key.

**Diagnosis:** In local preview, `.dev.vars` secrets did not populate `process.env`. On a real deploy, `wrangler secret put` values should be available. If not:

1. Move the value to `vars` in `wrangler.jsonc` (non-secret config only).
2. Or add a request-init shim that copies `getCloudflareContext().env` into `process.env`.

Note: `AGENTIC_WORKER_TICK_TOKEN` is read from the binding directly in `worker.ts` (unaffected). The tick *route* validates `AGENTIC_MACHINE_TOKENS_JSON` via `process.env`.

### Hyperdrive connection failures

**Symptom:** `/api/ready/details` shows `database` check as `fail`.

**Diagnosis:**
1. Verify Hyperdrive config: `npx wrangler hyperdrive list`
2. Confirm the binding ID in `wrangler.jsonc` matches
3. Check that the Postgres host is reachable from Cloudflare's network (not private IP, not localhost)
4. Verify migrations are applied: `npm run db:status -- --require-ready`

### Cron trigger not firing

**Symptom:** No `[cron] worker tick` logs in `wrangler tail`.

**Diagnosis:**
1. Check deploy output for trigger registration
2. Cloudflare dashboard → Workers → your worker → Triggers
3. Minimum cron granularity is 1 minute; `*/5 * * * *` should fire within 5 minutes
4. Verify `AGENTIC_WORKER_TICK_TOKEN` is set as a secret

### Cloudflare 1102 (CPU budget exceeded)

**Symptom:** Authenticated routes return 1102 under load or cold start.

**Resolution:**
- Switch to Workers Paid
- Add `"limits": { "cpu_ms": 30000 }` to `wrangler.jsonc`
- Do not set this on Workers Free (rejected with API error `100328`)

### Bundle size exceeds limit

**Symptom:** `npm run cf:check-size` fails.

**Diagnosis:**
1. Ensure Webpack build is used (not Turbopack): `npm run cf:build` runs `next build --webpack`
2. Check for accidental large imports in the worker bundle
3. Target: ~2.4 MiB gzipped (under 3 MiB free, 10 MiB paid)

---

## Quick Reference

| Secret / Var | Source | Purpose |
|---|---|---|
| `AGENTIC_PUBLIC_BASE_URL` | Secret | Deployed origin for OAuth, share links |
| `AGENTIC_ACCESS_KEY` | Secret | User authentication |
| `AGENTIC_BOOTSTRAP_USER_ID` | Secret | Initial admin user |
| `AGENTIC_BOOTSTRAP_DISPLAY_NAME` | Secret | Initial admin display name |
| `AGENTIC_SHARED_AUTH_STATE` | Secret (`true`) | Shared auth mode |
| `AGENTIC_REQUIRE_SHARED_AUTH_STATE` | Secret (`true`) | Require shared auth |
| `AGENTIC_WORKER_TICK_TOKEN` | Secret | Raw cron tick token |
| `AGENTIC_MACHINE_TOKENS_JSON` | Secret | Machine token registry (hashed) |
| `AGENTIC_TRUST_PROXY_HEADERS` | Var (`true`) | Committed in wrangler.jsonc |
| `AGENTIC_TRUSTED_CLIENT_IP_HEADER` | Var (`cf-connecting-ip`) | Committed in wrangler.jsonc |
| `AGENTIC_MODEL_PLANNER` | Secret (`true`) | Enable model-backed planner (#1006) |

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/health` | None | Liveness probe |
| `GET /api/ready` | None | Readiness summary |
| `GET /api/ready/details` | Access key | Detailed readiness checks |
| `POST /api/worker/tick` | Machine token | Durable job drain + watcher pass |
| `POST /api/goals` | Access key | Enqueue a goal |
