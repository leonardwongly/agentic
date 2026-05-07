import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ProviderCredentialSchema,
  ProviderCredentialSecretRecordSchema,
  SYSTEM_USER_ID,
  createSystemActorContext,
  nowIso
} from "@agentic/contracts";
import { createJobRecord } from "@agentic/execution";
import { createProviderCredentialSecretStore } from "@agentic/integrations";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as recoveryRoute } from "../apps/web/app/api/operations/recovery/route";
import { buildAuthorizedJsonRequest, createRouteTestRepository, expectNoStoreHeaders } from "./route-test-helpers";

describe("operations recovery route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalProviderSecretKey = process.env.AGENTIC_PROVIDER_SECRET_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_PROVIDER_SECRET_KEY = "test-provider-secret-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-operations-recovery-route-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_PROVIDER_SECRET_KEY = originalProviderSecretKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  it("releases an expired worker lease back to the retry queue", async () => {
    const repository = createRouteTestRepository();
    await repository.seedDefaults(SYSTEM_USER_ID);
    const queued = createJobRecord({
      userId: SYSTEM_USER_ID,
      kind: "docs_render",
      payload: {
        type: "docs_render",
        metadata: {}
      },
      availableAt: "2026-05-06T00:00:00.000Z"
    });
    await repository.enqueueJob({
      ...queued,
      status: "running",
      attemptCount: 1,
      claimedBy: "worker-expired",
      claimedAt: "2026-05-06T00:00:00.000Z",
      lastAttemptAt: "2026-05-06T00:00:00.000Z",
      leaseExpiresAt: "2026-05-06T00:00:01.000Z",
      updatedAt: "2026-05-06T00:00:00.000Z"
    });

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await recoveryRoute(
      buildAuthorizedJsonRequest("http://localhost/api/operations/recovery", {
        action: "release_expired_lease",
        jobId: queued.id
      })
    );
    const payload = (await response.json()) as {
      recovery: { action: string; job: { status: string; leaseExpiresAt: string | null; claimedBy: string | null } };
    };

    expect(response.status).toBe(200);
    expectNoStoreHeaders(response);
    expect(payload.recovery.action).toBe("release_expired_lease");
    expect(payload.recovery.job.status).toBe("retrying");
    expect(payload.recovery.job.leaseExpiresAt).toBeNull();
    expect(payload.recovery.job.claimedBy).toBeNull();
  });

  it("cancels a queued job with an audit journal entry", async () => {
    const repository = createRouteTestRepository();
    await repository.seedDefaults(SYSTEM_USER_ID);
    const queued = await repository.enqueueJob(
      createJobRecord({
        userId: SYSTEM_USER_ID,
        kind: "docs_render",
        payload: {
          type: "docs_render",
          metadata: {}
        },
        availableAt: nowIso()
      })
    );

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await recoveryRoute(
      buildAuthorizedJsonRequest("http://localhost/api/operations/recovery", {
        action: "cancel_job",
        jobId: queued.id,
        confirm: true,
        reason: "Operator cancelled duplicate render."
      })
    );
    const payload = (await response.json()) as {
      recovery: { action: string; job: { status: string; lastError: string; journal: { entries: Array<{ metadata: Record<string, unknown> }> } } };
    };

    expect(response.status).toBe(200);
    expect(payload.recovery.action).toBe("cancel_job");
    expect(payload.recovery.job.status).toBe("dead_letter");
    expect(payload.recovery.job.lastError).toBe("Operator cancelled duplicate render.");
    expect(payload.recovery.job.journal.entries.at(-1)?.metadata).toMatchObject({
      recoveryAction: "cancel_job"
    });
  });

  it("does not recover another user's queued job", async () => {
    const repository = createRouteTestRepository();
    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.seedDefaults("other-user");
    const queued = await repository.enqueueJob(
      createJobRecord({
        userId: "other-user",
        kind: "docs_render",
        payload: {
          type: "docs_render",
          metadata: {}
        },
        availableAt: nowIso()
      })
    );

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await recoveryRoute(
      buildAuthorizedJsonRequest("http://localhost/api/operations/recovery", {
        action: "cancel_job",
        jobId: queued.id,
        confirm: true
      })
    );
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(payload.error).toBe(`Job ${queued.id} was not found.`);
  });

  it("revalidates connector credentials without returning stored secrets", async () => {
    const repository = createRouteTestRepository();
    await repository.seedDefaults(SYSTEM_USER_ID);
    const actor = createSystemActorContext(SYSTEM_USER_ID);
    const credential = await repository.saveProviderCredential(
      ProviderCredentialSchema.parse({
        id: "google:global:operations-recovery",
        userId: SYSTEM_USER_ID,
        workspaceId: null,
        provider: "google",
        accountId: "operations-recovery",
        accountEmail: "ops@example.com",
        displayName: "Ops Test",
        status: "refresh_failed",
        scopes: ["https://www.googleapis.com/auth/gmail.modify"],
        lastValidatedAt: "2026-05-01T00:00:00.000Z",
        lastRefreshFailureAt: "2026-05-02T00:00:00.000Z",
        metadata: {},
        actorContext: actor,
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z"
      })
    );
    await repository.saveProviderCredentialSecret(
      ProviderCredentialSecretRecordSchema.parse({
        credentialId: credential.id,
        userId: SYSTEM_USER_ID,
        kind: "oauth_refresh_token",
        secret: createProviderCredentialSecretStore().encrypt("super-secret-refresh-token"),
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
    );

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await recoveryRoute(
      buildAuthorizedJsonRequest("http://localhost/api/operations/recovery", {
        action: "revalidate_connector_credential",
        credentialId: credential.id
      })
    );
    const raw = await response.text();
    const payload = JSON.parse(raw) as {
      recovery: { action: string; credential: { status: string; lastRefreshFailureAt: string | null } };
    };

    expect(response.status).toBe(200);
    expect(payload.recovery.action).toBe("revalidate_connector_credential");
    expect(payload.recovery.credential.status).toBe("connected");
    expect(payload.recovery.credential.lastRefreshFailureAt).toBeNull();
    expect(raw).not.toContain("super-secret-refresh-token");
    expect(raw).not.toContain("ciphertext");
  });
});
