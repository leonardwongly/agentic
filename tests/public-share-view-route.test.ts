import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID } from "@agentic/contracts";
import { buildDefaultIntegrationAccounts } from "@agentic/integrations";
import { processUserRequest } from "@agentic/orchestrator";
import { createRepository, type AgenticRepository } from "@agentic/repository";
import { executePublicShareViewJob } from "@agentic/worker-runtime";
import { vi } from "vitest";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import {
  resetAuthSessionStateStoreForTesting,
  setAuthSessionStateStoreForTesting,
  type AuthSessionStateStore
} from "../apps/web/lib/auth-session-store";
import { POST as goalShareRoute } from "../apps/web/app/api/goals/[id]/share/route";
import { POST as publicShareViewRoute } from "../apps/web/app/api/share/view/route";
import { expectOperationalNoStoreHeaders } from "./route-test-helpers";

async function createGoalForUser(
  repository: AgenticRepository,
  userId: string,
  request: string
) {
  const bundle = await processUserRequest({
    userId,
    request,
    memories: await repository.listMemory(userId),
    integrations: buildDefaultIntegrationAccounts(userId)
  });

  await repository.saveGoalBundle(bundle);
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
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(SYSTEM_USER_ID);
    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Share my planning context with a reviewer.");
    const shareResponse = await goalShareRoute(
      new Request(`http://localhost/api/goals/${bundle.goal.id}/share`, {
        method: "POST",
        headers: {
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        }
      }),
      {
        params: Promise.resolve({ id: bundle.goal.id })
      }
    );
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
    };
    const secondPayload = (await secondResponse.json()) as {
      accepted: boolean;
      tracked: boolean;
      queued?: boolean;
      jobId?: string;
    };
    const reloadedRepository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
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
      jobId: expect.any(String)
    });
    expect(secondResponse.status).toBe(202);
    expect(secondPayload).toEqual({
      accepted: true,
      tracked: true,
      queued: true,
      jobId: firstPayload.jobId
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
});
