import { z } from "zod";
import { WorkspaceGovernanceSchema } from "@agentic/contracts";
import {
  assessWorkspaceGovernanceConformance,
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
    externalSendRequiresApproval: z.boolean().optional(),
    calendarWriteRequiresApproval: z.boolean().optional(),
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

function buildGovernanceResponse(governance: z.infer<typeof WorkspaceGovernanceSchema> | null, dashboard: unknown) {
  return {
    governance,
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
    const body = await parseJsonBody(request, GovernanceUpdateSchema);
    const current =
      (await repository.getWorkspaceGovernance(activeWorkspace.id, principal.userId)) ??
      WorkspaceGovernanceSchema.parse({
        workspaceId: activeWorkspace.id,
        approvalMode: "risk_based",
        requireAuditExports: false,
        maxAutoRunRiskClass: "R1",
        externalSendRequiresApproval: true,
        calendarWriteRequiresApproval: true,
        retentionDays: 365,
        updatedBy: principal.userId,
        createdAt: activeWorkspace.createdAt,
        updatedAt: activeWorkspace.updatedAt
      });

    const updated = WorkspaceGovernanceSchema.parse({
      ...current,
      ...body,
      updatedBy: principal.userId,
      updatedAt: new Date().toISOString()
    });

    await repository.saveWorkspaceGovernance(updated, actor);

    return authenticatedJson(buildGovernanceResponse(updated, await repository.getDashboardData(principal.userId)));
  } catch (error) {
    return handleApiError(error, "Failed to update workspace governance.");
  }
}
