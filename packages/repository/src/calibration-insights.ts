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

type CalibrationWindow = {
  startMs: number;
  endMs: number;
};

type AgentCalibrationInput = {
  goals: GoalBundle[];
  evidenceRecords: EvidenceRecord[];
};

function clampEventLimit(limit: number | null | undefined): number {
  if (limit === null || limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_CALIBRATION_EVENT_LIMIT;
  }

  return Math.min(MAX_CALIBRATION_EVENT_LIMIT, Math.max(1, Math.trunc(limit)));
}

function taskMatchesAgent(task: Task, agent: AgentDefinition): boolean {
  return task.assignedAgent === agent.id || task.assignedAgent === agent.name;
}

function resolveCalibrationWindow(period: CalibrationPeriod, now = new Date()): CalibrationWindow {
  const end = new Date(now);
  const start = new Date(now);

  if (period === "day") {
    start.setHours(0, 0, 0, 0);
  } else if (period === "week") {
    start.setHours(0, 0, 0, 0);
    const day = start.getDay();
    const diff = (day + 6) % 7;
    start.setDate(start.getDate() - diff);
  } else if (period === "month") {
    start.setHours(0, 0, 0, 0);
    start.setDate(1);
  } else {
    start.setTime(0);
  }

  return {
    startMs: start.getTime(),
    endMs: end.getTime()
  };
}

function parseTimestampMs(timestamp: string | null | undefined): number | null {
  if (!timestamp) {
    return null;
  }

  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

function isWithinCalibrationWindow(timestamp: string | null | undefined, window: CalibrationWindow): boolean {
  const parsed = parseTimestampMs(timestamp);
  return parsed !== null && parsed >= window.startMs && parsed <= window.endMs;
}

function isTaskInCalibrationWindow(task: Task, window: CalibrationWindow): boolean {
  return isWithinCalibrationWindow(task.createdAt, window);
}

function isEvidenceInCalibrationWindow(record: EvidenceRecord, window: CalibrationWindow): boolean {
  return (
    isWithinCalibrationWindow(record.respondedAt, window) ||
    isWithinCalibrationWindow(record.updatedAt, window) ||
    isWithinCalibrationWindow(record.createdAt, window)
  );
}

function resolveRequestedAgent(agents: AgentDefinition[], requestedAgent: string): AgentDefinition | null {
  if (!requestedAgent) {
    return null;
  }

  return (
    agents.find((agent) => agent.id === requestedAgent) ??
    agents.find((agent) => agent.name === requestedAgent) ??
    null
  );
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

function indexCalibrationInputsByAgent(params: {
  agents: AgentDefinition[];
  goals: GoalBundle[];
  evidenceRecords: EvidenceRecord[];
  period: CalibrationPeriod;
}): Map<string, AgentCalibrationInput> {
  const window = resolveCalibrationWindow(params.period);
  const agentById = new Map(params.agents.map((agent) => [agent.id, agent] as const));
  const agentByName = new Map(params.agents.map((agent) => [agent.name, agent] as const));
  const inputByAgentId = new Map<string, AgentCalibrationInput>(
    params.agents.map((agent) => [agent.id, { goals: [], evidenceRecords: [] }] as const)
  );
  const agentIdByTaskId = new Map<string, string>();

  for (const bundle of params.goals) {
    const taskGroups = new Map<string, Task[]>();

    for (const task of bundle.tasks) {
      if (!isTaskInCalibrationWindow(task, window)) {
        continue;
      }

      const agent = agentByName.get(task.assignedAgent) ?? agentById.get(task.assignedAgent);

      if (!agent) {
        continue;
      }

      agentIdByTaskId.set(task.id, agent.id);
      taskGroups.set(agent.id, [...(taskGroups.get(agent.id) ?? []), task]);
    }

    for (const [agentId, tasks] of taskGroups) {
      const taskIds = new Set(tasks.map((task) => task.id));
      const input = inputByAgentId.get(agentId);

      if (!input) {
        continue;
      }

      input.goals.push({
        ...bundle,
        tasks,
        approvals: bundle.approvals.filter(
          (approval) =>
            taskIds.has(approval.taskId) &&
            (isWithinCalibrationWindow(approval.respondedAt ?? approval.createdAt, window) ||
              isWithinCalibrationWindow(approval.createdAt, window))
        ),
        artifacts: bundle.artifacts.filter(
          (artifact) =>
            artifact.taskId !== undefined &&
            taskIds.has(artifact.taskId) &&
            isWithinCalibrationWindow(artifact.createdAt, window)
        ),
        actionLogs: bundle.actionLogs.filter(
          (log) =>
            log.taskId !== null &&
            log.taskId !== undefined &&
            taskIds.has(log.taskId) &&
            isWithinCalibrationWindow(log.createdAt, window)
        )
      });
    }
  }

  for (const record of params.evidenceRecords) {
    const agentId = agentIdByTaskId.get(record.taskId);

    if (!agentId || !isEvidenceInCalibrationWindow(record, window)) {
      continue;
    }

    inputByAgentId.get(agentId)?.evidenceRecords.push(record);
  }

  return inputByAgentId;
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
  const taskOutcomeCount = metrics.tasksCompleted + metrics.tasksFailed + metrics.tasksBlocked;
  const resolvedApprovalCount = metrics.approvalsApproved + metrics.approvalsRejected;
  const outcomeCount = taskOutcomeCount + Math.max(metrics.feedbackCount, resolvedApprovalCount);

  if (outcomeCount === 0) {
    return "insufficient-data";
  }

  if (metrics.postApprovalFailureRate >= 0.2 || metrics.tasksFailed + metrics.tasksBlocked > 0) {
    return "needs-review";
  }

  if (
    metrics.correctionRate >= 0.25 ||
    metrics.successRate < 0.8 ||
    (metrics.approvalsRequested > 0 && metrics.approvalRate < 0.5)
  ) {
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
  const taskOutcomeCount = metrics.tasksCompleted + metrics.tasksFailed + metrics.tasksBlocked;
  const resolvedApprovalCount = metrics.approvalsApproved + metrics.approvalsRejected;
  const samples = taskOutcomeCount + Math.max(metrics.feedbackCount, resolvedApprovalCount);

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
  const resolvedRequestedAgent = resolveRequestedAgent(params.agents, requestedAgent);
  const visibleAgents = requestedAgent ? (resolvedRequestedAgent ? [resolvedRequestedAgent] : []) : params.agents;
  const inputByAgentId = indexCalibrationInputsByAgent({
    agents: visibleAgents,
    goals: params.goals,
    evidenceRecords: params.evidenceRecords,
    period
  });
  const insights: AgentCalibrationInsight[] = visibleAgents.map((agent) => {
    const input = inputByAgentId.get(agent.id) ?? { goals: [], evidenceRecords: [] };
    const metrics = deriveAgentMetricsFromGoals({
      agent,
      period,
      goals: input.goals,
      evidenceRecords: input.evidenceRecords,
      storedMetrics: params.storedMetrics?.find((metric) => metric.agentId === agent.id && metric.period === period) ?? null
    });
    const posture = classifyPosture(metrics);
    const events = buildCalibrationEvents({
      agent,
      goals: input.goals,
      evidenceRecords: input.evidenceRecords
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
