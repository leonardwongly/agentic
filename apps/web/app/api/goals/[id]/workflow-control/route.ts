import { z } from "zod";
import {
  WORKFLOW_DAG_CONTROL_LOG_KIND,
  WorkflowDagControlError,
  applyWorkflowDagControl,
  summarizeWorkflowDag
} from "@agentic/orchestrator";
import { createActionLog } from "@agentic/observability";
import { checkAbuseRateLimit } from "../../../../../lib/abuse-rate-limit";
import { requireApiPrincipal } from "../../../../../lib/auth";
import { createActorContextFromPrincipal } from "../../../../../lib/actor-context";
import {
  ApiRouteError,
  authenticatedJson,
  authenticatedRateLimitError,
  handleApiError,
  parseJsonBody
} from "../../../../../lib/api-response";
import { getSeededRepository } from "../../../../../lib/server";
import {
  canOperateSharedWorkflow,
  getSharedWorkflowDeniedReason,
  resolveWorkspaceRoleForUser
} from "../../../../../lib/workspace-role-permissions";

const GoalIdSchema = z.string().trim().min(1).max(200);

const WorkflowControlBodySchema = z
  .object({
    action: z.enum(["pause", "resume", "cancel"]),
    reason: z.string().trim().min(1).max(500).optional()
  })
  .strict();

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

// AOS-25: governed operator control for a goal's workflow. Activates the
// WorkflowDag control mechanism (AOS-20 implemented applyWorkflowDagControl +
// readLatestWorkflowDagControl, but nothing wrote a control log until now). The
// control is persisted as an append-only `workflow.dag.control` action log, which
// projectWorkflowDagInstance/summarizeWorkflowDag already honor.
export async function POST(request: Request, context: RouteContext) {
  try {
    const principal = await requireApiPrincipal(request, {
      allowMachineToken: true,
      routeGroup: "automation",
      scope: "jobs:create"
    });
    const rateLimit = await checkAbuseRateLimit({
      namespace: "workflow-control",
      request,
      principal
    });

    if (!rateLimit.allowed) {
      return authenticatedRateLimitError("Too many workflow control requests. Try again later.", rateLimit.retryAfterSeconds);
    }

    const actorContext = createActorContextFromPrincipal(principal);
    const { id } = await context.params;
    const goalId = GoalIdSchema.parse(id);
    const body = await parseJsonBody(request, WorkflowControlBodySchema);
    const repository = await getSeededRepository();
    const bundle = await repository.getGoalBundleForUser(goalId, principal.userId);

    if (!bundle) {
      throw new ApiRouteError(404, `Goal ${goalId} was not found.`);
    }

    const workspaceMembers = bundle.goal.workspaceId
      ? await repository.listWorkspaceMembers(bundle.goal.workspaceId, principal.userId)
      : [];
    const workspaceRole = resolveWorkspaceRoleForUser(workspaceMembers, bundle.goal.workspaceId, principal.userId);

    if (!canOperateSharedWorkflow({ workspaceId: bundle.goal.workspaceId, role: workspaceRole })) {
      throw new ApiRouteError(403, getSharedWorkflowDeniedReason("control_workflow"));
    }

    let control;
    try {
      control = applyWorkflowDagControl({ bundle, action: body.action, reason: body.reason ?? null });
    } catch (error) {
      if (error instanceof WorkflowDagControlError) {
        throw new ApiRouteError(409, error.message);
      }
      throw error;
    }

    const now = new Date().toISOString();
    const controlLog = createActionLog({
      goalId: bundle.goal.id,
      workflowId: bundle.workflow.id,
      actor: actorContext.executor.label,
      kind: WORKFLOW_DAG_CONTROL_LOG_KIND,
      message: `Operator ${body.action} on workflow ${bundle.workflow.id} -> ${control.status}.`,
      details: {
        action: body.action,
        status: control.status,
        reason: body.reason ?? null,
        at: now,
        compensations: control.compensations
      },
      prevLog: bundle.actionLogs.at(-1) ?? null
    });
    await repository.appendGoalActionLogs(bundle.goal.id, [controlLog]);

    // AOS-25: a governed cancel also aborts the goal's not-yet-completed durable
    // jobs so queued/retrying work stops instead of running after the operator
    // cancelled the workflow. A worker already mid-attempt may finish its current
    // attempt; in-attempt abort propagation is a tracked follow-up.
    let cancelledJobs = 0;
    if (body.action === "cancel") {
      const cancelled = await repository.cancelJobsForGoal({
        goalId: bundle.goal.id,
        userId: principal.userId,
        reason: body.reason ?? undefined
      });
      cancelledJobs = cancelled.length;
    }

    const updatedBundle = { ...bundle, actionLogs: [...bundle.actionLogs, controlLog] };

    return authenticatedJson({
      control: {
        action: body.action,
        status: control.status,
        compensations: control.compensations
      },
      cancelledJobs,
      workflowDag: summarizeWorkflowDag(updatedBundle)
    });
  } catch (error) {
    return handleApiError(error, "Failed to control the workflow.");
  }
}
