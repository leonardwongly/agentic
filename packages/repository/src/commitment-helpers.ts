import {
  CommitmentSchema,
  DEFAULT_COMMITMENT_INBOX_BUCKET,
  DEFAULT_COMMITMENT_INBOX_LIMIT,
  MAX_COMMITMENT_INBOX_LIMIT,
  clone,
  commitmentInboxBucketValues,
  type ApprovalRequest,
  type Commitment,
  type CommitmentInboxBucket,
  type CommitmentInboxPage,
  type CommitmentSuggestedAction,
  type CommitmentUrgency,
  type GoalBundle,
  type MemoryRecord,
  type Task,
  type Watcher
} from "@agentic/contracts";
import { detectMemoryConflicts, getMemoryFreshness } from "@agentic/memory";
import type { DashboardDiagnostic, DashboardDiagnostics } from "./repository-types";
import type { DashboardOperationsTower } from "./dashboard-operations";

const STALLED_WORKFLOW_MS = 30 * 60 * 1000;
const APPROVAL_WAIT_SLA_MS = 6 * 60 * 60 * 1000;

const riskClassWeight: Record<NonNullable<Commitment["riskClass"]>, number> = {
  R1: 1,
  R2: 2,
  R3: 3,
  R4: 4
};

export class CommitmentInboxQueryError extends Error {
  constructor(
    public readonly code: "invalid_cursor",
    message: string
  ) {
    super(message);
    this.name = "CommitmentInboxQueryError";
  }
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function formatAgeAgo(timestamp: string, now: number): string {
  const parsed = Date.parse(timestamp);

  if (!Number.isFinite(parsed)) {
    return "recently";
  }

  const deltaMs = Math.max(0, now - parsed);
  const minutes = Math.floor(deltaMs / (60 * 1000));

  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 48) {
    return `${hours}h ago`;
  }

  return `${Math.floor(hours / 24)}d ago`;
}

