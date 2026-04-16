import { z } from "zod";
import { BriefingTypeSchema, RiskClassSchema, type ActorContext } from "@agentic/contracts";
import { captureExecutionOutcomeSignals, captureMemoriesFromBundle, executeApprovedTasks, generateBriefing, processUserRequest, reconcileExecutionResults, type ExecutionResult } from "@agentic/orchestrator";
import { isCalendarReady, isGmailReady, createDraft, createEvent, createLocalNote, listRecentEmails, listUpcomingEvents, sendDraft, updateEvent } from "@agentic/integrations";
import { requireApiSession } from "../../../../lib/auth";
import { createActorContextFromPrincipal } from "../../../../lib/actor-context";
import { ApiRouteError, authenticatedJson, handleApiError, parseJsonBody } from "../../../../lib/api-response";
import { buildNlCapabilitySummary } from "../../../../lib/nl-capabilities";
import { persistCapturedMemories } from "../../../../lib/persist-captured-memories";
import { getSeededRepository } from "../../../../lib/server";

const NLSummaryTimeRangeSchema = z.enum(["today", "week", "since-last-login", "custom"]);

const NLQueryIntentSchema = z
  .object({
    type: z.literal("query"),
    target: z.enum(["approvals", "goals", "agents", "memories"]),
    filters: z
      .object({
        status: z.string().trim().min(1).max(50).optional(),
        riskClass: RiskClassSchema.optional()
      })
      .strict()
      .optional()
      .default({})
  })
  .strict();

const NLApproveCommandSchema = z
  .object({
    type: z.literal("command"),
    action: z.literal("approve"),
    params: z
      .object({
        all: z.boolean().optional(),
        riskClass: RiskClassSchema.optional()
      })
      .strict()
  })
  .strict();

const NLRejectCommandSchema = z
  .object({
    type: z.literal("command"),
    action: z.literal("reject"),
    params: z.object({}).strict()
  })
  .strict();

const NLCreateGoalCommandSchema = z
  .object({
    type: z.literal("command"),
    action: z.literal("create-goal"),
    params: z
      .object({
        request: z.string().trim().min(1).max(2_000)
      })
      .strict()
  })
  .strict();

const NLBriefingCommandSchema = z
  .object({
    type: z.literal("command"),
    action: z.literal("briefing"),
    params: z
      .object({
        type: z.union([z.literal("morning"), BriefingTypeSchema]).optional().default("startup")
      })
      .strict()
  })
  .strict();

const NLSummaryIntentSchema = z
  .object({
    type: z.literal("summary"),
    timeRange: NLSummaryTimeRangeSchema
  })
  .strict();

const NLIntentRequestSchema = z.union([
  NLQueryIntentSchema,
  NLApproveCommandSchema,
  NLRejectCommandSchema,
  NLCreateGoalCommandSchema,
  NLBriefingCommandSchema,
  NLSummaryIntentSchema
]);

type NLIntentRequest = z.infer<typeof NLIntentRequestSchema>;

async function resolveActiveWorkspaceContext(userId: string) {
  const repository = await getSeededRepository();
  const dashboard = await repository.getDashboardData(userId);
  const workspaceId = dashboard.activeWorkspace?.id ?? null;

  return {
    repository,
    workspaceId,
    workspaceGovernance: workspaceId
      ? dashboard.workspaceGovernance ?? await repository.getWorkspaceGovernance(workspaceId, userId)
      : null,
    dashboard
  };
}

async function queryIntent(userId: string, intent: z.infer<typeof NLQueryIntentSchema>) {
  const { repository, dashboard } = await resolveActiveWorkspaceContext(userId);

  switch (intent.target) {
    case "approvals": {
      const approvals = dashboard.approvals.filter((approval) => {
        if (intent.filters.status && approval.decision !== intent.filters.status) {
          return false;
        }

        if (intent.filters.riskClass && approval.riskClass !== intent.filters.riskClass) {
          return false;
        }

        return true;
      });

      return {
        message: `Found ${approvals.length} approval${approvals.length === 1 ? "" : "s"}.`,
        data: approvals.slice(0, 10)
      };
    }
    case "goals": {
      const goals = dashboard.goals.filter((bundle) => {
        if (!intent.filters.status) {
          return true;
        }

        return bundle.goal.status === intent.filters.status;
      });

      return {
        message: `Found ${goals.length} goal bundle${goals.length === 1 ? "" : "s"}.`,
        data: goals.slice(0, 10)
      };
    }
    case "agents": {
      const agents = await repository.listAgents(userId);

      return {
        message: `Found ${agents.length} agent definition${agents.length === 1 ? "" : "s"}.`,
        data: agents.slice(0, 10)
      };
    }
    case "memories":
    default: {
      const memories = dashboard.memories.slice(0, 10);

      return {
        message: `Found ${dashboard.memories.length} memory record${dashboard.memories.length === 1 ? "" : "s"}.`,
        data: memories
      };
    }
  }
}

