import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID, createSystemActorContext } from "@agentic/contracts";
import { createRepository } from "@agentic/repository";
import { vi } from "vitest";
import * as authModule from "../apps/web/lib/auth";
import { GET as governanceGetRoute, POST as governancePostRoute } from "../apps/web/app/api/governance/route";
import { buildAuthorizedGetRequest, buildAuthorizedJsonRequest, expectNoStoreHeaders } from "./route-test-helpers";

function buildGovernanceUpdateRequest(body: unknown, ifMatch?: string): Request {
  return new Request("http://localhost/api/governance", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agentic-access-key": "test-access-key",
      ...(ifMatch ? { "if-match": `"${ifMatch}"` } : {})
    },
    body: JSON.stringify(body)
  });
}

describe("governance route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-governance-route-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  it("returns governance with conformance status and canned policy simulations", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const actor = createSystemActorContext(SYSTEM_USER_ID);

    await repository.seedDefaults();
    const dashboard = await repository.getDashboardData();
    await repository.saveWorkspaceGovernance(
      {
        ...dashboard.workspaceGovernance!,
        approvalMode: "risk_based",
        requireAuditExports: true,
        externalSendRequiresApproval: true,
        calendarWriteRequiresApproval: true,
        maxAutoRunRiskClass: "R2",
        updatedAt: "2026-04-18T00:00:00.000Z"
      },
      actor
    );

    const response = await governanceGetRoute(buildAuthorizedGetRequest("http://localhost/api/governance"));
    const payload = (await response.json()) as {
      governance: {
        requireAuditExports: boolean;
        maxAutoRunRiskClass: string;
      };
      autonomyBudget: {
        governanceCeilingRiskClass: string;
        requiresExplicitApprovalCapabilities: string[];
        r3AutonomyEligible: boolean;
      };
      conformance: {
        status: string;
      };
      simulations: Array<{
        id: string;
        result: {
          decision: {
            outcome: string;
            requiresApproval: boolean;
          };
        };
      }>;
      dashboard: {
        activeWorkspace: { id: string };
        governanceConformance: {
          status: string;
        } | null;
      };
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"2026-04-18T00:00:00.000Z"');
    expect(payload.governance).toMatchObject({
      requireAuditExports: true,
      maxAutoRunRiskClass: "R2"
    });
    expect(payload.autonomyBudget).toMatchObject({
      governanceCeilingRiskClass: "R2",
      requiresExplicitApprovalCapabilities: ["send", "schedule"],
      r3AutonomyEligible: false
    });
    expect(payload.conformance).toMatchObject({
      status: "conformant"
    });
    expect(payload.dashboard.governanceConformance).toMatchObject({
      status: "conformant"
    });
    expect(payload.simulations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "low-risk-read",
          result: expect.objectContaining({
            decision: expect.objectContaining({
              outcome: "allowed",
              requiresApproval: false
            })
          })
        }),
        expect.objectContaining({
          id: "external-send",
          result: expect.objectContaining({
            decision: expect.objectContaining({
              outcome: "allowed_with_confirmation",
              requiresApproval: true
            })
          })
        })
      ])
    );
    expect(payload.dashboard.activeWorkspace.id).toBe(dashboard.activeWorkspace!.id);
    expectNoStoreHeaders(response);
  });

  it("persists governance updates and returns a recomputed simulation payload", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults();
    const dashboard = await repository.getDashboardData();
    const currentGovernance = dashboard.workspaceGovernance!;

    const response = await governancePostRoute(
      buildGovernanceUpdateRequest(
        {
          approvalMode: "risk_based",
          requireAuditExports: true,
          publicSharingEnabled: false,
          providerAccessRequiresApproval: true,
          escalationRequiresApproval: true,
          externalSendRequiresApproval: true,
          calendarWriteRequiresApproval: true,
          maxAutoRunRiskClass: "R2",
          shadowReplayPolicy: {
            enabled: false,
            promotionMode: "shadow_only",
            rollbackOutcome: "downgrade_to_draft",
            minimumMatchedEpisodes: 5
          },
          retentionDays: 90
        },
        currentGovernance.updatedAt
      )
    );
    const payload = (await response.json()) as {
      governance: {
        workspaceId: string;
        updatedAt: string;
        requireAuditExports: boolean;
        publicSharingEnabled: boolean;
        providerAccessRequiresApproval: boolean;
        escalationRequiresApproval: boolean;
        retentionDays: number;
        shadowReplayPolicy: {
          enabled: boolean;
          promotionMode: string;
          rollbackOutcome: string;
          minimumMatchedEpisodes: number;
          minimumPrecision: number;
        };
      };
      autonomyBudget: {
        governanceCeilingRiskClass: string;
        r3AutonomyEligible: boolean;
        shadowReplay: {
          enabled: boolean;
          required: boolean;
        };
      };
      conformance: {
        status: string;
      };
      simulations: Array<{
        id: string;
        result: {
          decision: {
            outcome: string;
          };
        };
      }>;
      dashboard: {
        governanceConformance: {
          status: string;
        } | null;
      };
    };
    const persisted = await repository.getWorkspaceGovernance(dashboard.activeWorkspace!.id, SYSTEM_USER_ID);

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe(`"${payload.governance.updatedAt}"`);
    expect(payload.governance).toMatchObject({
      workspaceId: dashboard.activeWorkspace!.id,
      requireAuditExports: true,
      publicSharingEnabled: false,
      providerAccessRequiresApproval: true,
      escalationRequiresApproval: true,
      retentionDays: 90,
      shadowReplayPolicy: {
        enabled: false,
        promotionMode: "shadow_only",
        rollbackOutcome: "downgrade_to_draft",
        minimumMatchedEpisodes: 5,
        minimumPrecision: 0.8
      }
    });
    expect(payload.autonomyBudget).toMatchObject({
      governanceCeilingRiskClass: "R2",
      r3AutonomyEligible: false,
      shadowReplay: {
        enabled: false,
        required: false,
        promotionMode: "shadow_only",
        rollbackOutcome: "downgrade_to_draft"
      }
    });
    expect(payload.conformance).toMatchObject({
      status: "conformant"
    });
    expect(payload.dashboard.governanceConformance).toMatchObject({
      status: "conformant"
    });
    expect(payload.simulations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "calendar-write",
          result: expect.objectContaining({
            decision: expect.objectContaining({
              outcome: "allowed_with_confirmation"
            })
          })
        })
      ])
    );
    expect(persisted).toMatchObject({
      workspaceId: dashboard.activeWorkspace!.id,
      requireAuditExports: true,
      retentionDays: 90,
      shadowReplayPolicy: {
        enabled: false,
        promotionMode: "shadow_only",
        rollbackOutcome: "downgrade_to_draft",
        minimumMatchedEpisodes: 5,
        minimumPrecision: 0.8
      }
    });
    expectNoStoreHeaders(response);
  });

  it("rejects governance updates without a concrete If-Match precondition", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults();

    const response = await governancePostRoute(
      buildAuthorizedJsonRequest("http://localhost/api/governance", {
        requireAuditExports: true
      })
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(428);
    expect(payload.error).toContain("If-Match");
    expectNoStoreHeaders(response);
  });

  it("rejects stale governance writes when the If-Match token is outdated", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults();
    const dashboard = await repository.getDashboardData();
    const currentGovernance = dashboard.workspaceGovernance!;

    const response = await governancePostRoute(
      buildGovernanceUpdateRequest(
        {
          requireAuditExports: true
        },
        "2026-01-01T00:00:00.000Z"
      )
    );
    const payload = (await response.json()) as { error?: string };
    const persisted = await repository.getWorkspaceGovernance(dashboard.activeWorkspace!.id, SYSTEM_USER_ID);

    expect(response.status).toBe(412);
    expect(payload.error).toContain("record changed");
    expect(persisted?.updatedAt).toBe(currentGovernance.updatedAt);
    expectNoStoreHeaders(response);
  });

  it("returns 403 when a collaborator tries to update governance on a shared workspace", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const ownerUserId = "workspace-owner";
    const collaboratorUserId = "workspace-editor";
    const ownerActor = createSystemActorContext(ownerUserId);
    const requireApiSessionSpy = vi.spyOn(authModule, "requireApiSession").mockResolvedValue({
      authMethod: "session",
      userId: collaboratorUserId,
      sessionId: "session-workspace-editor",
      expiresAt: null
    });

    try {
      await repository.seedDefaults(ownerUserId);
      await repository.seedDefaults(collaboratorUserId);
      await repository.saveWorkspace(
        {
          id: "workspace-governance-shared",
          ownerUserId,
          slug: "governance-shared",
          name: "Governance Shared Workspace",
          description: "Collaborators can review but must not update governance.",
          isPersonal: false,
          createdAt: "2026-04-18T00:00:00.000Z",
          updatedAt: "2026-04-18T00:00:00.000Z"
        },
        ownerActor
      );
      await repository.saveWorkspaceMember(
        {
          id: "workspace-governance-shared-owner",
          workspaceId: "workspace-governance-shared",
          userId: ownerUserId,
          role: "owner",
          joinedAt: "2026-04-18T00:00:00.000Z",
          updatedAt: "2026-04-18T00:00:00.000Z"
        },
        ownerActor
      );
      await repository.saveWorkspaceMember(
        {
          id: "workspace-governance-shared-editor",
          workspaceId: "workspace-governance-shared",
          userId: collaboratorUserId,
          role: "editor",
          joinedAt: "2026-04-18T00:00:00.000Z",
          updatedAt: "2026-04-18T00:00:00.000Z"
        },
        ownerActor
      );
      await repository.saveWorkspaceSelection({
        userId: collaboratorUserId,
        workspaceId: "workspace-governance-shared",
        selectedAt: "2026-04-18T00:00:00.000Z",
        updatedAt: "2026-04-18T00:00:00.000Z"
      });

      const response = await governancePostRoute(
        buildAuthorizedJsonRequest("http://localhost/api/governance", {
          requireAuditExports: true
        })
      );
      const payload = (await response.json()) as { error?: string };

      expect(response.status).toBe(403);
      expect(payload.error).toBe("Only the workspace owner can update governance.");
      expectNoStoreHeaders(response);
    } finally {
      requireApiSessionSpy.mockRestore();
    }
  });
});
