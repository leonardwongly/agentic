import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_OWNER_USER_ID, createSystemActorContext } from "@agentic/contracts";
import { vi } from "vitest";
import * as authModule from "../apps/web/lib/auth";
import { AGENTIC_ACCESS_KEY_HEADER, AGENTIC_SESSION_COOKIE, buildSessionToken } from "../apps/web/lib/auth";
import {
  resetAuthSessionStateStoreForTesting,
  setAuthSessionStateStoreForTesting,
  type AuthSessionStateStore
} from "../apps/web/lib/auth-session-store";
import { createRouteTestRepository, expectNoStoreHeaders } from "./route-test-helpers";

const { enqueuePrivacyOperationJobMock } = vi.hoisted(() => ({
  enqueuePrivacyOperationJobMock: vi.fn(async () => ({
    id: "job-privacy-queued"
  }))
}));

vi.mock("@agentic/worker-runtime", () => ({
  enqueuePrivacyOperationJob: enqueuePrivacyOperationJobMock
}));

import { GET as governancePrivacyGetRoute, POST as governancePrivacyPostRoute } from "../apps/web/app/api/governance/privacy/route";

function buildAuthorizedGetRequest(url: string) {
  return new Request(url, {
    method: "GET",
    headers: {
      [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
    }
  });
}

function buildAuthorizedPostRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${AGENTIC_SESSION_COOKIE}=${buildSessionToken(DEFAULT_OWNER_USER_ID)}`
    },
    body: JSON.stringify(body)
  });
}

function buildBootstrapPostRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
    },
    body: JSON.stringify(body)
  });
}

describe("governance privacy route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-governance-privacy-route-")),
      "runtime-store.json"
    );
    enqueuePrivacyOperationJobMock.mockClear();
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
    resetAuthSessionStateStoreForTesting();
  });

  it("queues a new retention-enforcement operation with owner-scoped governance defaults", async () => {
    const repository = createRouteTestRepository();
    const actor = createSystemActorContext(DEFAULT_OWNER_USER_ID);

    await repository.seedDefaults();
    const dashboard = await repository.getDashboardData();
    await repository.saveWorkspaceGovernance(
      {
        ...dashboard.workspaceGovernance!,
        retentionDays: 45,
        updatedAt: "2026-04-17T00:00:00.000Z"
      },
      actor
    );

    const response = await governancePrivacyPostRoute(
      buildAuthorizedPostRequest("http://localhost/api/governance/privacy", {
        kind: "retention_enforcement"
      })
    );
    const payload = (await response.json()) as {
      operation: {
        id: string;
        jobId: string | null;
        kind: string;
        details: {
          retentionDays?: number;
        };
        status: string;
      };
      reused: boolean;
    };
    const operations = await repository.listPrivacyOperations({
      userId: DEFAULT_OWNER_USER_ID,
      workspaceId: dashboard.activeWorkspace!.id
    });

    expect(response.status).toBe(202);
    expect(payload.reused).toBe(false);
    expect(payload.operation).toMatchObject({
      kind: "retention_enforcement",
      jobId: "job-privacy-queued",
      status: "queued",
      details: {
        retentionDays: 45
      }
    });
    expect(operations).toHaveLength(1);
    expect(enqueuePrivacyOperationJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: expect.objectContaining({
          id: payload.operation.id,
          workspaceId: dashboard.activeWorkspace!.id,
          userId: DEFAULT_OWNER_USER_ID,
          kind: "retention_enforcement"
        })
      })
    );
    expectNoStoreHeaders(response);
  });

  it("returns the privacy control summary for the active owner workspace", async () => {
    const repository = createRouteTestRepository();

    await repository.seedDefaults();

    const response = await governancePrivacyGetRoute(buildAuthorizedGetRequest("http://localhost/api/governance/privacy"));
    const payload = (await response.json()) as {
      controls: {
        registryVersion: number;
        totalDatasets: number;
        classifications: Array<{
          id: string;
          datasetCount: number;
        }>;
        lifecycleOperations: string[];
      };
      operations: unknown[];
      dashboard: unknown;
    };

    expect(response.status).toBe(200);
    expect(payload.controls).toEqual(
      expect.objectContaining({
        registryVersion: 1,
        totalDatasets: 6,
        lifecycleOperations: ["retention_enforcement", "workspace_export", "workspace_delete"]
      })
    );
    expect(payload.controls.classifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "workspace_operational",
          datasetCount: 4
        })
      ])
    );
    expect(payload.operations).toEqual([]);
    expect(payload.dashboard).toEqual(expect.any(Object));
    expectNoStoreHeaders(response);
  });

  it("reuses an existing queued privacy operation instead of enqueueing another job", async () => {
    const repository = createRouteTestRepository();

    await repository.seedDefaults();
    const dashboard = await repository.getDashboardData();
    await repository.savePrivacyOperation({
      id: "privacy-existing-export",
      workspaceId: dashboard.activeWorkspace!.id,
      userId: DEFAULT_OWNER_USER_ID,
      kind: "workspace_export",
      status: "queued",
      requestedBy: DEFAULT_OWNER_USER_ID,
      actorContext: createSystemActorContext(DEFAULT_OWNER_USER_ID),
      jobId: "job-existing-export",
      details: {},
      result: {},
      startedAt: null,
      completedAt: null,
      error: null,
      createdAt: "2026-04-17T00:00:00.000Z",
      updatedAt: "2026-04-17T00:00:00.000Z"
    });

    const response = await governancePrivacyPostRoute(
      buildAuthorizedPostRequest("http://localhost/api/governance/privacy", {
        kind: "workspace_export"
      })
    );
    const payload = (await response.json()) as {
      operation: {
        id: string;
      };
      reused: boolean;
    };

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      operation: expect.objectContaining({
        id: "privacy-existing-export"
      }),
      reused: true,
      dashboard: expect.any(Object)
    });
    expect(enqueuePrivacyOperationJobMock).not.toHaveBeenCalled();
    expectNoStoreHeaders(response);
  });

  it("rejects workspace deletion without the typed confirmation phrase", async () => {
    const repository = createRouteTestRepository();

    await repository.seedDefaults();
    Reflect.set(globalThis, "__agenticRepository", repository);

    const response = await governancePrivacyPostRoute(
      buildAuthorizedPostRequest("http://localhost/api/governance/privacy", {
        kind: "workspace_delete"
      })
    );
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Workspace deletion requires typing "delete workspace" before it can be queued.');
    expect(enqueuePrivacyOperationJobMock).not.toHaveBeenCalled();
    expectNoStoreHeaders(response);
  });

  it("queues workspace deletion only after valid typed confirmation and records audit metadata", async () => {
    const repository = createRouteTestRepository();

    await repository.seedDefaults();
    Reflect.set(globalThis, "__agenticRepository", repository);

    const response = await governancePrivacyPostRoute(
      buildAuthorizedPostRequest("http://localhost/api/governance/privacy", {
        kind: "workspace_delete",
        confirmation: {
          phrase: "  delete workspace  "
        }
      })
    );
    const payload = (await response.json()) as {
      operation: {
        kind: string;
        details: {
          confirmation?: {
            method?: string;
            challenge?: string;
            confirmedAt?: string;
          };
        };
      };
      reused: boolean;
    };

    expect(response.status).toBe(202);
    expect(payload.reused).toBe(false);
    expect(payload.operation.kind).toBe("workspace_delete");
    expect(payload.operation.details.confirmation).toMatchObject({
      method: "typed_phrase",
      challenge: "delete workspace"
    });
    expect(payload.operation.details.confirmation?.confirmedAt).toEqual(expect.any(String));
    expect(enqueuePrivacyOperationJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: expect.objectContaining({
          kind: "workspace_delete"
        })
      })
    );
    expectNoStoreHeaders(response);
  });

  it("rejects privacy operations when the active workspace belongs to another owner", async () => {
    const repository = createRouteTestRepository();
    const ownerActor = createSystemActorContext("workspace-owner");
    const requireApiSessionSpy = vi.spyOn(authModule, "requireApiSession").mockResolvedValue({
      authMethod: "session",
      userId: "workspace-collaborator",
      sessionId: "session-collaborator",
      expiresAt: null
    });
    const requireApiPrincipalSpy = vi.spyOn(authModule, "requireApiPrincipal").mockResolvedValue({
      kind: "session",
      authMethod: "session",
      userId: "workspace-collaborator",
      sessionId: "session-collaborator",
      expiresAt: null
    });

    await repository.seedDefaults("workspace-owner");
    await repository.seedDefaults("workspace-collaborator");
    await repository.saveWorkspace(
      {
        id: "workspace-shared-collab",
        ownerUserId: "workspace-owner",
        slug: "shared-collab",
        name: "Shared Collaboration",
        description: "Owner-only privacy controls should reject collaborators.",
        isPersonal: false,
        createdAt: "2026-04-17T00:00:00.000Z",
        updatedAt: "2026-04-17T00:00:00.000Z"
      },
      ownerActor
    );
    await repository.saveWorkspaceMember(
      {
        id: "workspace-member-shared-collab-owner",
        workspaceId: "workspace-shared-collab",
        userId: "workspace-owner",
        role: "owner",
        joinedAt: "2026-04-17T00:00:00.000Z",
        updatedAt: "2026-04-17T00:00:00.000Z"
      },
      ownerActor
    );
    await repository.saveWorkspaceMember(
      {
        id: "workspace-member-shared-collab-collab",
        workspaceId: "workspace-shared-collab",
        userId: "workspace-collaborator",
        role: "editor",
        joinedAt: "2026-04-17T00:00:00.000Z",
        updatedAt: "2026-04-17T00:00:00.000Z"
      },
      ownerActor
    );
    await repository.saveWorkspaceSelection({
      userId: "workspace-collaborator",
      workspaceId: "workspace-shared-collab",
      selectedAt: "2026-04-17T00:00:00.000Z",
      updatedAt: "2026-04-17T00:00:00.000Z"
    });

    try {
      const getResponse = await governancePrivacyGetRoute(buildAuthorizedGetRequest("http://localhost/api/governance/privacy"));
      const postResponse = await governancePrivacyPostRoute(
        buildAuthorizedPostRequest("http://localhost/api/governance/privacy", {
          kind: "workspace_delete"
        })
      );
      const getPayload = (await getResponse.json()) as { error?: string };
      const postPayload = (await postResponse.json()) as { error?: string };

      expect(getResponse.status).toBe(403);
      expect(postResponse.status).toBe(403);
      expect(getPayload.error).toBe("Only the workspace owner can manage privacy operations.");
      expect(postPayload.error).toBe("Only the workspace owner can manage privacy operations.");
      expect(enqueuePrivacyOperationJobMock).not.toHaveBeenCalled();
      expectNoStoreHeaders(getResponse);
      expectNoStoreHeaders(postResponse);
    } finally {
      requireApiSessionSpy.mockRestore();
      requireApiPrincipalSpy.mockRestore();
    }
  });

  it("rate limits privacy operation queueing with a route-scoped abuse key", async () => {
    const repository = createRouteTestRepository();
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

    await repository.seedDefaults();
    setAuthSessionStateStoreForTesting(store);

    const response = await governancePrivacyPostRoute(
      new Request("http://localhost/api/governance/privacy", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${AGENTIC_SESSION_COOKIE}=${buildSessionToken(DEFAULT_OWNER_USER_ID)}`,
          "user-agent": "Agentic Privacy Rate Limit Test",
          "accept-language": "en-SG"
        },
        body: JSON.stringify({
          kind: "workspace_export"
        })
      })
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(429);
    expect(payload.error).toBe("Too many privacy operation requests. Try again later.");
    expect(response.headers.get("retry-after")).toBe("30");
    expect(seenKeys).toHaveLength(1);
    expect(seenKeys[0]).toContain("privacy-operation:user:");
    expect(seenKeys[0]).toContain(":fp:/api/governance/privacy:");
    expect(enqueuePrivacyOperationJobMock).not.toHaveBeenCalled();
  });

  it("rejects bootstrap access-key automation for privacy operations", async () => {
    const repository = createRouteTestRepository();

    await repository.seedDefaults();

    const response = await governancePrivacyPostRoute(
      buildBootstrapPostRequest("http://localhost/api/governance/privacy", {
        kind: "workspace_export"
      })
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(401);
    expect(payload.error).toBe("Bootstrap access key is not allowed for this API route.");
    expect(enqueuePrivacyOperationJobMock).not.toHaveBeenCalled();
    expectNoStoreHeaders(response);
  });
});