function parseTimestampMs(timestamp: string | null | undefined): number | null {
  if (!timestamp) {
    return null;
  }

  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

export function commitmentIdForGoal(goalId: string): string {
  return `commitment-goal-${goalId}`;
}

export function commitmentIdForApproval(approvalId: string): string {
  return `commitment-approval-${approvalId}`;
}

function maxRiskClass(
  values: Array<Commitment["riskClass"] | Task["riskClass"] | ApprovalRequest["riskClass"] | null | undefined>
): Commitment["riskClass"] {
  let strongest: Commitment["riskClass"] = null;

  for (const value of values) {
    if (!value) {
      continue;
    }

    if (!strongest || riskClassWeight[value] > riskClassWeight[strongest]) {
      strongest = value;
    }
  }

  return strongest;
}

function deriveCommitmentUrgency(
  commitment: Pick<Commitment, "status" | "dueAt" | "confidence" | "riskClass">,
  now: number
): CommitmentUrgency {
  const dueAtMs = parseTimestampMs(commitment.dueAt);

  if (
    commitment.status === "needs-review" ||
    commitment.status === "stale" ||
    (dueAtMs !== null && dueAtMs <= now + 6 * 60 * 60 * 1000)
  ) {
    return "immediate";
  }

  if (
    commitment.status === "blocked" ||
    commitment.confidence < 0.75 ||
    commitment.riskClass === "R4" ||
    (dueAtMs !== null && dueAtMs <= now + 24 * 60 * 60 * 1000)
  ) {
    return "today";
  }

  if (
    commitment.status === "pending" ||
    commitment.status === "scheduled" ||
    (dueAtMs !== null && dueAtMs <= now + 72 * 60 * 60 * 1000)
  ) {
    return "soon";
  }

  return "later";
}

function deriveFallbackSuggestedAction(commitment: Commitment): CommitmentSuggestedAction | null {
  const primaryEvidence = commitment.evidence[0];

  if (!primaryEvidence) {
    return null;
  }

  if (primaryEvidence.section === "approvals") {
    return {
      kind: "review_approval",
      label: "Review approval",
      section: primaryEvidence.section,
      itemId: primaryEvidence.itemId
    };
  }

  return {
    kind: commitment.status === "blocked" ? "resolve_blocker" : "review_source",
    label: commitment.status === "blocked" ? "Inspect workflow" : "Review source",
    section: primaryEvidence.section,
    itemId: primaryEvidence.itemId
  };
}

function enrichCommitment(commitment: Commitment, now: number): Commitment {
  return CommitmentSchema.parse({
    ...commitment,
    urgency: commitment.urgency ?? deriveCommitmentUrgency(commitment, now),
    provenanceSummary:
      commitment.provenanceSummary?.trim() ||
      (commitment.sourceKind === "approval"
        ? "Derived from a pending approval gate before execution."
        : "Derived from active goal execution."),
    suggestedNextAction: commitment.suggestedNextAction ?? deriveFallbackSuggestedAction(commitment)
  });
}

function buildGoalCommitment(bundle: GoalBundle, now: number): Commitment | null {
  if (bundle.goal.status === "completed") {
    return null;
  }

  const pendingApprovals = bundle.approvals.filter((approval) => approval.decision === "pending");
  const blockedTasks = bundle.tasks.filter((task) => task.state === "blocked" || task.state === "failed");
  const waitingTasks = bundle.tasks.filter((task) => task.state === "waiting");
  const dueAt = pendingApprovals.reduce<string | null>((soonest, approval) => {
    if (!soonest) {
      return approval.expiryAt;
    }

    return approval.expiryAt.localeCompare(soonest) < 0 ? approval.expiryAt : soonest;
  }, null);
  const status =
    pendingApprovals.length > 0
      ? "needs-review"
      : blockedTasks.length > 0 || waitingTasks.length > 0 || bundle.goal.status === "waiting"
        ? "blocked"
        : bundle.goal.status === "planned"
          ? "scheduled"
          : "pending";

  const summaryParts = [
    pendingApprovals.length > 0 ? `${pluralize(pendingApprovals.length, "approval")} waiting` : null,
    blockedTasks.length > 0 ? `${pluralize(blockedTasks.length, "task")} blocked or failed` : null,
    waitingTasks.length > 0 ? `${pluralize(waitingTasks.length, "task")} waiting` : null,
    pendingApprovals.length === 0 && blockedTasks.length === 0 && waitingTasks.length === 0
      ? bundle.goal.explanation
      : null
  ].filter((part): part is string => part !== null);
  const riskClass = maxRiskClass([
    ...pendingApprovals.map((approval) => approval.riskClass),
    ...bundle.tasks
      .filter((task) => task.state !== "completed")
      .map((task) => task.riskClass)
  ]);
  const urgency = deriveCommitmentUrgency(
    {
      status,
      dueAt,
      confidence: bundle.goal.confidence,
      riskClass
    },
    now
  );

  return CommitmentSchema.parse({
    id: commitmentIdForGoal(bundle.goal.id),
    userId: bundle.goal.userId,
    title: bundle.goal.title,
    summary: summaryParts.join(" · "),
    status,
    sourceKind: "goal",
    sourceId: bundle.goal.id,
    goalId: bundle.goal.id,
    approvalId: null,
    dueAt,
    urgency,
    riskClass,
    confidence: bundle.goal.confidence,
    provenanceSummary:
      pendingApprovals.length > 0
        ? `Derived from goal execution and ${pluralize(pendingApprovals.length, "pending approval")}.`
        : blockedTasks.length > 0 || waitingTasks.length > 0 || bundle.goal.status === "waiting"
          ? "Derived from goal execution and active workflow blockers."
          : "Derived from active goal execution.",
    suggestedNextAction:
      pendingApprovals.length > 0
        ? {
            kind: "review_approval",
            label: pendingApprovals.length === 1 ? "Review approval" : "Review approvals",
            section: "approvals",
            itemId: pendingApprovals[0]!.id
          }
        : {
            kind:
              blockedTasks.length > 0 || waitingTasks.length > 0 || bundle.goal.status === "waiting"
                ? "resolve_blocker"
                : "continue_goal",
            label:
              blockedTasks.length > 0 || waitingTasks.length > 0 || bundle.goal.status === "waiting"
                ? "Inspect workflow"
                : "Continue workflow",
            section: "goals",
            itemId: bundle.goal.id
          },
    evidence: [
      {
        section: "goals",
        itemId: bundle.goal.id,
        label: bundle.goal.title
      }
    ],
    createdAt: bundle.goal.createdAt,
    updatedAt: bundle.goal.updatedAt
  });
}

function buildApprovalCommitment(
  approval: ApprovalRequest,
  goalTitleById: Map<string, string>,
  userId: string,
  now: number
): Commitment | null {
  if (approval.decision !== "pending") {
    return null;
  }

  const isExpired = Date.parse(approval.expiryAt) <= now;
  const goalTitle = goalTitleById.get(approval.goalId) ?? approval.goalId;
  const status = isExpired ? "stale" : "needs-review";
  const urgency = deriveCommitmentUrgency(
    {
      status,
      dueAt: approval.expiryAt,
      confidence: 0.98,
      riskClass: approval.riskClass
    },
    now
  );

  return CommitmentSchema.parse({
    id: commitmentIdForApproval(approval.id),
    userId,
    title: approval.title,
    summary: `${approval.requestedAction} for ${goalTitle}`,
    status,
    sourceKind: "approval",
    sourceId: approval.id,
    goalId: approval.goalId,
    approvalId: approval.id,
    dueAt: approval.expiryAt,
    urgency,
    riskClass: approval.riskClass,
    confidence: 0.98,
    provenanceSummary: "Derived from a pending approval gate before execution.",
    suggestedNextAction: {
      kind: "review_approval",
      label: "Review approval",
      section: "approvals",
      itemId: approval.id
    },
    evidence: [
      {
        section: "approvals",
        itemId: approval.id,
        label: approval.title
      },
      {
        section: "goals",
        itemId: approval.goalId,
        label: goalTitle
      }
    ],
    createdAt: approval.createdAt,
    updatedAt: approval.respondedAt ?? approval.createdAt
  });
}

export function sortCommitments(commitments: Commitment[]): Commitment[] {
  const statusWeight: Record<Commitment["status"], number> = {
    "needs-review": 0,
    stale: 1,
    blocked: 2,
    pending: 3,
    scheduled: 4,
    completed: 5,
    dismissed: 6
  };

  return [...commitments].sort((left, right) => {
    const leftWeight = statusWeight[left.status];
    const rightWeight = statusWeight[right.status];

    if (leftWeight !== rightWeight) {
      return leftWeight - rightWeight;
    }

    const leftDueAt = left.dueAt ?? "9999-12-31T23:59:59.999Z";
    const rightDueAt = right.dueAt ?? "9999-12-31T23:59:59.999Z";

    if (leftDueAt !== rightDueAt) {
      return leftDueAt.localeCompare(rightDueAt);
    }

    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

export function isOpenCommitment(commitment: Commitment): boolean {
  return commitment.status !== "completed" && commitment.status !== "dismissed";
}

function isUrgentCommitment(commitment: Commitment, now: number): boolean {
  if (!isOpenCommitment(commitment)) {
    return false;
  }

  if (commitment.status === "needs-review" || commitment.status === "stale") {
    return true;
  }

  if (!commitment.dueAt) {
    return false;
  }

  return Date.parse(commitment.dueAt) <= now + 24 * 60 * 60 * 1000;
}

function isDueSoonCommitment(commitment: Commitment, now: number): boolean {
  if (!isOpenCommitment(commitment) || isUrgentCommitment(commitment, now) || !commitment.dueAt) {
    return false;
  }

  const dueAt = Date.parse(commitment.dueAt);
  return dueAt <= now + 72 * 60 * 60 * 1000;
}

function isWaitingOnOthersCommitment(commitment: Commitment): boolean {
  return commitment.status === "scheduled" || commitment.status === "blocked";
}

function isUnresolvedCommitment(commitment: Commitment): boolean {
  return commitment.status === "pending" || commitment.status === "needs-review" || commitment.status === "stale";
}

function isLowConfidenceCommitment(commitment: Commitment): boolean {
  return isOpenCommitment(commitment) && commitment.confidence < 0.75;
}

function matchesCommitmentInboxBucket(
  commitment: Commitment,
  bucket: CommitmentInboxBucket,
  now: number
): boolean {
  switch (bucket) {
    case "all":
      return true;
    case "unresolved":
      return isUnresolvedCommitment(commitment);
    case "urgent":
      return isUrgentCommitment(commitment, now);
    case "due_soon":
      return isDueSoonCommitment(commitment, now);
    case "waiting_on_others":
      return isWaitingOnOthersCommitment(commitment);
    case "low_confidence":
      return isLowConfidenceCommitment(commitment);
    case "completed":
      return commitment.status === "completed";
  }
}

function encodeCommitmentInboxCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function decodeCommitmentInboxCursor(cursor: string): number {
  try {
    const payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { offset?: unknown };
    if (typeof payload.offset !== "number" || !Number.isInteger(payload.offset) || payload.offset < 0) {
      throw new CommitmentInboxQueryError("invalid_cursor", "The commitment inbox cursor is invalid.");
    }

    return payload.offset;
  } catch (error) {
    if (error instanceof CommitmentInboxQueryError) {
      throw error;
    }

    throw new CommitmentInboxQueryError("invalid_cursor", "The commitment inbox cursor is invalid.");
  }
}

export function buildCommitmentInboxPage(params: {
  commitments: Commitment[];
  bucket?: CommitmentInboxBucket;
  limit?: number;
  cursor?: string | null;
  now?: number;
}): CommitmentInboxPage {
  const bucket = params.bucket ?? DEFAULT_COMMITMENT_INBOX_BUCKET;
  const limit = Math.min(Math.max(params.limit ?? DEFAULT_COMMITMENT_INBOX_LIMIT, 1), MAX_COMMITMENT_INBOX_LIMIT);
  const now = params.now ?? Date.now();
  const startIndex = params.cursor ? decodeCommitmentInboxCursor(params.cursor) : 0;
  const counts = Object.fromEntries(
    commitmentInboxBucketValues.map((bucketValue) => [
      bucketValue,
      params.commitments.filter((commitment) => matchesCommitmentInboxBucket(commitment, bucketValue, now)).length
    ])
  ) as Record<CommitmentInboxBucket, number>;
  const filtered = params.commitments.filter((commitment) => matchesCommitmentInboxBucket(commitment, bucket, now));

  if (startIndex > filtered.length) {
    throw new CommitmentInboxQueryError("invalid_cursor", "The commitment inbox cursor is invalid.");
  }

  const items = filtered.slice(startIndex, startIndex + limit);
  const nextCursor = startIndex + items.length < filtered.length ? encodeCommitmentInboxCursor(startIndex + items.length) : null;

  return {
    bucket,
    items: items.map((commitment) => CommitmentSchema.parse(clone(commitment))),
    counts,
    totalCount: filtered.length,
    limit,
    nextCursor,
    generatedAt: new Date(now).toISOString()
  };
}

export function mergeCommitments(params: {
  goals: GoalBundle[];
  approvals: ApprovalRequest[];
  persisted: Commitment[];
  userId: string;
  now?: number;
}): Commitment[] {
  const now = params.now ?? Date.now();
  const goalTitleById = new Map(params.goals.map((bundle) => [bundle.goal.id, bundle.goal.title]));
  const derived = [
    ...params.goals.map((bundle) => buildGoalCommitment(bundle, now)),
    ...params.approvals.map((approval) => buildApprovalCommitment(approval, goalTitleById, params.userId, now))
  ].filter((commitment): commitment is Commitment => commitment !== null);
  const persistedById = new Map(
    params.persisted
      .filter((commitment) => commitment.userId === params.userId)
      .map((commitment) => [commitment.id, commitment] as const)
  );

  const merged = derived.map((commitment) => {
    const persisted = persistedById.get(commitment.id);

    if (!persisted) {
      return commitment;
    }

    return CommitmentSchema.parse({
      ...commitment,
      status:
        persisted.status === "completed" || persisted.status === "dismissed"
          ? persisted.status
          : commitment.status,
      updatedAt:
        persisted.status === "completed" || persisted.status === "dismissed"
          ? persisted.updatedAt
          : commitment.updatedAt
    });
  });

  const derivedIds = new Set(derived.map((commitment) => commitment.id));
  const persistedOnly = params.persisted.filter(
    (commitment) => commitment.userId === params.userId && !derivedIds.has(commitment.id)
  );

  return sortCommitments([...merged, ...persistedOnly]).map((commitment) => enrichCommitment(commitment, now));
}

export function buildDashboardDiagnostics(params: {
  goals: GoalBundle[];
  approvals: ApprovalRequest[];
  memories: MemoryRecord[];
  watchers: Watcher[];
  operations?: DashboardOperationsTower;
  now?: number;
}): DashboardDiagnostics {
  const now = params.now ?? Date.now();
  const goalTitleById = new Map(params.goals.map((bundle) => [bundle.goal.id, bundle.goal.title]));
  const goalStatusById = new Map(params.goals.map((bundle) => [bundle.goal.id, bundle.goal.status]));

  const expiredApprovals = params.approvals.filter((approval) => {
    if (approval.decision !== "pending") {
      return false;
    }

    return Date.parse(approval.expiryAt) <= now;
  });

  const staleMemories = params.memories.flatMap((record) => {
    const freshness = getMemoryFreshness(record, now);
    return freshness === "fresh"
      ? []
      : [{
          id: record.id,
          category: record.category,
          content: record.content,
          freshness
        }];
  });

  const staleMemoryCounts = staleMemories.reduce<Record<string, number>>((counts, freshness) => {
    counts[freshness.freshness] = (counts[freshness.freshness] ?? 0) + 1;
    return counts;
  }, {});
  const conflictingMemories = detectMemoryConflicts(params.memories, {
    now
  });
  const memoryById = new Map(params.memories.map((record) => [record.id, record]));

  const stuckWorkflows = params.goals
    .map((bundle) => {
      const blockedTasks = bundle.tasks.filter((task) => task.state === "blocked");
      const failedTasks = bundle.tasks.filter((task) => task.state === "failed");
      const pendingApprovals = bundle.approvals.filter((approval) => approval.decision === "pending");
      const latestProgressAt = [
        parseTimestampMs(bundle.goal.updatedAt),
        parseTimestampMs(bundle.workflow.updatedAt),
        ...bundle.tasks.map((task) => parseTimestampMs(task.updatedAt)),
        ...bundle.approvals.map((approval) => parseTimestampMs(approval.respondedAt ?? approval.createdAt))
      ].reduce<number | null>((latest, candidate) => {
        if (candidate === null) {
          return latest;
        }

        return latest === null ? candidate : Math.max(latest, candidate);
      }, null);
      const oldestPendingApproval = pendingApprovals.reduce<ApprovalRequest | null>((oldest, approval) => {
        if (!oldest) {
          return approval;
        }

        return Date.parse(approval.createdAt) < Date.parse(oldest.createdAt) ? approval : oldest;
      }, null);
      const reasons = [
        failedTasks.length > 0 ? pluralize(failedTasks.length, "failed task") : null,
        blockedTasks.length > 0 ? pluralize(blockedTasks.length, "blocked task") : null,
        oldestPendingApproval && now - Date.parse(oldestPendingApproval.createdAt) >= APPROVAL_WAIT_SLA_MS
          ? `${pluralize(pendingApprovals.length, "pending approval")} waiting since ${formatAgeAgo(oldestPendingApproval.createdAt, now)}`
          : null,
        blockedTasks.length === 0 &&
        failedTasks.length === 0 &&
        bundle.goal.status !== "completed" &&
        latestProgressAt !== null &&
        now - latestProgressAt >= STALLED_WORKFLOW_MS
          ? `last progress ${formatAgeAgo(new Date(latestProgressAt).toISOString(), now)}`
          : null
      ].filter((reason): reason is string => reason !== null);

      if (reasons.length === 0) {
        return null;
      }

      return {
        goalId: bundle.goal.id,
        title: bundle.goal.title,
        reasons
      };
    })
    .filter((bundle): bundle is NonNullable<typeof bundle> => bundle !== null);

  const orphanWatchers = params.watchers.filter((watcher) => {
    if (watcher.status !== "active") {
      return false;
    }

    return goalStatusById.get(watcher.goalId) === "completed";
  });

  const items: DashboardDiagnostic[] = [];

  if (expiredApprovals.length > 0) {
    items.push({
      kind: "expired_approvals",
      title: "Expired approvals",
      count: expiredApprovals.length,
      severity: "critical",
      reasons: expiredApprovals
        .slice(0, 3)
        .map(
          (approval) =>
            `${approval.title} for ${goalTitleById.get(approval.goalId) ?? approval.goalId} expired ${formatAgeAgo(approval.expiryAt, now)}`
        ),
      targets: expiredApprovals.slice(0, 3).map((approval) => ({
        section: "approvals",
        itemId: approval.id,
        label: approval.title
      }))
    });
  }

  if (staleMemories.length > 0) {
    items.push({
      kind: "stale_memories",
      title: "Stale memories",
      count: staleMemories.length,
      severity: "warning",
      reasons: [
        staleMemoryCounts.review_due ? `${pluralize(staleMemoryCounts.review_due, "memory")} overdue for review` : null,
        staleMemoryCounts.expired ? `${pluralize(staleMemoryCounts.expired, "memory")} expired` : null,
        staleMemoryCounts.low_confidence ? `${pluralize(staleMemoryCounts.low_confidence, "memory")} low confidence` : null
      ].filter((reason): reason is string => reason !== null),
      targets: staleMemories.slice(0, 3).map((memory) => ({
        section: "memory",
        itemId: memory.id,
        label: `${memory.category}: ${memory.content.slice(0, 36)}${memory.content.length > 36 ? "..." : ""}`,
        action: "review_memory" as const,
        actionLabel: "Review"
      }))
    });
  }

  if (conflictingMemories.length > 0) {
    const conflictTargets = [...new Set(conflictingMemories.flatMap((conflict) => conflict.memoryIds))]
      .slice(0, 3)
      .flatMap((memoryId) => {
        const memory = memoryById.get(memoryId);

        if (!memory) {
          return [];
        }

        return [{
          section: "memory" as const,
          itemId: memory.id,
          label: `${memory.category}: ${memory.content.slice(0, 36)}${memory.content.length > 36 ? "..." : ""}`,
          action: "review_memory" as const,
          actionLabel: "Review"
        }];
      });

    items.push({
      kind: "context_conflicts",
      title: "Conflicting context",
      count: conflictingMemories.length,
      severity: "warning",
      reasons: conflictingMemories.slice(0, 3).map((conflict) => conflict.reason),
      targets: conflictTargets
    });
  }

  if (stuckWorkflows.length > 0) {
    items.push({
      kind: "stuck_workflows",
      title: "Stuck workflows",
      count: stuckWorkflows.length,
      severity: "critical",
      reasons: stuckWorkflows.slice(0, 3).map((workflow) => `${workflow.title}: ${workflow.reasons.join(", ")}`),
      targets: stuckWorkflows.slice(0, 3).map((workflow) => ({
        section: "goals",
        itemId: workflow.goalId,
        label: workflow.title
      }))
    });
  }

  if (orphanWatchers.length > 0) {
    items.push({
      kind: "orphan_watchers",
      title: "Active watchers on completed goals",
      count: orphanWatchers.length,
      severity: "warning",
      reasons: orphanWatchers
        .slice(0, 3)
        .map((watcher) => `${watcher.targetEntity} watcher is still active for ${goalTitleById.get(watcher.goalId) ?? watcher.goalId}`),
      targets: orphanWatchers.slice(0, 3).map((watcher) => ({
        section: "watchers",
        itemId: watcher.id,
        label: watcher.targetEntity,
        action: "pause_watcher" as const,
        actionLabel: "Pause"
      }))
    });
  }

  if ((params.operations?.asyncExecution.issueCount ?? 0) > 0) {
    items.push({
      kind: "async_execution_issues",
      title: "Async execution issues",
      count: params.operations!.asyncExecution.issueCount,
      severity: params.operations!.asyncExecution.status === "critical" ? "critical" : "warning",
      reasons: [
        params.operations!.asyncExecution.deadLetterJobs > 0
          ? `${pluralize(params.operations!.asyncExecution.deadLetterJobs, "dead-letter job")} need operator recovery`
          : null,
        params.operations!.asyncExecution.expiredLeaseCount > 0
          ? `${pluralize(params.operations!.asyncExecution.expiredLeaseCount, "expired lease")} are still marked running`
          : null,
        params.operations!.asyncExecution.stalePendingCount > 0
          ? `${pluralize(params.operations!.asyncExecution.stalePendingCount, "stale pending job")} breached the queue age threshold`
          : null,
        params.operations!.asyncExecution.retryingJobs > 0
          ? `${pluralize(params.operations!.asyncExecution.retryingJobs, "retrying job")} still need worker follow-through`
          : null
      ].filter((reason): reason is string => reason !== null),
      targets: params.operations!.asyncExecution.items.slice(0, 3).map((item) => ({
        section: "operations",
        itemId: item.id,
        label: item.label
      }))
    });
  }

  if ((params.operations?.connectorHealth.issueCount ?? 0) > 0) {
    items.push({
      kind: "connector_degradation",
      title: "Connector degradation",
      count: params.operations!.connectorHealth.issueCount,
      severity: params.operations!.connectorHealth.status === "critical" ? "critical" : "warning",
      reasons: [
        params.operations!.connectorHealth.reconnectRequiredCount > 0
          ? `${pluralize(params.operations!.connectorHealth.reconnectRequiredCount, "connector")} require re-authentication`
          : null,
        params.operations!.connectorHealth.revokedCount > 0
          ? `${pluralize(params.operations!.connectorHealth.revokedCount, "connector")} were revoked`
          : null,
        params.operations!.connectorHealth.refreshFailedCount > 0
          ? `${pluralize(params.operations!.connectorHealth.refreshFailedCount, "connector")} hit token refresh failure`
          : null,
        params.operations!.connectorHealth.validationStaleCount > 0
          ? `${pluralize(params.operations!.connectorHealth.validationStaleCount, "connector")} need validation refresh`
          : null
      ].filter((reason): reason is string => reason !== null),
      targets: params.operations!.connectorHealth.items.slice(0, 3).map((item) => ({
        section: "operations",
        itemId: item.id,
        label: item.label
      }))
    });
  }

  const status = items.some((item) => item.severity === "critical")
    ? "critical"
    : items.length > 0
      ? "warning"
      : "healthy";

  return {
    status,
    totalCount: items.reduce((total, item) => total + item.count, 0),
    generatedAt: new Date(now).toISOString(),
    items
  };
}
