import { z } from "zod";
import { GoalTemplateSchema, nowIso } from "@agentic/contracts";
import { processUserRequest, captureMemoriesFromBundle, interpolateTemplate, computeNextRun } from "@agentic/orchestrator";
import { createActorContextFromPrincipal } from "../../../../../lib/actor-context";
import { requireApiSession } from "../../../../../lib/auth";
import { ApiRouteError, authenticatedJson, handleApiError } from "../../../../../lib/api-response";
import { getSeededRepository, getSeededSelfImprovementRepository } from "../../../../../lib/server";

const TemplateIdSchema = z.string().trim().min(1).max(200);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await requireApiSession(request);
    const actorContext = createActorContextFromPrincipal(principal);
    const { id } = await context.params;
    const templateId = TemplateIdSchema.parse(id);
    const repository = await getSeededRepository();
    const dashboard = await repository.getDashboardData(principal.userId);
    const workspaceId = dashboard.activeWorkspace?.id ?? null;
    const workspaceGovernance = workspaceId
      ? dashboard.workspaceGovernance ?? await repository.getWorkspaceGovernance(workspaceId, principal.userId)
      : null;
    const templates = await repository.listTemplates(principal.userId);
    const template = templates.find((t) => t.id === templateId);

    if (!template) {
      throw new ApiRouteError(404, `Template ${templateId} was not found.`);
    }

    const interpolated = interpolateTemplate(template);

    const [memories, integrations] = await Promise.all([
      repository.listMemory(principal.userId),
      repository.listIntegrations(principal.userId)
    ]);

    const bundle = await processUserRequest({
      userId: principal.userId,
      request: interpolated,
      workspaceId,
      governance: workspaceGovernance,
      memories,
      integrations,
      resolveAgentMetrics: (agentIdOrName) => repository.getAgentMetrics(agentIdOrName, "all", principal.userId)
    });

    await repository.saveGoalBundle(bundle);

    // Update lastRunAt and nextRunAt on the template
    const nextRunAt = template.schedule.enabled && template.schedule.cron
      ? computeNextRun(template.schedule.cron, template.schedule.timezone)
      : null;

    const updatedTemplate = GoalTemplateSchema.parse({
      ...template,
      schedule: {
        ...template.schedule,
        lastRunAt: nowIso(),
        nextRunAt
      },
      actorContext,
      updatedAt: nowIso()
    });

    await repository.saveTemplate(updatedTemplate);

    // Capture memories from completed goals
    if (bundle.goal.status === "completed") {
      try {
        const captured = captureMemoriesFromBundle(bundle, principal.userId, actorContext);
        const selfImprovement = await getSeededSelfImprovementRepository();

        await Promise.all([
          ...captured.memories.map((memory) => repository.saveMemory(memory)),
          ...captured.episodes.map((episode) => selfImprovement.appendEpisode(episode))
        ]);

        console.log(
          `[template-run] Goal "${bundle.goal.id}" completed — persisted ${captured.memories.length} memory record(s) and ${captured.episodes.length} episode(s).`
        );
      } catch (captureError) {
        console.error("[template-run] Failed to persist captured memories after template run:", captureError);
      }
    }

    return authenticatedJson({
      bundle,
      dashboard: await repository.getDashboardData(principal.userId)
    });
  } catch (error) {
    return handleApiError(error, "Failed to run template.");
  }
}
