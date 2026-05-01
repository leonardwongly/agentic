import {
  AgentMetricsSchema,
  nowIso,
  type AgentDefinition,
  type AgentMetrics,
  type EvidenceRecord,
  type GoalBundle,
  type Task
} from "@agentic/contracts";

type MetricsPeriod = "day" | "week" | "month" | "all";

type MetricsWindow = {
  periodStart: string;
  periodEnd: string;
  startMs: number;
  endMs: number;
};

function parseTimestampMs(timestamp: string | null | undefined): number | null {
  if (!timestamp) {
    return null;
  }

  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveMetricsWindow(period: MetricsPeriod, now = new Date()): MetricsWindow {
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
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    startMs: start.getTime(),
    endMs: end.getTime()
  };
}

function isWithinMetricsWindow(timestamp: string | null | undefined, window: MetricsWindow): boolean {
  const parsed = parseTimestampMs(timestamp);
  return parsed !== null && parsed >= window.startMs && parsed <= window.endMs;
}

function taskMatchesAgent(task: Task, agent: AgentDefinition): boolean {
  return task.assignedAgent === agent.id || task.assignedAgent === agent.name;
}

function taskReachedMetricsWindow(task: Task, window: MetricsWindow): boolean {
  return isWithinMetricsWindow(task.createdAt, window) || isWithinMetricsWindow(task.updatedAt, window);
}

function averageFrom(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function deriveAgentMetricsFromGoals(params: {
  agent: AgentDefinition;
  period: MetricsPeriod;
  goals: GoalBundle[];
  evidenceRecords: EvidenceRecord[];
  storedMetrics?: AgentMetrics | null;
}): AgentMetrics {
  const window = resolveMetricsWindow(params.period);
  const matchingTasks = params.goals
    .flatMap((bundle) => bundle.tasks)
    .filter((task) => taskMatchesAgent(task, params.agent) && taskReachedMetricsWindow(task, window));
  const matchingTaskIds = new Set(matchingTasks.map((task) => task.id));

  const matchingApprovals = params.goals
    .flatMap((bundle) => bundle.approvals)
    .filter(
      (approval) =>
        matchingTaskIds.has(approval.taskId) &&
        (isWithinMetricsWindow(approval.respondedAt ?? approval.createdAt, window) ||
          isWithinMetricsWindow(approval.createdAt, window))
    );
  const matchingArtifacts = params.goals
    .flatMap((bundle) => bundle.artifacts)
    .filter((artifact) => artifact.taskId && matchingTaskIds.has(artifact.taskId) && isWithinMetricsWindow(artifact.createdAt, window));
  const matchingLogs = params.goals
    .flatMap((bundle) => bundle.actionLogs)
    .filter((log) => log.taskId && matchingTaskIds.has(log.taskId) && isWithinMetricsWindow(log.createdAt, window));
  const matchingEvidenceRecords = params.evidenceRecords.filter(
    (record) =>
      matchingTaskIds.has(record.taskId) &&
      (isWithinMetricsWindow(record.respondedAt, window) ||
        isWithinMetricsWindow(record.updatedAt, window) ||
        isWithinMetricsWindow(record.createdAt, window))
  );

  const confidenceSamples = matchingLogs.flatMap((log) => {
    const confidence = typeof log.details.confidence === "number" ? log.details.confidence : null;
    return confidence !== null && Number.isFinite(confidence) ? [confidence] : [];
  });

  const executionDurations = matchingTasks.flatMap((task) => {
    if (task.state !== "completed" && task.state !== "failed" && task.state !== "blocked") {
      return [];
    }

    const createdMs = parseTimestampMs(task.createdAt);
    const updatedMs = parseTimestampMs(task.updatedAt);

    if (createdMs === null || updatedMs === null || updatedMs < createdMs) {
      return [];
    }

    return [updatedMs - createdMs];
  });

  const artifactsByType = matchingArtifacts.reduce<Record<string, number>>((counts, artifact) => {
    counts[artifact.artifactType] = (counts[artifact.artifactType] ?? 0) + 1;
    return counts;
  }, {});

  const errorTasks = matchingTasks.filter((task) => task.state === "failed" || task.state === "blocked");
  const latestErrorTask = [...errorTasks].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
  const userCorrectionCount = matchingEvidenceRecords.filter((record) => record.decision === "rejected").length;
  const postApprovalFailureCount = matchingEvidenceRecords.filter(
    (record) =>
      record.decision === "approved" &&
      (record.resultingTaskState === "failed" || record.resultingTaskState === "blocked")
  ).length;

  const tasksTotal = matchingTasks.length;
  const approvalsRequested = matchingApprovals.length;
  const approvalsApproved = matchingApprovals.filter((approval) => approval.decision === "approved").length;
  const approvalsRejected = matchingApprovals.filter((approval) => approval.decision === "rejected").length;
  const feedbackCount = matchingEvidenceRecords.length > 0 ? matchingEvidenceRecords.length : approvalsApproved + approvalsRejected;
  const derivedMetrics = AgentMetricsSchema.parse({
    agentId: params.agent.id,
    period: params.period,
    periodStart: window.periodStart,
    periodEnd: window.periodEnd,
    tasksTotal,
    tasksCompleted: matchingTasks.filter((task) => task.state === "completed").length,
    tasksFailed: matchingTasks.filter((task) => task.state === "failed").length,
    tasksBlocked: matchingTasks.filter((task) => task.state === "blocked").length,
    approvalsRequested,
    approvalsApproved,
    approvalsRejected,
    averageConfidence: averageFrom(confidenceSamples) ?? 0,
    averageExecutionTimeMs: (() => {
      const average = averageFrom(executionDurations);
      return average === null ? 0 : Math.round(average);
    })(),
    artifactsProduced: matchingArtifacts.length,
    artifactsByType,
    errorCount: errorTasks.length,
    lastErrorAt: latestErrorTask?.updatedAt ?? null,
    lastErrorMessage: latestErrorTask ? `${latestErrorTask.title} ended in ${latestErrorTask.state}.` : null,
    feedbackCount,
    userCorrectionCount,
    postApprovalFailureCount,
    averageRating: null,
    successRate: tasksTotal > 0 ? matchingTasks.filter((task) => task.state === "completed").length / tasksTotal : 0,
    approvalRate: approvalsRequested > 0 ? approvalsApproved / approvalsRequested : 0,
    correctionRate: feedbackCount > 0 ? userCorrectionCount / feedbackCount : 0,
    postApprovalFailureRate: approvalsApproved > 0 ? postApprovalFailureCount / approvalsApproved : 0,
    updatedAt: nowIso()
  });

  const hasDerivedActivity =
    tasksTotal > 0 ||
    approvalsRequested > 0 ||
    matchingArtifacts.length > 0 ||
    matchingLogs.length > 0 ||
    matchingEvidenceRecords.length > 0 ||
    errorTasks.length > 0;

  if (!hasDerivedActivity && params.storedMetrics) {
    return AgentMetricsSchema.parse({
      ...params.storedMetrics,
      period: params.period,
      periodStart: window.periodStart,
      periodEnd: window.periodEnd
    });
  }

  return derivedMetrics;
}
