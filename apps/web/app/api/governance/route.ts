import { z } from "zod";
import { WorkspaceGovernanceSchema, WorkspaceShadowReplayPolicySchema } from "@agentic/contracts";
import { resolveWorkspaceGovernanceDefaultsFromEnv } from "@agentic/repository";
import {
  assessWorkspaceGovernanceConformance,
  buildAutonomyBudget,
  buildGovernanceSimulationScenarios,
  simulateGovernanceScenarios
} from "@agentic/policy";
import { requireApiSession } from "../../../lib/auth";
import { ApiRouteError, authenticatedJson, handleApiError } from "../../../lib/api-response";
import { createGovernedMutationRoute } from "../../../lib/governed-route";
import { buildUpdatedAtETag, requireUpdatedAtPrecondition } from "../../../lib/mutation-preconditions";
import { getSeededGovernanceRouteRepository } from "../../../lib/server";

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
  const repository = await getSeededGovernanceRouteRepository();
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

function buildDefaultWorkspaceGovernance(activeWorkspace: { id: string; createdAt: string; updatedAt: string }, userId: string) {
  return WorkspaceGovernanceSchema.parse({
    workspaceId: activeWorkspace.id,
    ...resolveWorkspaceGovernanceDefaultsFromEnv(),
    updatedBy: userId,
    createdAt: activeWorkspace.createdAt,
    updatedAt: activeWorkspace.updatedAt
  });
}

function governanceResponse(governance: z.infer<typeof WorkspaceGovernanceSchema>, dashboard: unknown) {
  return authenticatedJson(buildGovernanceResponse(governance, dashboard), {
    headers: {
      ETag: buildUpdatedAtETag(governance.updatedAt)
    }
  });
}

export async function GET(request: Request) {
  try {
    const principal = await requireApiSession(request);
    const { repository, dashboard, activeWorkspace } = await resolveWorkspaceContext(principal.userId);
    const governance =
      dashboard.workspaceGovernance ??
      (await repository.getWorkspaceGovernance(activeWorkspace.id, principal.userId)) ??
      buildDefaultWorkspaceGovernance(activeWorkspace, principal.userId);

    return governanceResponse(governance, dashboard);
  } catch (error) {
    return handleApiError(error, "Failed to load workspace governance.");
  }
}

export const POST = createGovernedMutationRoute(
  {
    route: "api.governance.update",
    fallbackError: "Failed to update workspace governance.",
    bodySchema: GovernanceUpdateSchema,
    rateLimit: {
      namespace: "governance-update",
      error: "Too many governance update requests. Try again later."
    },
    idempotency: "optional"
  },
  async ({ request, principal, actorContext, body }) => {
    const { repository, activeWorkspace } = await resolveWorkspaceContext(principal.userId);
    assertOwnerCanEditGovernance(activeWorkspace, principal.userId);
    const current =
      (await repository.getWorkspaceGovernance(activeWorkspace.id, principal.userId)) ??
      buildDefaultWorkspaceGovernance(activeWorkspace, principal.userId);

    requireUpdatedAtPrecondition(request, current.updatedAt);

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

    await repository.saveWorkspaceGovernance(updated, actorContext);

    return governanceResponse(updated, await repository.getDashboardData(principal.userId));
  }
);
