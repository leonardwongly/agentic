import { SYSTEM_USER_ID } from "@agentic/contracts";
import { generateMorningBriefing, captureMemoriesFromBundle } from "@agentic/orchestrator";
import { requireApiSession } from "../../../lib/auth";
import { authenticatedJson, handleApiError } from "../../../lib/api-response";
import { getSeededRepository, getSeededSelfImprovementRepository } from "../../../lib/server";

export async function POST(request: Request) {
  try {
    await requireApiSession(request);
    const repository = await getSeededRepository();

    const [memories, integrations, allApprovals, watchers] = await Promise.all([
      repository.listMemory(SYSTEM_USER_ID),
      repository.listIntegrations(SYSTEM_USER_ID),
      repository.listApprovals(SYSTEM_USER_ID),
      repository.listWatchers({ userId: SYSTEM_USER_ID })
    ]);

    const pendingApprovals = allApprovals.filter((a) => a.decision === "pending");
    const activeWatchers = watchers.filter((w) => w.status === "active");

    const bundle = await generateMorningBriefing({
      userId: SYSTEM_USER_ID,
      memories,
      integrations,
      pendingApprovals,
      activeWatchers
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
          `[auto-capture] Briefing "${bundle.goal.id}" completed — persisted ${captured.memories.length} memory record(s) and ${captured.episodes.length} episode(s).`
        );
      } catch (captureError) {
        console.error("[auto-capture] Failed to persist captured memories after briefing:", captureError);
      }
    }

    return authenticatedJson({
      bundle,
      dashboard: await repository.getDashboardData(SYSTEM_USER_ID)
    });
  } catch (error) {
    return handleApiError(error, "Failed to generate morning briefing.");
  }
}
