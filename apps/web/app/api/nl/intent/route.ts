import crypto from "node:crypto";
import { z } from "zod";
import { BriefingTypeSchema, RiskClassSchema, type ActorContext } from "@agentic/contracts";
import { enqueueApprovalFollowUpJob, enqueueBriefingCreateJob, enqueueGoalCreateJob } from "@agentic/worker-runtime";
import { checkAbuseRateLimit } from "../../../../lib/abuse-rate-limit";
import { requireApiSession } from "../../../../lib/auth";
import { createActorContextFromPrincipal } from "../../../../lib/actor-context";
import {
  ApiRouteError,
  authenticatedJson,
  authenticatedRateLimitError,
  handleApiError,
  parseJsonBody
} from "../../../../lib/api-response";
import { buildNlCapabilitySummary } from "../../../../lib/nl-capabilities";
import { parseIdempotencyKey } from "../../../../lib/request-idempotency";
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
type IntentExecutionResult = {
  body: Record<string, unknown>;
  status?: number;
};

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

async function queryIntent(
  userId: string,
  intent: z.infer<typeof NLQueryIntentSchema>
): Promise<IntentExecutionResult> {
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
        body: {
          message: `Showing ${approvals.length} recent approval${approvals.length === 1 ? "" : "s"} from the active workspace view.`,
          data: approvals.slice(0, 10)
        }
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
        body: {
          message: `Showing ${goals.length} recent goal bundle${goals.length === 1 ? "" : "s"} from the active workspace view.`,
          data: goals.slice(0, 10)
        }
      };
    }
    case "agents": {
      const agents = await repository.listAgents(userId);

      return {
        body: {
          message: `Found ${agents.length} agent definition${agents.length === 1 ? "" : "s"}.`,
          data: agents.slice(0, 10)
        }
      };
    }
    case "memories":
    default: {
      const memories = dashboard.memories.slice(0, 10);

      return {
        body: {
          message: `Showing ${memories.length} recent memory record${memories.length === 1 ? "" : "s"}.`,
          data: memories
        }
      };
    }
  }
}

async function summaryIntent(
  userId: string,
  intent: z.infer<typeof NLSummaryIntentSchema>
): Promise<IntentExecutionResult> {
  const { dashboard } = await resolveActiveWorkspaceContext(userId);
  const pendingApprovals = dashboard.approvals.filter((approval) => approval.decision === "pending").length;
  const runningGoals = dashboard.goals.filter((bundle) => bundle.goal.status === "running").length;
  const recentActivities = dashboard.actionLogs.slice(0, 5).length;

  return {
    body: {
      message: `${intent.timeRange} summary: ${pendingApprovals} pending approvals, ${runningGoals} running goals, ${recentActivities} recent activities.`,
      data: {
        pendingApprovals,
        runningGoals,
        recentActivities
      }
    }
  };
}

async function approveAllR2(userId: string, actor: ActorContext): Promise<IntentExecutionResult> {
  const { repository } = await resolveActiveWorkspaceContext(userId);
  const pendingApprovals = (await repository.listApprovals(userId)).filter(
    (approval) => approval.decision === "pending" && approval.riskClass === "R2"
  );

  if (pendingApprovals.length === 0) {
    return {
      body: {
        message: "No R2 approvals pending.",
        dashboard: await repository.getDashboardData(userId)
      }
    };
  }

  let approvedCount = 0;
  let queuedCount = 0;
  let failedCount = 0;

  for (const approval of pendingApprovals) {
    try {
      const updatedBundle = await repository.respondToApproval({
        approvalId: approval.id,
        decision: "approved",
        actor,
        scope: "once"
      });
      await enqueueApprovalFollowUpJob({
        repository,
        userId,
        approvalId: approval.id,
        goalId: updatedBundle.goal.id,
        taskId: approval.taskId,
        decision: "approved",
        workspaceId: updatedBundle.goal.workspaceId,
        actorContext: actor,
        actionIntent: approval.actionIntent
      });

      approvedCount += 1;
      queuedCount += 1;
    } catch (error) {
      failedCount += 1;
      console.error(`[nl-intent] Failed to approve ${approval.id}:`, error);
    }
  }

  return {
    body: {
      message:
        failedCount === 0
          ? `Approved ${approvedCount} R2 approval${approvedCount === 1 ? "" : "s"} and queued ${queuedCount} follow-up job${queuedCount === 1 ? "" : "s"}.`
          : `Approved ${approvedCount} R2 approval${approvedCount === 1 ? "" : "s"}, queued ${queuedCount} follow-up job${queuedCount === 1 ? "" : "s"}, and failed ${failedCount}.`,
      dashboard: await repository.getDashboardData(userId)
    }
  };
}