async function summaryIntent(userId: string, intent: z.infer<typeof NLSummaryIntentSchema>) {
  const { dashboard } = await resolveActiveWorkspaceContext(userId);
  const pendingApprovals = dashboard.approvals.filter((approval) => approval.decision === "pending").length;
  const runningGoals = dashboard.goals.filter((bundle) => bundle.goal.status === "running").length;
  const recentActivities = dashboard.actionLogs.slice(0, 5).length;

  return {
    message: `${intent.timeRange} summary: ${pendingApprovals} pending approvals, ${runningGoals} running goals, ${recentActivities} recent activities.`,
    data: {
      pendingApprovals,
      runningGoals,
      recentActivities
    }
  };
}

async function approveAllR2(userId: string, actor: ActorContext) {
  const { repository } = await resolveActiveWorkspaceContext(userId);
  const pendingApprovals = (await repository.listApprovals(userId)).filter(
    (approval) => approval.decision === "pending" && approval.riskClass === "R2"
  );

  if (pendingApprovals.length === 0) {
    return {
      message: "No R2 approvals pending.",
      dashboard: await repository.getDashboardData(userId)
    };
  }

  let approvedCount = 0;
  let failedCount = 0;

  for (const approval of pendingApprovals) {
    try {
      let updatedBundle = await repository.respondToApproval({
        approvalId: approval.id,
        decision: "approved",
        actor,
        scope: "once"
      });

      let executionResults: ExecutionResult[] = [];

      try {
        const adapters = {
          gmail: isGmailReady() ? { createDraft, sendDraft, listRecentEmails } : undefined,
          calendar: isCalendarReady() ? { createEvent, updateEvent, listUpcomingEvents } : undefined,
          notes: { createLocalNote }
        };
        const governance = updatedBundle.goal.workspaceId
          ? await repository.getWorkspaceGovernance(updatedBundle.goal.workspaceId, userId)
          : null;
        const { results, logs } = await executeApprovedTasks({
          bundle: updatedBundle,
          approvedTaskIds: [approval.taskId],
          adapters,
          governance
        });
        executionResults = results;
        updatedBundle = reconcileExecutionResults({
          bundle: updatedBundle,
          results,
          logs
        });
      } catch (executionError) {
        console.error("[nl-intent] Failed to execute approved R2 task:", executionError);
      }

      await repository.saveGoalBundle(updatedBundle);

      if (executionResults.length > 0) {
        await persistCapturedMemories({
          repository,
          captured: captureExecutionOutcomeSignals(updatedBundle, userId, executionResults, actor),
          goalId: updatedBundle.goal.id,
          label: "nl-intent-execution-capture",
          actorContext: actor
        });
      }

      if (updatedBundle.goal.status === "completed") {
        await persistCapturedMemories({
          repository,
          captured: captureMemoriesFromBundle(updatedBundle, userId, actor),
          goalId: updatedBundle.goal.id,
          label: "nl-intent-auto-capture",
          actorContext: actor
        });
      }

      approvedCount += 1;
    } catch (error) {
      failedCount += 1;
      console.error(`[nl-intent] Failed to approve ${approval.id}:`, error);
    }
  }

  return {
    message:
      failedCount === 0
        ? `Approved ${approvedCount} R2 approval${approvedCount === 1 ? "" : "s"}.`
        : `Approved ${approvedCount} R2 approval${approvedCount === 1 ? "" : "s"} and failed ${failedCount}.`,
    dashboard: await repository.getDashboardData(userId)
  };
}

async function createGoalFromIntent(userId: string, actor: ActorContext, intent: z.infer<typeof NLCreateGoalCommandSchema>) {
  const { repository, workspaceId, workspaceGovernance } = await resolveActiveWorkspaceContext(userId);
  const [memories, integrations] = await Promise.all([
    repository.listMemory(userId),
    repository.listIntegrations(userId)
  ]);
  const bundle = await processUserRequest({
    userId,
    request: intent.params.request,
    workspaceId,
    governance: workspaceGovernance,
    memories,
    integrations,
    resolveAgentMetrics: (agentIdOrName) => repository.getAgentMetrics(agentIdOrName, "all", userId)
  });

  await repository.saveGoalBundle(bundle);

  if (bundle.goal.status === "completed") {
    await persistCapturedMemories({
      repository,
      captured: captureMemoriesFromBundle(bundle, userId, actor),
      goalId: bundle.goal.id,
      label: "nl-intent-auto-capture",
      actorContext: actor
    });
  }

  return {
    message: `Created goal bundle "${bundle.goal.title}".`,
    data: {
      goalId: bundle.goal.id,
      title: bundle.goal.title
    },
    dashboard: await repository.getDashboardData(userId)
  };
}

