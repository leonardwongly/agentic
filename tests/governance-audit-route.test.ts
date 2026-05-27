import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_OWNER_USER_ID, createSystemActorContext } from "@agentic/contracts";
import { vi } from "vitest";
import {
  resetAuthSessionStateStoreForTesting,
  setAuthSessionStateStoreForTesting,
  type AuthSessionStateStore
} from "../apps/web/lib/auth-session-store";
import * as authModule from "../apps/web/lib/auth";
import { GET as governanceAuditRouteGet } from "../apps/web/app/api/governance/audit/route";
import { buildAuthorizedGetRequest, createRouteTestRepository, expectNoStoreHeaders } from "./route-test-helpers";

type AuditExportPayload = {
  workspace: { id: string };
  governance?: {
    approvalMode?: string;
    requireAuditExports?: boolean;
    externalSendRequiresApproval?: boolean;
  } | null;
  members: Array<{ userId: string }>;
  privacyOperations: Array<{ id: string }>;
  integrity: {
    version: string;
    algorithm: string;
    canonicalization: string;
    digest: string;
    recordCounts: {
      members: number;
      goalShares: number;
      privacyOperations: number;
      goals: number;
    };
  };
};

function expectAuditIntegrity(payload: AuditExportPayload) {
  const { integrity, ...signedPayload } = payload;
  const digest = createHash("sha256").update(JSON.stringify(signedPayload)).digest("hex");

  expect(integrity).toEqual({
    version: "agentic-workspace-audit-integrity-v1",
    algorithm: "sha256",
    canonicalization: "json-stringify-v1",
    digest,
    recordCounts: {
      members: payload.members.length,
      goalShares: expect.any(Number),
      privacyOperations: payload.privacyOperations.length,
      goals: expect.any(Number)
    }
  });
}

describe("governance audit route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-governance-audit-route-")),
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

  it("exports the active workspace with tamper-evident integrity metadata and excludes other tenants", async () => {
    const repository = createRouteTestRepository();
    const otherUserId = "tenant-b";
    const otherActor = createSystemActorContext(otherUserId);

    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    await repository.seedDefaults(otherUserId);

    const dashboard = await repository.getDashboardData(DEFAULT_OWNER_USER_ID);
    const otherDashboard = await repository.getDashboardData(otherUserId);

    await repository.savePrivacyOperation({
      id: "tenant-b-export",
      workspaceId: otherDashboard.activeWorkspace!.id,
      userId: otherUserId,
      kind: "workspace_export",
      status: "completed",
      requestedBy: otherUserId,
      actorContext: otherActor,
      jobId: null,
      details: {},
      result: {
        fileName: "tenant-b-audit.json"
      },
      startedAt: "2026-04-18T00:00:00.000Z",
      completedAt: "2026-04-18T00:05:00.000Z",
      error: null,
      createdAt: "2026-04-18T00:00:00.000Z",
      updatedAt: "2026-04-18T00:05:00.000Z"
    });

    const response = await governanceAuditRouteGet(buildAuthorizedGetRequest("http://localhost/api/governance/audit"));
    const payload = (await response.json()) as AuditExportPayload;

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain(dashboard.activeWorkspace!.slug);
    expect(response.headers.get("x-agentic-audit-digest")).toBe(payload.integrity.digest);
    expect(response.headers.get("x-agentic-governance-mode")).toBe(payload.governance?.approvalMode ?? null);
    expect(response.headers.get("x-agentic-governance-conformance")).toBe("conformant");
    expectNoStoreHeaders(response);
    expect(payload.workspace.id).toBe(dashboard.activeWorkspace!.id);
    expect(payload.privacyOperations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "tenant-b-export"
        })
      ])
    );
    expectAuditIntegrity(payload);
  });

  it("rate limits audit exports with a route-scoped abuse key", async () => {
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

    const response = await governanceAuditRouteGet(buildAuthorizedGetRequest("http://localhost/api/governance/audit"));
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(payload).toEqual({
      error: "Too many audit export requests. Try again later."
    });
    expect(seenKeys).toHaveLength(1);
    expect(seenKeys[0]).toContain("governance-audit:user:");
    expect(seenKeys[0]).toContain(":fp:/api/governance/audit:");
  });

  it("limits collaborators to the selected shared workspace and excludes the owner's personal workspace data", async () => {
    const repository = createRouteTestRepository();
    const ownerUserId = "workspace-owner";
    const collaboratorUserId = "workspace-collaborator";
    const ownerActor = createSystemActorContext(ownerUserId);
    const requireApiSessionSpy = vi.spyOn(authModule, "requireApiSession").mockResolvedValue({
      authMethod: "session",
      userId: collaboratorUserId,
      sessionId: "session-collaborator",
      expiresAt: null
    });

    try {
      await repository.seedDefaults(ownerUserId);
      await repository.seedDefaults(collaboratorUserId);

      const ownerDashboard = await repository.getDashboardData(ownerUserId);

      await repository.saveWorkspace(
        {
          id: "workspace-shared-audit",
          ownerUserId,
          slug: "shared-audit",
          name: "Shared Audit Workspace",
          description: "Collaborators should only export the selected shared tenant.",
          isPersonal: false,
          createdAt: "2026-04-18T00:00:00.000Z",
          updatedAt: "2026-04-18T00:00:00.000Z"
        },
        ownerActor
      );
      await repository.saveWorkspaceMember(
        {
          id: "workspace-member-shared-audit-owner",
          workspaceId: "workspace-shared-audit",
          userId: ownerUserId,
          role: "owner",
          joinedAt: "2026-04-18T00:00:00.000Z",
          updatedAt: "2026-04-18T00:00:00.000Z"
        },
        ownerActor
      );
      await repository.saveWorkspaceMember(
        {
          id: "workspace-member-shared-audit-collaborator",
          workspaceId: "workspace-shared-audit",
          userId: collaboratorUserId,
          role: "editor",
          joinedAt: "2026-04-18T00:00:00.000Z",
          updatedAt: "2026-04-18T00:00:00.000Z"
        },
        ownerActor
      );
      await repository.saveWorkspaceSelection({
        userId: collaboratorUserId,
        workspaceId: "workspace-shared-audit",
        selectedAt: "2026-04-18T00:00:00.000Z",
        updatedAt: "2026-04-18T00:00:00.000Z"
      });
      await repository.savePrivacyOperation({
        id: "owner-personal-export",
        workspaceId: ownerDashboard.activeWorkspace!.id,
        userId: ownerUserId,
        kind: "workspace_export",
        status: "completed",
        requestedBy: ownerUserId,
        actorContext: ownerActor,
        jobId: null,
        details: {},
        result: {
          fileName: "owner-personal-audit.json"
        },
        startedAt: "2026-04-18T00:00:00.000Z",
        completedAt: "2026-04-18T00:05:00.000Z",
        error: null,
        createdAt: "2026-04-18T00:00:00.000Z",
        updatedAt: "2026-04-18T00:05:00.000Z"
      });

      const response = await governanceAuditRouteGet(buildAuthorizedGetRequest("http://localhost/api/governance/audit"));
      const payload = (await response.json()) as AuditExportPayload;

      expect(response.status).toBe(200);
      expectNoStoreHeaders(response);
      expect(payload.workspace.id).toBe("workspace-shared-audit");
      expect(payload.members).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ userId: ownerUserId }),
          expect.objectContaining({ userId: collaboratorUserId })
        ])
      );
      expect(payload.privacyOperations).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "owner-personal-export"
          })
        ])
      );
      expectAuditIntegrity(payload);
    } finally {
      requireApiSessionSpy.mockRestore();
    }
  });
});
