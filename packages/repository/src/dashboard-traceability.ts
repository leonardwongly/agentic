import type {
  ActionLog,
  AgentName,
  ApprovalDecision,
  ApprovalRequest,
  Artifact,
  EvidenceRecord,
  GoalBundle,
  GoalStatus,
  JobRecord,
  MemoryRecord,
  MemoryType,
  RiskClass,
  TaskState
} from "@agentic/contracts";
import { getMemoryFreshness, type MemoryFreshness } from "@agentic/memory";

export type DashboardMemoryProvenance = {
  id: string;
  category: string;
  memoryType: MemoryType;
  freshness: MemoryFreshness;
  confidence: number;
  source: string;
  sensitivity: string;
  advisoryOnly: boolean;
  autonomyEligible: boolean;
  usedByGoalIds: string[];
  linkedEvidenceIds: string[];
  reviewRequired: boolean;
};

export type DashboardTaskTrace = {
  id: string;
  goalId: string;
  workflowId: string;
  title: string;
  summary: string;
  assignedAgent: AgentName;
  status: TaskState;
  riskClass: RiskClass;
  requiresApproval: boolean;
  dependencyIds: string[];
  artifactIds: string[];
  approvalIds: string[];
  failureCount: number;
  correctionCount: number;
  createdAt: string;
  updatedAt: string;
};

export type DashboardApprovalTrace = {
  id: string;
  goalId: string;
  taskId: string;
  title: string;
  riskClass: RiskClass;
  decision: ApprovalDecision;
  createdAt: string;
  respondedAt: string | null;
  evidenceIds: string[];
};

export type DashboardWorkflowTrace = {
  goalId: string;
  workflowId: string;
  title: string;
  status: GoalStatus;
  workspaceId: string | null;
  agents: AgentName[];
  taskCount: number;
  completedTaskCount: number;
  approvalCount: number;
  artifactCount: number;
  actionCount: number;
  failureCount: number;
  correctionCount: number;
  memoryIds: string[];
  staleMemoryIds: string[];
  inferredMemoryIds: string[];
  lastActivityAt: string;
};

export type DashboardTraceability = {
  generatedAt: string;
  workspaceId: string | null;
  workflowTraces: DashboardWorkflowTrace[];
  taskTraces: DashboardTaskTrace[];
  approvalTraces: DashboardApprovalTrace[];
  memoryProvenance: DashboardMemoryProvenance[];
  eventCount: number;
  artifactCount: number;
  jobCount: number;
  trustLane: {
    scopedMemoryCount: number;
    autonomyEligibleMemoryCount: number;
    advisoryInferredMemoryCount: number;
    staleOrReviewRequiredMemoryCount: number;
    blockedUnscopedMemoryCount: number;
    policy: string;
  };
};

export type BuildDashboardTraceabilityParams = {
  userId: string;
  activeWorkspaceId: string | null;
  goals: GoalBundle[];
  approvals: ApprovalRequest[];
  evidenceRecords: EvidenceRecord[];
  memories: MemoryRecord[];
  jobs?: JobRecord[];
  generatedAt: string;
  now?: number;
};

function uniqueSorted<T extends string>(values: Iterable<T>): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function extractContextPackMemoryIds(action: ActionLog): {
  selected: string[];
  stale: string[];
  reviewRequired: string[];
  conflicting: string[];
} {
  const details = isRecord(action.details) ? action.details : null;
  const contextPack = isRecord(details?.contextPack) ? details.contextPack : null;

  if (!contextPack) {
    return {
      selected: [],
      stale: [],
      reviewRequired: [],
      conflicting: []
    };
  }

  return {
    selected: readStringArray(contextPack.selectedMemoryIds),
    stale: readStringArray(contextPack.staleMemoryIds),
    reviewRequired: readStringArray(contextPack.reviewRequiredMemoryIds),
    conflicting: readStringArray(contextPack.conflictingMemoryIds)
  };
}

function actionLooksLikeFailure(action: ActionLog): boolean {
  const text = `${action.kind} ${action.message}`.toLowerCase();
  return (
    text.includes("fail") ||
    text.includes("error") ||
    text.includes("dead_letter") ||
    text.includes("dead-letter") ||
    text.includes("blocked")
  );
}

function actionLooksLikeCorrection(action: ActionLog): boolean {
  const text = `${action.kind} ${action.message}`.toLowerCase();
  return text.includes("correct") || text.includes("retry") || text.includes("refine") || text.includes("replay");
}

function latestIso(values: string[]): string {
  return values.filter(Boolean).sort((left, right) => right.localeCompare(left))[0] ?? new Date(0).toISOString();
}