async function createBriefingFromIntent(userId: string, actor: ActorContext, intent: z.infer<typeof NLBriefingCommandSchema>) {
  const { repository, workspaceId, workspaceGovernance } = await resolveActiveWorkspaceContext(userId);
  const [preferences, memories, integrations, allApprovals, watchers] = await Promise.all([
    repository.getBriefingPreferences(userId),
    repository.listMemory(userId),
    repository.listIntegrations(userId),
    repository.listApprovals(userId),
    repository.listWatchers({ userId })
  ]);
  const type = intent.params.type === "morning" ? "startup" : intent.params.type;
  const bundle = await generateBriefing({
    type,
    userId,
    workspaceId,
    governance: workspaceGovernance,
    memories,
    integrations,
    pendingApprovals: allApprovals.filter((approval) => approval.decision === "pending"),
    activeWatchers: watchers.filter((watcher) => watcher.status === "active"),
    preferences,
    resolveAgentMetrics: (agentIdOrName) => repository.getAgentMetrics(agentIdOrName, "all", userId)
  });

  await repository.saveGoalBundle(bundle);

  if (bundle.goal.status === "completed") {
    await persistCapturedMemories({
      repository,
      captured: captureMemoriesFromBundle(bundle, userId, actor),
      goalId: bundle.goal.id,
      label: "nl-intent-auto-capture",
      actorContext: actor
    });
  }

  return {
    message: `Generated ${bundle.goal.title}.`,
    data: {
      goalId: bundle.goal.id,
      type
    },
    dashboard: await repository.getDashboardData(userId)
  };
}

async function commandIntent(
  userId: string,
  actor: ActorContext,
  intent: z.infer<typeof NLApproveCommandSchema> | z.infer<typeof NLRejectCommandSchema> | z.infer<typeof NLCreateGoalCommandSchema> | z.infer<typeof NLBriefingCommandSchema>
) {
  switch (intent.action) {
    case "approve":
      if (intent.params.all === true && intent.params.riskClass === "R2") {
        return approveAllR2(userId, actor);
      }

      {
        const context = await resolveActiveWorkspaceContext(userId);
        const capabilitySummary = buildNlCapabilitySummary({
          activeWorkspaceName: context.dashboard.activeWorkspace?.name ?? null,
          approvals: context.dashboard.approvals,
          integrations: context.dashboard.integrations,
          workspaceGovernance: context.workspaceGovernance
        });

        return {
          message: "Only the bounded batch command 'approve all R2' is available from the NL bar right now.",
          dashboard: context.dashboard,
          capabilities: capabilitySummary
        };
      }

    case "create-goal":
      return createGoalFromIntent(userId, actor, intent);
    case "briefing":
      return createBriefingFromIntent(userId, actor, intent);
    case "reject":
    default:
      throw new ApiRouteError(400, "Reject commands require selecting an approval in the approvals queue.");
  }
}

async function executeIntent(userId: string, actor: ActorContext, intent: NLIntentRequest) {
  if (intent.type === "query") {
    return queryIntent(userId, intent);
  }

  if (intent.type === "summary") {
    return summaryIntent(userId, intent);
  }

  return commandIntent(userId, actor, intent);
}

export async function POST(request: Request) {
  try {
    const principal = await requireApiSession(request);
    const actor = createActorContextFromPrincipal(principal);
    const intent = await parseJsonBody(request, NLIntentRequestSchema);
    const result = await executeIntent(principal.userId, actor, intent);

    return authenticatedJson(result);
  } catch (error) {
    return handleApiError(error, "Failed to execute NL intent.");
  }
}

export async function GET(request: Request) {
  try {
    const principal = await requireApiSession(request);
    const context = await resolveActiveWorkspaceContext(principal.userId);

    return authenticatedJson({
      capabilities: buildNlCapabilitySummary({
        activeWorkspaceName: context.dashboard.activeWorkspace?.name ?? null,
        approvals: context.dashboard.approvals,
        integrations: context.dashboard.integrations,
        workspaceGovernance: context.workspaceGovernance
      })
    });
  } catch (error) {
    return handleApiError(error, "Failed to load NL capability summary.");
  }
}
