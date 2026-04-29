import { z } from "zod";
import { WorkspaceGovernanceSchema, WorkspaceShadowReplayPolicySchema, enterpriseWorkspaceGovernanceDefaults } from "@agentic/contracts";
import {
  assessWorkspaceGovernanceConformance,
  buildAutonomyBudget,
  buildGovernanceSimulationScenarios,
  simulateGovernanceScenarios
} from "@agentic/policy";
import { requireApiSession } from "../../../lib/auth";
import { createActorContextFromPrincipal } from "../../../lib/actor-context";
import { ApiRouteError, authenticatedJson, handleApiError, parseJsonBody } from "../../../lib/api-response";
import { requireJsonContentType } from "../../../lib/api-errors";
import { getSeededRepository } from "../../../lib/server";

const GovernanceUpdateSchema = z
  .object({
    approvalMode: WorkspaceGovernanceSchema.shape.approvalMode.optional(),
    requireAuditExports: z.boolean().optional(),
    maxAutoRunRiskClass: WorkspaceGovernanceSchema.shape.maxAutoRunRiskClass.optional(),
    publicSharingEnabled: z.boolean().optional(),
    providerAccessRequiresApproval: z.boolean().optional(),
    escalationRequiresApproval: z.boolean().optional(),
    externalSendRequiresApproval: z.boolean().optional(),
    calendarWriteRequiresApproval: z.boolean().optional(),
    shadowReplayPolicy: WorkspaceShadowReplayPolicySchema.partial().strict().optional(),
    retentionDays: WorkspaceGovernanceSchema.shape.retentionDays.optional()
  })
  .strict();

async function resolveWorkspaceContext(userId: string) {
  const repository = await getSeededRepository();
  const dashboard = await repository.getDashboardData(userId);
  const activeWorkspace = dashboard.activeWorkspace;

  if (!activeWorkspace) {
    throw new ApiRouteError(404, "No active workspace is selected.");
  }

  return { repository, dashboard, activeWorkspace };
}

function assertOwnerCanEditGovernance(activeWorkspace: { ownerUserId: string }, userId: string) {
  if (activeWorkspace.ownerUserId !== userId) {
    throw new ApiRouteError(403, "Only the workspace owner can update governance.");
  }
}

function buildGovernanceResponse(governance: z.infer<typeof WorkspaceGovernanceSchema> | null, dashboard: unknown) {
  return {
    governance,
    autonomyBudget: buildAutonomyBudget(governance),
    conformance: assessWorkspaceGovernanceConformance(governance),
    simulations: simulateGovernanceScenarios({
      governance,
      scenarios: buildGovernanceSimulationScenarios()
    }),
    dashboard
  };
}

export async function GET(request: Request) {
  try {
    const principal = await requireApiSession(request);
    const { repository, dashboard, activeWorkspace } = await resolveWorkspaceContext(principal.userId);
    const governance = dashboard.workspaceGovernance ?? (await repository.getWorkspaceGovernance(activeWorkspace.id, principal.userId));

    return authenticatedJson(buildGovernanceResponse(governance, dashboard));
  } catch (error) {
    return handleApiError(error, "Failed to load workspace governance.");
  }
}

export async function POST(request: Request) {
  try {
    requireJsonContentType(request);
    const principal = await requireApiSession(request);
    const actor = createActorContextFromPrincipal(principal);
    const { repository, activeWorkspace } = await resolveWorkspaceContext(principal.userId);
    assertOwnerCanEditGovernance(activeWorkspace, principal.userId);
    const body = await parseJsonBody(request, GovernanceUpdateSchema);
    const current =
      (await repository.getWorkspaceGovernance(activeWorkspace.id, principal.userId)) ??
      WorkspaceGovernanceSchema.parse({
        workspaceId: activeWorkspace.id,
        ...enterpriseWorkspaceGovernanceDefaults,
        updatedBy: principal.userId,
        createdAt: activeWorkspace.createdAt,
        updatedAt: activeWorkspace.updatedAt
      });

    const updated = WorkspaceGovernanceSchema.parse({
      ...current,
      ...body,
      shadowReplayPolicy: {
        ...current.shadowReplayPolicy,
        ...(body.shadowReplayPolicy ?? {})
      },
      updatedBy: principal.userId,
      updatedAt: new Date().toISOString()
    });

    await repository.saveWorkspaceGovernance(updated, actor);

    return authenticatedJson(buildGovernanceResponse(updated, await repository.getDashboardData(principal.userId)));
  } catch (error) {
    return handleApiError(error, "Failed to update workspace governance.");
  }
}
