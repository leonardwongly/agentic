import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID, createSystemActorContext } from "@agentic/contracts";
import { createRepository } from "@agentic/repository";
import { GET as governanceGetRoute, POST as governancePostRoute } from "../apps/web/app/api/governance/route";
import { buildAuthorizedGetRequest, buildAuthorizedJsonRequest, expectNoStoreHeaders } from "./route-test-helpers";

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
      };
    };

    expect(response.status).toBe(200);
    expect(payload.governance).toMatchObject({
      requireAuditExports: true,
      maxAutoRunRiskClass: "R2"
    });
    expect(payload.conformance).toMatchObject({
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

    const response = await governancePostRoute(
      buildAuthorizedJsonRequest("http://localhost/api/governance", {
        requireAuditExports: true,
        externalSendRequiresApproval: true,
        calendarWriteRequiresApproval: true,
        maxAutoRunRiskClass: "R2",
        retentionDays: 90
      })
    );
    const payload = (await response.json()) as {
      governance: {
        workspaceId: string;
        requireAuditExports: boolean;
        retentionDays: number;
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
    };
    const persisted = await repository.getWorkspaceGovernance(dashboard.activeWorkspace!.id, SYSTEM_USER_ID);

    expect(response.status).toBe(200);
    expect(payload.governance).toMatchObject({
      workspaceId: dashboard.activeWorkspace!.id,
      requireAuditExports: true,
      retentionDays: 90
    });
    expect(payload.conformance).toMatchObject({
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
      retentionDays: 90
    });
    expectNoStoreHeaders(response);
  });
});
