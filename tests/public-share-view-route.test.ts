import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID, createSystemActorContext } from "@agentic/contracts";
import { buildDefaultIntegrationAccounts } from "@agentic/integrations";
import { processUserRequest } from "@agentic/orchestrator";
import type { AgenticRepository } from "@agentic/repository";
import { executePublicShareViewJob } from "@agentic/worker-runtime";
import { vi } from "vitest";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import { buildSharedGoalView, createGoalShareToken } from "../apps/web/lib/share";
import {
  buildGoalShareDisclosureReview,
  buildGoalShareDisclosureReviewFingerprint
} from "../apps/web/lib/share-disclosure";
import {
  resetAuthSessionStateStoreForTesting,
  setAuthSessionStateStoreForTesting,
  type AuthSessionStateStore
} from "../apps/web/lib/auth-session-store";
import { POST as goalShareRoute } from "../apps/web/app/api/goals/[id]/share/route";
import { POST as publicShareViewRoute } from "../apps/web/app/api/share/view/route";
import {
  buildInvalidJsonRequest,
  createRouteTestRepository,
  expectOperationalNoStoreHeaders
} from "./route-test-helpers";

async function createGoalForUser(
  repository: AgenticRepository,
  userId: string,
  request: string
) {
  const workspaceId = (await repository.getDashboardData(userId)).activeWorkspace?.id ?? null;
  const bundle = await processUserRequest({
    userId,
    request,
    workspaceId,
    memories: await repository.listMemory(userId),
    integrations: buildDefaultIntegrationAccounts(userId)
  });

  await repository.saveGoalBundle(bundle);
  const governance = workspaceId ? await repository.getWorkspaceGovernance(workspaceId, userId) : null;

  if (governance) {
    await repository.saveWorkspaceGovernance(
      {
        ...governance,
        publicSharingEnabled: true,
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      },
      createSystemActorContext(userId)
    );
  }

  return bundle;
}

function buildPublicShareViewRequest(
  body: unknown,
  headers?: Record<string, string>
): Request {
  return new Request("http://localhost/api/share/view", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });
}

function buildReviewFingerprint(bundle: Awaited<ReturnType<typeof createGoalForUser>>) {
  const disclosureReview = buildGoalShareDisclosureReview(bundle, {
    expiresAt: "2026-05-07T00:00:00.000Z",
    expiryDays: 7
  });

  return buildGoalShareDisclosureReviewFingerprint({
    publicProjection: buildSharedGoalView(bundle),
    disclosureReview
  });
}

function buildConfirmedShareRequest(goalId: string, reviewFingerprint: string): Request {
  return new Request(`http://localhost/api/goals/${goalId}/share`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
    },
    body: JSON.stringify({
      confirmed: true,
      reviewFingerprint
    })
  });
}