export function buildDashboardTraceability(params: BuildDashboardTraceabilityParams): DashboardTraceability {
  const now = params.now ?? Date.now();
  const evidenceByGoalId = new Map<string, EvidenceRecord[]>();
  const approvalsByGoalId = new Map<string, ApprovalRequest[]>();
  const referencedMemoryIdsByGoalId = new Map<string, Set<string>>();
  const staleMemoryIdsByGoalId = new Map<string, Set<string>>();
  const reviewRequiredMemoryIds = new Set<string>();
  const evidenceIdsByMemoryId = new Map<string, Set<string>>();

  for (const evidence of params.evidenceRecords) {
    const records = evidenceByGoalId.get(evidence.goalId) ?? [];
    records.push(evidence);
    evidenceByGoalId.set(evidence.goalId, records);

    for (const memoryId of evidence.memoryIds) {
      const goalMemoryIds = referencedMemoryIdsByGoalId.get(evidence.goalId) ?? new Set<string>();
      goalMemoryIds.add(memoryId);
      referencedMemoryIdsByGoalId.set(evidence.goalId, goalMemoryIds);

      const evidenceIds = evidenceIdsByMemoryId.get(memoryId) ?? new Set<string>();
      evidenceIds.add(evidence.id);
      evidenceIdsByMemoryId.set(memoryId, evidenceIds);
    }
  }

  for (const approval of params.approvals) {
    const records = approvalsByGoalId.get(approval.goalId) ?? [];
    records.push(approval);
    approvalsByGoalId.set(approval.goalId, records);
  }

  for (const bundle of params.goals) {
    for (const action of bundle.actionLogs) {
      const context = extractContextPackMemoryIds(action);
      const goalMemoryIds = referencedMemoryIdsByGoalId.get(bundle.goal.id) ?? new Set<string>();
      const staleGoalMemoryIds = staleMemoryIdsByGoalId.get(bundle.goal.id) ?? new Set<string>();

      for (const memoryId of [...context.selected, ...context.stale, ...context.reviewRequired, ...context.conflicting]) {
        goalMemoryIds.add(memoryId);
      }

      for (const memoryId of [...context.stale, ...context.reviewRequired, ...context.conflicting]) {
        staleGoalMemoryIds.add(memoryId);
        reviewRequiredMemoryIds.add(memoryId);
      }

      referencedMemoryIdsByGoalId.set(bundle.goal.id, goalMemoryIds);
      staleMemoryIdsByGoalId.set(bundle.goal.id, staleGoalMemoryIds);
    }
  }

  const referencedMemoryIds = new Set(
    [...referencedMemoryIdsByGoalId.values()].flatMap((memoryIds) => [...memoryIds])
  );
  const memoryById = new Map(params.memories.map((memory) => [memory.id, memory]));
  const memoryProvenance: DashboardMemoryProvenance[] = [...referencedMemoryIds]
    .flatMap((memoryId) => {
      const memory = memoryById.get(memoryId);

      if (!memory) {
        return [];
      }

      const freshness = getMemoryFreshness(memory, now);
      const usedByGoalIds = [...referencedMemoryIdsByGoalId.entries()]
        .filter(([, memoryIds]) => memoryIds.has(memory.id))
        .map(([goalId]) => goalId)
        .sort((left, right) => left.localeCompare(right));
      const linkedEvidenceIds = uniqueSorted(evidenceIdsByMemoryId.get(memory.id) ?? []);
      const advisoryOnly = memory.memoryType === "inferred";
      const reviewRequired =
        reviewRequiredMemoryIds.has(memory.id) || freshness === "review_due" || freshness === "expired" || freshness === "low_confidence";

      return [
        {
          id: memory.id,
          category: memory.category,
          memoryType: memory.memoryType,
          freshness,
          confidence: memory.confidence,
          source: memory.source,
          sensitivity: memory.sensitivity,
          advisoryOnly,
          autonomyEligible: !advisoryOnly && freshness === "fresh",
          usedByGoalIds,
          linkedEvidenceIds,
          reviewRequired
        }
      ];
    })
    .sort((left, right) => left.category.localeCompare(right.category) || left.id.localeCompare(right.id));

  const memoryProvenanceById = new Map(memoryProvenance.map((memory) => [memory.id, memory]));
  const approvalTraces: DashboardApprovalTrace[] = params.approvals.map((approval) => ({
    id: approval.id,
    goalId: approval.goalId,
    taskId: approval.taskId,
    title: approval.title,
    riskClass: approval.riskClass,
    decision: approval.decision,
    createdAt: approval.createdAt,
    respondedAt: approval.respondedAt,
    evidenceIds: (evidenceByGoalId.get(approval.goalId) ?? [])
      .filter((evidence) => evidence.approvalId === approval.id)
      .map((evidence) => evidence.id)
      .sort((left, right) => left.localeCompare(right))
  }));

  const taskTraces: DashboardTaskTrace[] = params.goals.flatMap((bundle) => {
    const artifactsByTaskId = new Map<string, Artifact[]>();

    for (const artifact of bundle.artifacts) {
      if (!artifact.taskId) {
        continue;
      }

      const artifacts = artifactsByTaskId.get(artifact.taskId) ?? [];
      artifacts.push(artifact);
      artifactsByTaskId.set(artifact.taskId, artifacts);
    }

    return bundle.tasks.map((task) => {
      const taskApprovals = (approvalsByGoalId.get(bundle.goal.id) ?? []).filter((approval) => approval.taskId === task.id);
      const taskActions = bundle.actionLogs.filter((action) => action.taskId === task.id);
      const artifactIds = uniqueSorted([
        ...task.artifactIds,
        ...(artifactsByTaskId.get(task.id) ?? []).map((artifact) => artifact.id)
      ]);

      return {
        id: task.id,
        goalId: task.goalId,
        workflowId: task.workflowId,
        title: task.title,
        summary: task.summary,
        assignedAgent: task.assignedAgent,
        status: task.state,
        riskClass: task.riskClass,
        requiresApproval: task.requiresApproval,
        dependencyIds: uniqueSorted(task.dependsOn),
        artifactIds,
        approvalIds: taskApprovals.map((approval) => approval.id).sort((left, right) => left.localeCompare(right)),
        failureCount: taskActions.filter(actionLooksLikeFailure).length + (task.state === "failed" || task.state === "blocked" ? 1 : 0),
        correctionCount: taskActions.filter(actionLooksLikeCorrection).length,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt
      };
    });
  });

  const taskTracesByGoalId = new Map<string, DashboardTaskTrace[]>();
  for (const trace of taskTraces) {
    const traces = taskTracesByGoalId.get(trace.goalId) ?? [];
    traces.push(trace);
    taskTracesByGoalId.set(trace.goalId, traces);
  }

  const workflowTraces: DashboardWorkflowTrace[] = params.goals.map((bundle) => {
    const goalTaskTraces = taskTracesByGoalId.get(bundle.goal.id) ?? [];
    const goalApprovals = approvalsByGoalId.get(bundle.goal.id) ?? [];
    const goalMemoryIds = uniqueSorted(referencedMemoryIdsByGoalId.get(bundle.goal.id) ?? []);
    const staleMemoryIds = uniqueSorted(
      goalMemoryIds.filter((memoryId) => memoryProvenanceById.get(memoryId)?.reviewRequired ?? staleMemoryIdsByGoalId.get(bundle.goal.id)?.has(memoryId) ?? false)
    );
    const inferredMemoryIds = uniqueSorted(
      goalMemoryIds.filter((memoryId) => memoryProvenanceById.get(memoryId)?.memoryType === "inferred")
    );

    return {
      goalId: bundle.goal.id,
      workflowId: bundle.workflow.id,
      title: bundle.goal.title,
      status: bundle.goal.status,
      workspaceId: bundle.goal.workspaceId,
      agents: uniqueSorted(bundle.tasks.map((task) => task.assignedAgent)),
      taskCount: bundle.tasks.length,
      completedTaskCount: bundle.tasks.filter((task) => task.state === "completed").length,
      approvalCount: goalApprovals.length,
      artifactCount: bundle.artifacts.length,
      actionCount: bundle.actionLogs.length,
      failureCount: goalTaskTraces.reduce((sum, task) => sum + task.failureCount, 0),
      correctionCount: goalTaskTraces.reduce((sum, task) => sum + task.correctionCount, 0),
      memoryIds: goalMemoryIds,
      staleMemoryIds,
      inferredMemoryIds,
      lastActivityAt: latestIso([
        bundle.goal.updatedAt,
        bundle.workflow.updatedAt,
        ...bundle.tasks.map((task) => task.updatedAt),
        ...bundle.actionLogs.map((action) => action.createdAt),
        ...bundle.artifacts.map((artifact) => artifact.createdAt),
        ...goalApprovals.map((approval) => approval.respondedAt ?? approval.createdAt)
      ])
    };
  });

  const blockedUnscopedMemoryCount = params.memories.filter((memory) => !referencedMemoryIds.has(memory.id)).length;
  const advisoryInferredMemoryCount = memoryProvenance.filter((memory) => memory.advisoryOnly).length;
  const autonomyEligibleMemoryCount = memoryProvenance.filter((memory) => memory.autonomyEligible).length;
  const staleOrReviewRequiredMemoryCount = memoryProvenance.filter((memory) => memory.reviewRequired).length;

  return {
    generatedAt: params.generatedAt,
    workspaceId: params.activeWorkspaceId,
    workflowTraces,
    taskTraces,
    approvalTraces,
    memoryProvenance,
    eventCount: params.goals.reduce((sum, bundle) => sum + bundle.actionLogs.length, 0),
    artifactCount: params.goals.reduce((sum, bundle) => sum + bundle.artifacts.length, 0),
    jobCount: params.jobs?.length ?? 0,
    trustLane: {
      scopedMemoryCount: memoryProvenance.length,
      autonomyEligibleMemoryCount,
      advisoryInferredMemoryCount,
      staleOrReviewRequiredMemoryCount,
      blockedUnscopedMemoryCount,
      policy: "Only memories linked by scoped goal evidence or context packets are shown. Inferred memory is advisory and cannot independently justify autonomy."
    }
  };
}
