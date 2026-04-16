import { z } from "zod";
import { processUserRequest, captureMemoriesFromBundle } from "@agentic/orchestrator";
import { requireApiSession } from "../../../lib/auth";
import { createActorContextFromPrincipal } from "../../../lib/actor-context";
import { authenticatedJson, handleApiError, parseJsonBody } from "../../../lib/api-response";
import { requireJsonContentType } from "../../../lib/api-errors";
import { getSeededRepository, getSeededSelfImprovementRepository } from "../../../lib/server";

const GoalRequestSchema = z
  .object({
    request: z.string().trim().min(1).max(2_000),
    agentId: z.string().optional()
  })
  .strict();

async function resolveActiveWorkspaceContext(userId: string) {
  const repository = await getSeededRepository();
  const dashboard = await repository.getDashboardData(userId);
  const workspaceId = dashboard.activeWorkspace?.id ?? null;

  return {
    repository,
    workspaceId,
    workspaceGovernance: workspaceId
      ? dashboard.workspaceGovernance ?? await repository.getWorkspaceGovernance(workspaceId, userId)
      : null
  };
}

export async function GET(request: Request) {
  try {
    const principal = await requireApiSession(request);
    const repository = await getSeededRepository();

    return authenticatedJson({
      dashboard: await repository.getDashboardData(principal.userId)
    });
  } catch (error) {
    return handleApiError(error, "Failed to load goals dashboard.");
  }
}

export async function POST(request: Request) {
  try {
    requireJsonContentType(request);
    const principal = await requireApiSession(request);
    const actorContext = createActorContextFromPrincipal(principal);
    const body = await parseJsonBody(request, GoalRequestSchema);
    const { repository, workspaceId, workspaceGovernance } = await resolveActiveWorkspaceContext(principal.userId);
    const [memories, integrations] = await Promise.all([
      repository.listMemory(principal.userId),
      repository.listIntegrations(principal.userId)
    ]);
    
    // Fetch agent definition if agentId is provided
    let agentDefinition = undefined;
    if (body.agentId) {
      try {
        const agent = await repository.getAgent(body.agentId, principal.userId);
        agentDefinition = agent ?? undefined; // Convert null to undefined
      } catch {
        console.warn(`[goals] Agent ${body.agentId} not found, proceeding without override`);
      }
    }
    
    const bundle = await processUserRequest({
      userId: principal.userId,
      request: body.request,
      workspaceId,
      governance: workspaceGovernance,
      memories,
      integrations,
      agentDefinition,
      resolveAgentMetrics: (agentIdOrName) => repository.getAgentMetrics(agentIdOrName, "all", principal.userId)
    });

    await repository.saveGoalBundle(bundle);

    if (bundle.goal.status === "completed") {
      try {
        const captured = captureMemoriesFromBundle(bundle, principal.userId, actorContext);
        const selfImprovement = await getSeededSelfImprovementRepository();

        await Promise.all([
          ...captured.memories.map((memory) => repository.saveMemory(memory)),
          ...captured.episodes.map((episode) => selfImprovement.appendEpisode(episode))
        ]);

        console.log(
          `[auto-capture] Goal "${bundle.goal.id}" completed — persisted ${captured.memories.length} memory record(s) and ${captured.episodes.length} episode(s).`
        );
      } catch (captureError) {
        console.error("[auto-capture] Failed to persist captured memories after goal creation:", captureError);
      }
    }

    return authenticatedJson({
      bundle,
      dashboard: await repository.getDashboardData(principal.userId)
    });
  } catch (error) {
    return handleApiError(error, "Failed to create goal.");
  }
}