describe("public share view route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-public-share-view-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
    resetAuthSessionStateStoreForTesting();
  });

  it("queues share tracking and keeps repeated refreshes idempotent before the worker persists state", async () => {
    const repository = createRouteTestRepository();

    await repository.seedDefaults(SYSTEM_USER_ID);
    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Share my planning context with a reviewer.");
    const shareResponse = await goalShareRoute(buildConfirmedShareRequest(bundle.goal.id, buildReviewFingerprint(bundle)), {
      params: Promise.resolve({ id: bundle.goal.id })
    });
    const sharePayload = (await shareResponse.json()) as {
      shareId: string;
      shareUrl: string;
    };
    const token = decodeURIComponent(sharePayload.shareUrl.split("/share/")[1] ?? "");

    const firstResponse = await publicShareViewRoute(
      buildPublicShareViewRequest(
        { token },
        {
          "user-agent": "Agentic Public Share Test",
          "accept-language": "en-SG"
        }
      )
    );
    const secondResponse = await publicShareViewRoute(
      buildPublicShareViewRequest(
        { token },
        {
          "user-agent": "Agentic Public Share Test",
          "accept-language": "en-SG"
        }
      )
    );
    const firstPayload = (await firstResponse.json()) as {
      accepted: boolean;
      tracked: boolean;
      queued?: boolean;
      jobId?: string;
      statusUrl?: string;
    };
    const secondPayload = (await secondResponse.json()) as {
      accepted: boolean;
      tracked: boolean;
      queued?: boolean;
      jobId?: string;
      statusUrl?: string;
    };
    const reloadedRepository = createRouteTestRepository();
    const queuedJobs = await reloadedRepository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["public_share_view"]
    });
    const shareBeforeExecution = await reloadedRepository.getGoalShare(sharePayload.shareId, SYSTEM_USER_ID);
    const bundleBeforeExecution = await reloadedRepository.getGoalBundle(bundle.goal.id);

    expect(firstResponse.status).toBe(202);
    expect(firstPayload).toEqual({
      accepted: true,
      tracked: true,
      queued: true,
      jobId: expect.any(String),
      statusUrl: expect.stringMatching(/^\/api\/jobs\/.+/u)
    });
    expect(secondResponse.status).toBe(202);
    expect(secondPayload).toEqual({
      accepted: true,
      tracked: true,
      queued: true,
      jobId: firstPayload.jobId,
      statusUrl: firstPayload.statusUrl
    });
    expect(queuedJobs).toHaveLength(1);
    expect(queuedJobs[0]?.id).toBe(firstPayload.jobId);
    expect(shareBeforeExecution?.lastViewedAt).toBeNull();
    expect(bundleBeforeExecution?.actionLogs.filter((log) => log.kind === "share.page_viewed") ?? []).toHaveLength(0);

    await executePublicShareViewJob({
      repository: reloadedRepository,
      job: queuedJobs[0]!
    });
    await executePublicShareViewJob({
      repository: reloadedRepository,
      job: queuedJobs[0]!
    });

    const viewedShare = await reloadedRepository.getGoalShare(sharePayload.shareId, SYSTEM_USER_ID);
    const reloadedBundle = await reloadedRepository.getGoalBundle(bundle.goal.id);
    const viewedLogs = reloadedBundle?.actionLogs.filter((log) => log.kind === "share.page_viewed") ?? [];

    expect(viewedShare?.lastViewedAt).not.toBeNull();
    expect(viewedLogs[0]?.details.shareId).toBe(sharePayload.shareId);
    expect(viewedLogs[0]?.details.tokenFingerprint).toMatch(/^[0-9a-f]{12}$/);
    expect(viewedLogs).toHaveLength(1);
    expectOperationalNoStoreHeaders(firstResponse);
    expectOperationalNoStoreHeaders(secondResponse);
  });

  it("returns an accepted no-op for invalid share tokens without leaking state", async () => {
    const response = await publicShareViewRoute(
      buildPublicShareViewRequest(
        { token: "invalid-token" },
        {
          "user-agent": "Agentic Invalid Share Test"
        }
      )
    );
    const payload = (await response.json()) as {
      accepted: boolean;
      tracked: boolean;
    };

    expect(response.status).toBe(202);
    expect(payload).toEqual({
      accepted: true,
      tracked: false
    });
    expectOperationalNoStoreHeaders(response);
  });

  it("short-circuits expired signed tokens before repository lookup", async () => {
    const token = createGoalShareToken("share-expired-short-circuit", "goal-expired-short-circuit", "2020-01-01T00:00:00.000Z");
    process.env.AGENTIC_RUNTIME_STORE_PATH = await mkdtemp(path.join(os.tmpdir(), "agentic-expired-share-store-dir-"));
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await publicShareViewRoute(
      buildPublicShareViewRequest(
        { token },
        {
          "user-agent": "Agentic Expired Share Test"
        }
      )
    );
    const payload = (await response.json()) as {
      accepted: boolean;
      tracked: boolean;
    };

    expect(response.status).toBe(202);
    expect(payload).toEqual({
      accepted: true,
      tracked: false
    });
    expectOperationalNoStoreHeaders(response);
  });

  it("returns accepted no-ops for revoked and expired signed share tracking without queueing jobs", async () => {
    const repository = createRouteTestRepository();

    await repository.seedDefaults(SYSTEM_USER_ID);
    const revokedBundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Share a context that will be revoked.");
    const expiredBundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Share a context that will expire.");

    const revokedShareResponse = await goalShareRoute(buildConfirmedShareRequest(revokedBundle.goal.id, buildReviewFingerprint(revokedBundle)), {
      params: Promise.resolve({ id: revokedBundle.goal.id })
    });
    const expiredShareResponse = await goalShareRoute(buildConfirmedShareRequest(expiredBundle.goal.id, buildReviewFingerprint(expiredBundle)), {
      params: Promise.resolve({ id: expiredBundle.goal.id })
    });
    const revokedPayload = (await revokedShareResponse.json()) as { shareId: string; shareUrl: string };
    const expiredPayload = (await expiredShareResponse.json()) as { shareId: string; shareUrl: string };
    const revokedToken = decodeURIComponent(revokedPayload.shareUrl.split("/share/")[1] ?? "");
    const expiredToken = decodeURIComponent(expiredPayload.shareUrl.split("/share/")[1] ?? "");
    const revokedShare = await repository.getGoalShare(revokedPayload.shareId, SYSTEM_USER_ID);
    const expiredShare = await repository.getGoalShare(expiredPayload.shareId, SYSTEM_USER_ID);

    await repository.saveGoalShare({
      ...revokedShare!,
      status: "revoked",
      revokedAt: "2026-04-16T00:00:00.000Z",
      updatedAt: "2026-04-16T00:00:00.000Z"
    });
    await repository.saveGoalShare({
      ...expiredShare!,
      expiresAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2026-04-16T00:00:00.000Z"
    });

    const revokedResponse = await publicShareViewRoute(buildPublicShareViewRequest({ token: revokedToken }));
    const expiredResponse = await publicShareViewRoute(buildPublicShareViewRequest({ token: expiredToken }));
    const revokedResult = (await revokedResponse.json()) as { accepted: boolean; tracked: boolean };
    const expiredResult = (await expiredResponse.json()) as { accepted: boolean; tracked: boolean };
    const reloadedRepository = createRouteTestRepository();
    const queuedJobs = await reloadedRepository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["public_share_view"]
    });
    const reloadedRevokedBundle = await reloadedRepository.getGoalBundle(revokedBundle.goal.id);
    const reloadedExpiredBundle = await reloadedRepository.getGoalBundle(expiredBundle.goal.id);

    expect(revokedResponse.status).toBe(202);
    expect(expiredResponse.status).toBe(202);
    expect(revokedResult).toEqual({ accepted: true, tracked: false });
    expect(expiredResult).toEqual({ accepted: true, tracked: false });
    expect(queuedJobs).toHaveLength(0);
    expect(reloadedRevokedBundle?.actionLogs.filter((log) => log.kind.startsWith("share."))).toHaveLength(1);
    expect(reloadedExpiredBundle?.actionLogs.filter((log) => log.kind.startsWith("share."))).toHaveLength(1);
    expect(JSON.stringify(reloadedRevokedBundle?.actionLogs ?? [])).not.toContain(revokedToken);
    expect(JSON.stringify(reloadedExpiredBundle?.actionLogs ?? [])).not.toContain(expiredToken);
    expectOperationalNoStoreHeaders(revokedResponse);
    expectOperationalNoStoreHeaders(expiredResponse);
  });

  it("rejects malformed JSON with a sanitized validation error", async () => {
    const response = await publicShareViewRoute(
      buildInvalidJsonRequest("http://localhost/api/share/view")
    );
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      error: "Request body must be valid JSON."
    });
    expectOperationalNoStoreHeaders(response);
  });

  it("short-circuits oversized anonymous payloads before parsing the body", async () => {
    const response = await publicShareViewRoute(
      buildPublicShareViewRequest(
        { token: "ignored" },
        {
          "content-length": "9000",
          "user-agent": "Agentic Oversized Share Test"
        }
      )
    );
    const payload = (await response.json()) as {
      accepted: boolean;
      tracked: boolean;
    };

    expect(response.status).toBe(202);
    expect(payload).toEqual({
      accepted: true,
      tracked: false
    });
    expectOperationalNoStoreHeaders(response);
  });

  it("rate limits public share tracking with a namespaced client key", async () => {
    const seenKeys: string[] = [];
    const store: AuthSessionStateStore = {
      scope: "shared",
      async checkRateLimit(key) {
        seenKeys.push(key);
        return {
          allowed: false,
          retryAfterMs: 30_000
        };
      },
      async clearRateLimit() {},
      async revokeSession() {},
      async isSessionRevoked() {
        return false;
      },
      async reset() {}
    };

    setAuthSessionStateStoreForTesting(store);

    const response = await publicShareViewRoute(
      buildPublicShareViewRequest(
        { token: "share-token" },
        {
          "user-agent": "Agentic Rate Limit Test",
          "accept-language": "en-SG"
        }
      )
    );
    const payload = (await response.json()) as {
      accepted: boolean;
      tracked: boolean;
    };

    expect(response.status).toBe(202);
    expect(payload).toEqual({
      accepted: true,
      tracked: false
    });
    expect(response.headers.get("retry-after")).toBe("30");
    expect(seenKeys).toHaveLength(1);
    expect(seenKeys[0]).toMatch(/^public-share-view:fp:\/api\/share\/view:[0-9a-f]{24}$/);
    expectOperationalNoStoreHeaders(response);
  });

  it("rate limits repeated access to the same shared token before repository lookup", async () => {
    const seenKeys: string[] = [];
    const store: AuthSessionStateStore = {
      scope: "shared",
      async checkRateLimit(key) {
        seenKeys.push(key);
        if (key.startsWith("public-share-view:token:")) {
          return {
            allowed: false,
            retryAfterMs: 45_000
          };
        }

        return {
          allowed: true,
          retryAfterMs: 0
        };
      },
      async clearRateLimit() {},
      async revokeSession() {},
      async isSessionRevoked() {
        return false;
      },
      async reset() {}
    };

    setAuthSessionStateStoreForTesting(store);

    const repository = createRouteTestRepository();

    await repository.seedDefaults(SYSTEM_USER_ID);
    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Share a goal with a reviewer.");
    const shareResponse = await goalShareRoute(buildConfirmedShareRequest(bundle.goal.id, buildReviewFingerprint(bundle)), {
      params: Promise.resolve({ id: bundle.goal.id })
    });
    const sharePayload = (await shareResponse.json()) as {
      shareId: string;
      shareUrl: string;
    };
    const token = decodeURIComponent(sharePayload.shareUrl.split("/share/")[1] ?? "");
    seenKeys.length = 0;

    const response = await publicShareViewRoute(
      buildPublicShareViewRequest(
        { token },
        {
          "user-agent": "Agentic Share Token Flood Test",
          "accept-language": "en-SG"
        }
      )
    );
    const payload = (await response.json()) as {
      accepted: boolean;
      tracked: boolean;
    };
    const reloadedRepository = createRouteTestRepository();
    const queuedJobs = await reloadedRepository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["public_share_view"]
    });

    expect(response.status).toBe(202);
    expect(payload).toEqual({
      accepted: true,
      tracked: false
    });
    expect(response.headers.get("retry-after")).toBe("45");
    expect(seenKeys).toHaveLength(2);
    expect(seenKeys[0]).toMatch(/^public-share-view:fp:\/api\/share\/view:[0-9a-f]{24}$/);
    expect(seenKeys[1]).toMatch(/^public-share-view:token:[0-9a-f]{12}$/);
    expect(queuedJobs).toHaveLength(0);
    expectOperationalNoStoreHeaders(response);
  });
});
