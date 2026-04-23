import type { AgentDefinition, AgentMetrics, EvidenceRecord, GoalBundle, Task } from "@agentic/contracts";
import { nowIso } from "@agentic/contracts";
import { deriveAgentMetricsFromGoals } from "./agent-metrics";

export type CalibrationPeriod = "day" | "week" | "month" | "all";

export type CalibrationPosture = "ready" | "watch" | "needs-review" | "insufficient-data";

export type CalibrationEventKind =
  | "approval_approved"
  | "approval_rejected"
  | "post_approval_failure"
  | "task_failure";

export type CalibrationEventSeverity = "info" | "warning" | "critical";

export type CalibrationEvent = {
  id: string;
  agentId: string;
  agentName: string;
  kind: CalibrationEventKind;
  severity: CalibrationEventSeverity;
  title: string;
  summary: string;
  createdAt: string;
  goalId: string;
  taskId: string;
  approvalId?: string | null;
};

export type AgentCalibrationInsight = {
  agentId: string;
  agentName: string;
  period: CalibrationPeriod;
  posture: CalibrationPosture;
  summary: string;
  confidence: number;
  metrics: Pick<
    AgentMetrics,
    | "tasksTotal"
    | "tasksCompleted"
    | "tasksFailed"
    | "tasksBlocked"
    | "approvalsRequested"
    | "approvalsApproved"
    | "approvalsRejected"
    | "feedbackCount"
    | "userCorrectionCount"
    | "postApprovalFailureCount"
    | "successRate"
    | "approvalRate"
    | "correctionRate"
    | "postApprovalFailureRate"
  >;
  signals: string[];
  events: CalibrationEvent[];
};

export type CalibrationInsights = {
  generatedAt: string;
  period: CalibrationPeriod;
  totalAgents: number;
  agentsWithActivity: number;
  postureCounts: Record<CalibrationPosture, number>;
  insights: AgentCalibrationInsight[];
  events: CalibrationEvent[];
};

export type CalibrationInsightParams = {
  agentId?: string | null;
  period?: CalibrationPeriod;
  limit?: number;
};

const DEFAULT_CALIBRATION_EVENT_LIMIT = 12;
const MAX_CALIBRATION_EVENT_LIMIT = 50;

function clampEventLimit(limit: number | null | undefined): number {
  if (limit === null || limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_CALIBRATION_EVENT_LIMIT;
  }

  return Math.min(MAX_CALIBRATION_EVENT_LIMIT, Math.max(1, Math.trunc(limit)));
}

function taskMatchesAgent(task: Task, agent: AgentDefinition): boolean {
  return task.assignedAgent === agent.id || task.assignedAgent === agent.name;
}

