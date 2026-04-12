import { z } from "zod";
import { BriefingTypeSchema } from "@agentic/contracts";
import { captureMemoriesFromBundle, generateBriefing } from "@agentic/orchestrator";
import { requireApiSession } from "../../../lib/auth";
import { ApiRouteError, authenticatedJson, handleApiError } from "../../../lib/api-response";
import { getSeededRepository, getSeededSelfImprovementRepository } from "../../../lib/server";

const BriefingRequestSchema = z
  .object({
    type: BriefingTypeSchema.optional().default("startup")
  })
  .strict();

async function parseBriefingRequest(request: Request): Promise<z.infer<typeof BriefingRequestSchema>> {
  const rawBody = await request.text();

  if (!rawBody.trim()) {
    return { type: "startup" };
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (!contentType.startsWith("application/json")) {
    throw new ApiRouteError(415, "Content-Type must be application/json.");
  }

  let parsedBody: unknown;

  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    throw new ApiRouteError(400, "Request body must be valid JSON.");
  }

  return BriefingRequestSchema.parse(parsedBody);
}

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

export async function POST(request: Request) {
  try {
    const principal = await requireApiSession(request);
    const { repository, workspaceId, workspaceGovernance } = await resolveActiveWorkspaceContext(principal.userId);
    const body = await parseBriefingRequest(request);

    const [preferences, memories, integrations, allApprovals, watchers] = await Promise.all([
      repository.getBriefingPreferences(principal.userId),
      repository.listMemory(principal.userId),
      repository.listIntegrations(principal.userId),
      repository.listApprovals(principal.userId),
      repository.listWatchers({ userId: principal.userId })
    ]);

    const pendingApprovals = allApprovals.filter((approval) => approval.decision === "pending");
    const activeWatchers = watchers.filter((watcher) => watcher.status === "active");

    const bundle = await generateBriefing({
      type: body.type,
      userId: principal.userId,
      workspaceId,
      governance: workspaceGovernance,
      memories,
      integrations,
      pendingApprovals,
      activeWatchers,
      preferences,
      resolveAgentMetrics: (agentIdOrName) => repository.getAgentMetrics(agentIdOrName, "all")
    });

    await repository.saveGoalBundle(bundle);

    if (bundle.goal.status === "completed") {
      try {
        const captured = captureMemoriesFromBundle(bundle, principal.userId);
        const selfImprovement = await getSeededSelfImprovementRepository();

        await Promise.all([
          ...captured.memories.map((memory) => repository.saveMemory(memory)),
          ...captured.episodes.map((episode) => selfImprovement.appendEpisode(episode))
        ]);

        console.log(
          `[auto-capture] Briefing "${bundle.goal.id}" completed — persisted ${captured.memories.length} memory record(s) and ${captured.episodes.length} episode(s).`
        );
      } catch (captureError) {
        console.error("[auto-capture] Failed to persist captured memories after briefing:", captureError);
      }
    }

    return authenticatedJson({
      bundle,
      dashboard: await repository.getDashboardData(principal.userId)
    });
  } catch (error) {
    return handleApiError(error, "Failed to generate briefing.");
  }
}
