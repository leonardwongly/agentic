import { z } from "zod";
import { SYSTEM_USER_ID } from "@agentic/contracts";
import { processUserRequest, captureMemoriesFromBundle } from "@agentic/orchestrator";
import { requireApiSession } from "../../../lib/auth";
import { authenticatedJson, handleApiError, parseJsonBody } from "../../../lib/api-response";
import { getSeededRepository, getSeededSelfImprovementRepository } from "../../../lib/server";

const GoalRequestSchema = z
  .object({
    request: z.string().trim().min(1).max(2_000),
    agentId: z.string().optional()
  })
  .strict();

export async function POST(request: Request) {
  try {
    requireJsonContentType(request);
    await requireApiSession(request);
    const body = await parseJsonBody(request, GoalRequestSchema);
    const repository = await getSeededRepository();
    const [memories, integrations] = await Promise.all([
      repository.listMemory(SYSTEM_USER_ID),
      repository.listIntegrations(SYSTEM_USER_ID)
    ]);
    
    // Fetch agent definition if agentId is provided
    let agentDefinition = undefined;
    if (body.agentId) {
      try {
        const agent = await repository.getAgent(body.agentId);
        agentDefinition = agent ?? undefined; // Convert null to undefined
      } catch {
        console.warn(`[goals] Agent ${body.agentId} not found, proceeding without override`);
      }
    }
    
    const bundle = await processUserRequest({
      userId: SYSTEM_USER_ID,
      request: body.request,
      memories,
      integrations,
      agentDefinition
    });

    await repository.saveGoalBundle(bundle);

    if (bundle.goal.status === "completed") {
      try {
        const captured = captureMemoriesFromBundle(bundle, SYSTEM_USER_ID);
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
      dashboard: await repository.getDashboardData(SYSTEM_USER_ID)
    });
  } catch (error) {
    return handleApiError(error, "Failed to create goal.");
  }
}
