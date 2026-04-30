import { z } from "zod";
import {
  CapabilitySchema,
  WorkspaceGovernanceSchema,
  WorkspaceShadowReplayPolicySchema
} from "@agentic/contracts";
import {
  assessWorkspaceGovernanceConformance,
  buildAutonomyBudget,
  buildGovernanceSimulationScenarios,
  simulateGovernanceScenarios
} from "@agentic/policy";
import { resolveWorkspaceGovernanceDefaultsFromEnv } from "@agentic/repository";
import { checkAbuseRateLimit } from "../../../../lib/abuse-rate-limit";
import { requireApiSession } from "../../../../lib/auth";
import {
  ApiRouteError,
  authenticatedJson,
  authenticatedRateLimitError,
  handleApiError,
  parseJsonBody
} from "../../../../lib/api-response";
import { requireJsonContentType } from "../../../../lib/api-errors";
import { getSeededRepository } from "../../../../lib/server";

const GovernanceScenarioSchema = z
  .object({
    id: z.string().min(1).max(100).optional(),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(500).optional(),
    capabilities: z.array(CapabilitySchema).min(1).max(10),
    confidence: z.number().min(0).max(1)
  })
  .strict();

const GovernanceSimulationRequestSchema = z
  .object({
    governance: z
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
      .strict()
      .optional(),
    scenarios: z.array(GovernanceScenarioSchema).min(1).max(12).optional()
  })
  .strict();

async function resolveWorkspaceContext(userId: string) {
  const repository = await getSeededRepository();
  const dashboard = await repository.getDashboardData(userId);
  const activeWorkspace = dashboard.activeWorkspace;

  if (!activeWorkspace) {
    throw new ApiRouteError(404, "No active workspace is selected.");
  }

  const currentGovernance =
    dashboard.workspaceGovernance ??
    (await repository.getWorkspaceGovernance(activeWorkspace.id, userId)) ??
    WorkspaceGovernanceSchema.parse({
      workspaceId: activeWorkspace.id,
      ...resolveWorkspaceGovernanceDefaultsFromEnv(),
      updatedBy: userId,
      createdAt: activeWorkspace.createdAt,
      updatedAt: activeWorkspace.updatedAt
    });

  return { dashboard, activeWorkspace, currentGovernance };
}

export async function POST(request: Request) {
  try {
    requireJsonContentType(request);
    const principal = await requireApiSession(request);
    const rateLimit = await checkAbuseRateLimit({
      request,
      principal,
      namespace: "governance-simulate"
    });

    if (!rateLimit.allowed) {
      return authenticatedRateLimitError(
        "Too many governance simulation requests. Try again later.",
        rateLimit.retryAfterSeconds
      );
    }

    const body = await parseJsonBody(request, GovernanceSimulationRequestSchema);
    const { dashboard, currentGovernance } = await resolveWorkspaceContext(principal.userId);
    const effectiveGovernance = WorkspaceGovernanceSchema.parse({
      ...currentGovernance,
      ...body.governance,
      shadowReplayPolicy: {
        ...currentGovernance.shadowReplayPolicy,
        ...(body.governance?.shadowReplayPolicy ?? {})
      },
      updatedBy: currentGovernance.updatedBy,
      updatedAt: currentGovernance.updatedAt
    });

    const scenarios =
      body.scenarios?.map((scenario, index) => ({
        id: scenario.id ?? `custom-${index + 1}`,
        title: scenario.title,
        description: scenario.description ?? "",
        capabilities: scenario.capabilities,
        confidence: scenario.confidence
      })) ?? buildGovernanceSimulationScenarios();

    return authenticatedJson({
      governance: effectiveGovernance,
      autonomyBudget: buildAutonomyBudget(effectiveGovernance),
      conformance: assessWorkspaceGovernanceConformance(effectiveGovernance),
      simulations: simulateGovernanceScenarios({
        governance: effectiveGovernance,
        scenarios
      }),
      dashboard
    });
  } catch (error) {
    return handleApiError(error, "Failed to simulate workspace governance.");
  }
}