function roundRate(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function pickCalibrationMetrics(metrics: AgentMetrics): AgentCalibrationInsight["metrics"] {
  return {
    tasksTotal: metrics.tasksTotal,
    tasksCompleted: metrics.tasksCompleted,
    tasksFailed: metrics.tasksFailed,
    tasksBlocked: metrics.tasksBlocked,
    approvalsRequested: metrics.approvalsRequested,
    approvalsApproved: metrics.approvalsApproved,
    approvalsRejected: metrics.approvalsRejected,
    feedbackCount: metrics.feedbackCount,
    userCorrectionCount: metrics.userCorrectionCount,
    postApprovalFailureCount: metrics.postApprovalFailureCount,
    successRate: roundRate(metrics.successRate),
    approvalRate: roundRate(metrics.approvalRate),
    correctionRate: roundRate(metrics.correctionRate),
    postApprovalFailureRate: roundRate(metrics.postApprovalFailureRate)
  };
}

function compareEventsDesc(left: CalibrationEvent, right: CalibrationEvent): number {
  const byTime = right.createdAt.localeCompare(left.createdAt);
  return byTime === 0 ? right.id.localeCompare(left.id) : byTime;
}

function buildCalibrationEvents(params: {
  agent: AgentDefinition;
  goals: GoalBundle[];
  evidenceRecords: EvidenceRecord[];
}): CalibrationEvent[] {
  const matchingTasks = params.goals
    .flatMap((bundle) => bundle.tasks.map((task) => ({ bundle, task })))
    .filter(({ task }) => taskMatchesAgent(task, params.agent));
  const taskById = new Map(matchingTasks.map(({ task }) => [task.id, task] as const));
  const goalIdByTaskId = new Map(matchingTasks.map(({ bundle, task }) => [task.id, bundle.goal.id] as const));
  const events: CalibrationEvent[] = [];

  for (const record of params.evidenceRecords) {
    if (!taskById.has(record.taskId)) {
      continue;
    }

    if (record.decision === "rejected") {
      events.push({
        id: `calibration:${record.id}:rejected`,
        agentId: params.agent.id,
        agentName: params.agent.name,
        kind: "approval_rejected",
        severity: "warning",
        title: "Correction recorded",
        summary: record.decisionRationale ?? record.sourceSummary,
        createdAt: record.respondedAt,
        goalId: record.goalId,
        taskId: record.taskId,
        approvalId: record.approvalId
      });
    } else if (record.resultingTaskState === "failed" || record.resultingTaskState === "blocked") {
      events.push({
        id: `calibration:${record.id}:post-approval-failure`,
        agentId: params.agent.id,
        agentName: params.agent.name,
        kind: "post_approval_failure",
        severity: "critical",
        title: "Approved work did not complete",
        summary: record.sourceSummary,
        createdAt: record.updatedAt,
        goalId: record.goalId,
        taskId: record.taskId,
        approvalId: record.approvalId
      });
    } else {
      events.push({
        id: `calibration:${record.id}:approved`,
        agentId: params.agent.id,
        agentName: params.agent.name,
        kind: "approval_approved",
        severity: "info",
        title: "Approval matched outcome",
        summary: record.sourceSummary,
        createdAt: record.respondedAt,
        goalId: record.goalId,
        taskId: record.taskId,
        approvalId: record.approvalId
      });
    }
  }

  for (const task of taskById.values()) {
    if (task.state !== "failed" && task.state !== "blocked") {
      continue;
    }

    const hasFailureEvidence = events.some(
      (event) => event.taskId === task.id && event.kind === "post_approval_failure"
    );

    if (hasFailureEvidence) {
      continue;
    }

    events.push({
      id: `calibration:${task.id}:task-failure`,
      agentId: params.agent.id,
      agentName: params.agent.name,
      kind: "task_failure",
      severity: "warning",
      title: task.state === "blocked" ? "Task blocked" : "Task failed",
      summary: task.title,
      createdAt: task.updatedAt,
      goalId: goalIdByTaskId.get(task.id) ?? task.goalId,
      taskId: task.id,
      approvalId: null
    });
  }

  return events.sort(compareEventsDesc);
}

function classifyPosture(metrics: AgentMetrics): CalibrationPosture {
  const activityCount = metrics.tasksTotal + metrics.approvalsRequested + metrics.feedbackCount;

  if (activityCount === 0) {
    return "insufficient-data";
  }

  if (metrics.postApprovalFailureRate >= 0.2 || metrics.tasksFailed + metrics.tasksBlocked > 0) {
    return "needs-review";
  }

  if (metrics.correctionRate >= 0.25 || metrics.successRate < 0.8 || metrics.approvalRate < 0.5) {
    return "watch";
  }

  return "ready";
}

function buildSignals(metrics: AgentMetrics, posture: CalibrationPosture): string[] {
  if (posture === "insufficient-data") {
    return ["No completed approval evidence yet"];
  }

  const signals = [
    `${metrics.tasksCompleted}/${metrics.tasksTotal} tasks completed`,
    `${metrics.approvalsApproved}/${metrics.approvalsRequested} approvals accepted`
  ];

  if (metrics.userCorrectionCount > 0) {
    signals.push(`${metrics.userCorrectionCount} correction${metrics.userCorrectionCount === 1 ? "" : "s"} recorded`);
  }

  if (metrics.postApprovalFailureCount > 0) {
    signals.push(`${metrics.postApprovalFailureCount} post-approval failure${metrics.postApprovalFailureCount === 1 ? "" : "s"}`);
  }

  if (metrics.tasksFailed + metrics.tasksBlocked > 0) {
    signals.push(`${metrics.tasksFailed + metrics.tasksBlocked} incomplete task${metrics.tasksFailed + metrics.tasksBlocked === 1 ? "" : "s"}`);
  }

  return signals;
}

function summarizePosture(metrics: AgentMetrics, posture: CalibrationPosture): string {
  if (posture === "insufficient-data") {
    return "Keep this agent in observation until approval and outcome evidence exists.";
  }

  if (posture === "needs-review") {
    return "Review recent failures before expanding autonomy or reducing approval gates.";
  }

  if (posture === "watch") {
    return "Continue with current approval gates while corrections and acceptance rates settle.";
  }

  return "Recent approvals and task outcomes are aligned with the current operating mode.";
}

function computeConfidence(metrics: AgentMetrics): number {
  const samples = metrics.tasksTotal + metrics.feedbackCount + metrics.approvalsRequested;

  if (samples === 0) {
    return 0;
  }

  return roundRate(Math.min(1, samples / 10));
}

function emptyPostureCounts(): Record<CalibrationPosture, number> {
  return {
    ready: 0,
    watch: 0,
    "needs-review": 0,
    "insufficient-data": 0
  };
}

export function deriveCalibrationInsights(params: {
  agents: AgentDefinition[];
  goals: GoalBundle[];
  evidenceRecords: EvidenceRecord[];
  storedMetrics?: AgentMetrics[];
  options?: Pick<CalibrationInsightParams, "agentId" | "period" | "limit">;
}): CalibrationInsights {
  const period: CalibrationPeriod = params.options?.period ?? "all";
  const eventLimit = clampEventLimit(params.options?.limit);
  const requestedAgent = params.options?.agentId?.trim() ?? "";
  const visibleAgents = requestedAgent
    ? params.agents.filter((agent) => agent.id === requestedAgent || agent.name === requestedAgent)
    : params.agents;
  const insights: AgentCalibrationInsight[] = visibleAgents.map((agent) => {
    const metrics = deriveAgentMetricsFromGoals({
      agent,
      period,
      goals: params.goals,
      evidenceRecords: params.evidenceRecords,
      storedMetrics: params.storedMetrics?.find((metric) => metric.agentId === agent.id && metric.period === period) ?? null
    });
    const posture = classifyPosture(metrics);
    const events = buildCalibrationEvents({
      agent,
      goals: params.goals,
      evidenceRecords: params.evidenceRecords
    }).slice(0, eventLimit);

    return {
      agentId: agent.id,
      agentName: agent.name,
      period,
      posture,
      summary: summarizePosture(metrics, posture),
      confidence: computeConfidence(metrics),
      metrics: pickCalibrationMetrics(metrics),
      signals: buildSignals(metrics, posture),
      events
    };
  });
  const postureCounts = emptyPostureCounts();

  for (const insight of insights) {
    postureCounts[insight.posture] += 1;
  }

  return {
    generatedAt: nowIso(),
    period,
    totalAgents: insights.length,
    agentsWithActivity: insights.filter((insight) => insight.posture !== "insufficient-data").length,
    postureCounts,
    insights,
    events: insights.flatMap((insight) => insight.events).sort(compareEventsDesc).slice(0, eventLimit)
  };
}
