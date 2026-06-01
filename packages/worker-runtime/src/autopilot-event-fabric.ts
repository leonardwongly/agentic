import {
  AutopilotEventFabricEnvelopeSchema,
  type ApprovalRequest,
  type AutopilotEvent,
  type AutopilotEventFabricEnvelope,
  type GoalBundle,
  type WorkspaceGovernance
} from "@agentic/contracts";
import type { WorkerRuntimeRepositoryPort } from "@agentic/repository";

const NON_FABRIC_AUTOPILOT_EVENT_KINDS = new Set<AutopilotEvent["kind"]>([
  "watcher_triggered",
  "template_due",
  "briefing_due",
  "communication_received",
  "deadline_drift_detected",
  "approval_sla_breached",
  "workflow_stalled",
  "connector_failed",
  "dormant_workflow_review_due"
]);

type FabricExecutionContext =
  | {
      goalBundle: GoalBundle | null;
      approval: ApprovalRequest | null;
      workspaceId: string | null;
      workspaceGovernance: WorkspaceGovernance | null;
    }
  | {
      missingReason: string;
    };

function formatValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => formatValue(item)).join(", ");
  }

  if (value === null || value === undefined) {
    return "none";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function buildTriggerLines(trigger: Record<string, unknown>) {
  return Object.entries(trigger)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `${key}: ${formatValue(value)}.`);
}

async function resolveGoalBundleByWorkflowId(
  repository: WorkerRuntimeRepositoryPort,
  userId: string,
  workflowId: string
) {
  const goals = await repository.listGoals(userId);
  return goals.find((bundle) => bundle.workflow.id === workflowId) ?? null;
}

async function resolveApproval(
  repository: WorkerRuntimeRepositoryPort,
  userId: string,
  approvalId: string
) {
  const approvals = await repository.listApprovals(userId);
  return approvals.find((candidate) => candidate.id === approvalId) ?? null;
}

async function resolveDashboardWorkspaceContext(repository: WorkerRuntimeRepositoryPort, userId: string) {
  const dashboard = await repository.getDashboardData(userId);
  const workspaceId = dashboard.activeWorkspace?.id ?? null;

  return {
    workspaceId,
    workspaceGovernance: workspaceId
      ? dashboard.workspaceGovernance ?? await repository.getWorkspaceGovernance(workspaceId, userId)
      : null
  };
}

export function isEventFabricAutopilotKind(kind: AutopilotEvent["kind"]) {
  return !NON_FABRIC_AUTOPILOT_EVENT_KINDS.has(kind);
}

export function getAutopilotEventFabricEnvelope(event: AutopilotEvent) {
  const parsed = AutopilotEventFabricEnvelopeSchema.safeParse(event.details.fabric);
  return parsed.success ? parsed.data : null;
}

export async function resolveAutopilotEventFabricExecutionContext(params: {
  repository: WorkerRuntimeRepositoryPort;
  userId: string;
  envelope: AutopilotEventFabricEnvelope;
}): Promise<FabricExecutionContext> {
  const { repository, userId, envelope } = params;
  let goalBundle = envelope.references.goalId
    ? await repository.getGoalBundleForUser(envelope.references.goalId, userId)
    : null;
  const workflowGoal = envelope.references.workflowId
    ? await resolveGoalBundleByWorkflowId(repository, userId, envelope.references.workflowId)
    : null;
  const approval = envelope.references.approvalId
    ? await resolveApproval(repository, userId, envelope.references.approvalId)
    : null;

  if (envelope.references.goalId && !goalBundle) {
    return { missingReason: `Goal ${envelope.references.goalId} was not found.` };
  }

  if (envelope.references.workflowId && !workflowGoal) {
    return { missingReason: `Workflow ${envelope.references.workflowId} was not found.` };
  }

  if (envelope.references.approvalId && !approval) {
    return { missingReason: `Approval ${envelope.references.approvalId} was not found.` };
  }

  if (goalBundle && workflowGoal && goalBundle.goal.id !== workflowGoal.goal.id) {
    return { missingReason: "Fabric event goal and workflow references diverged during execution." };
  }

  if (approval && goalBundle && approval.goalId !== goalBundle.goal.id) {
    return { missingReason: "Fabric event approval and goal references diverged during execution." };
  }

  if (approval && workflowGoal && approval.goalId !== workflowGoal.goal.id) {
    return { missingReason: "Fabric event approval and workflow references diverged during execution." };
  }

  if (!goalBundle && approval) {
    goalBundle = await repository.getGoalBundleForUser(approval.goalId, userId);

    if (!goalBundle) {
      return { missingReason: `Approval goal ${approval.goalId} was not found.` };
    }
  }

  const workspaceId = goalBundle?.goal.workspaceId ?? null;

  if (workspaceId) {
    return {
      goalBundle,
      approval,
      workspaceId,
      workspaceGovernance: await repository.getWorkspaceGovernance(workspaceId, userId)
    };
  }

  const dashboardContext = await resolveDashboardWorkspaceContext(repository, userId);

  return {
    goalBundle,
    approval,
    workspaceId: dashboardContext.workspaceId,
    workspaceGovernance: dashboardContext.workspaceGovernance
  };
}

export function buildAutopilotEventFabricRequest(params: {
  event: AutopilotEvent;
  envelope: AutopilotEventFabricEnvelope;
  goalBundle: GoalBundle | null;
  approval: ApprovalRequest | null;
}) {
  const { approval, envelope, event, goalBundle } = params;

  return [
    `Autopilot event fabric trigger detected.`,
    `Trigger kind: ${event.kind}.`,
    `Trigger family: ${envelope.family}.`,
    `Severity: ${envelope.severity}.`,
    `Operator route: ${envelope.operatorRoute}.`,
    `Policy: ${envelope.policy}.`,
    `Summary: ${envelope.summary}.`,
    `Source id: ${event.sourceId}.`,
    goalBundle ? `Related goal: ${goalBundle.goal.title}.` : "",
    goalBundle ? `Related workflow status: ${goalBundle.workflow.status}.` : "",
    approval ? `Related approval action: ${approval.preview.actionType}.` : "",
    ...buildTriggerLines(envelope.trigger),
    `Create the smallest safe next-step workflow for the operator. Preserve approval boundaries and route follow-up work to ${envelope.operatorRoute}.`
  ]
    .filter(Boolean)
    .join(" ");
}