async function createGoalFromIntent(
  userId: string,
  actor: ActorContext,
  intent: z.infer<typeof NLCreateGoalCommandSchema>,
  idempotencyKey: string | null
): Promise<IntentExecutionResult> {
  const { repository, workspaceId } = await resolveActiveWorkspaceContext(userId);
  const job = await enqueueGoalCreateJob({
    repository,
    userId,
    request: intent.params.request,
    workspaceId,
    agentId: null,
    actorContext: actor,
    idempotencyKey
  });

  return {
    status: 202,
    body: {
      message: "Queued goal creation from the NL bar.",
      data: {
        goalId: job.payload.goalId,
        request: intent.params.request
      },
      job: {
        id: job.id,
        kind: job.kind,
        status: job.status,
        goalId: job.payload.goalId,
        attemptCount: job.attemptCount,
        maxAttempts: job.maxAttempts,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt
      },
      statusUrl: `/api/goals/jobs/${job.id}`
    }
  };
}

async function createBriefingFromIntent(
  userId: string,
  actor: ActorContext,
  intent: z.infer<typeof NLBriefingCommandSchema>,
  idempotencyKey: string | null
): Promise<IntentExecutionResult> {
  const { repository, workspaceId } = await resolveActiveWorkspaceContext(userId);
  const type = intent.params.type === "morning" ? "startup" : intent.params.type;
  const job = await enqueueBriefingCreateJob({
    repository,
    userId,
    goalId: crypto.randomUUID(),
    workflowId: crypto.randomUUID(),
    briefingType: type,
    workspaceId,
    actorContext: actor,
    idempotencyKey
  });

  return {
    status: 202,
    body: {
      message: `Queued ${type === "startup" ? "startup" : type} briefing generation from the NL bar.`,
      data: {
        goalId: job.payload.goalId,
        type
      },
      job: {
        id: job.id,
        kind: job.kind,
        status: job.status,
        goalId: job.payload.goalId,
        briefingType: job.payload.briefingType,
        attemptCount: job.attemptCount,
        maxAttempts: job.maxAttempts,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt
      },
      statusUrl: `/api/briefing/jobs/${job.id}`
    }
  };
}

async function commandIntent(
  userId: string,
  actor: ActorContext,
  intent: z.infer<typeof NLApproveCommandSchema> | z.infer<typeof NLRejectCommandSchema> | z.infer<typeof NLCreateGoalCommandSchema> | z.infer<typeof NLBriefingCommandSchema>,
  idempotencyKey: string | null
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
          body: {
            message: "Only the bounded batch command 'approve all R2' is available from the NL bar right now.",
            dashboard: context.dashboard,
            capabilities: capabilitySummary
          }
        };
      }

    case "create-goal":
      return createGoalFromIntent(userId, actor, intent, idempotencyKey);
    case "briefing":
      return createBriefingFromIntent(userId, actor, intent, idempotencyKey);
    case "reject":
    default:
      throw new ApiRouteError(400, "Reject commands require selecting an approval in the approvals queue.");
  }
}

async function executeIntent(
  userId: string,
  actor: ActorContext,
  intent: NLIntentRequest,
  idempotencyKey: string | null
) {
  if (intent.type === "query") {
    return queryIntent(userId, intent);
  }

  if (intent.type === "summary") {
    return summaryIntent(userId, intent);
  }

  return commandIntent(userId, actor, intent, idempotencyKey);
}

export async function POST(request: Request) {
  try {
    const principal = await requireApiSession(request);
    const actor = createActorContextFromPrincipal(principal);
    const intent = await parseJsonBody(request, NLIntentRequestSchema);

    if (intent.type === "command") {
      const rateLimit = await checkAbuseRateLimit({
        namespace: "nl-command",
        request,
        principal
      });

      if (!rateLimit.allowed) {
        return authenticatedRateLimitError("Too many NL command requests. Try again later.", rateLimit.retryAfterSeconds);
      }
    }

    const idempotencyKey = intent.type === "command" ? parseIdempotencyKey(request) : null;
    const result = await executeIntent(principal.userId, actor, intent, idempotencyKey);

    return authenticatedJson(result.body, result.status ? { status: result.status } : undefined);
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
