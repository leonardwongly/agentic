import { getMemoryFreshness } from "@agentic/memory";
import type { DashboardData, DashboardDiagnostic } from "@agentic/repository";
import type {
  ApprovalRequest,
  Commitment,
  JobRecord,
  MemoryRecord,
  Watcher
} from "@agentic/contracts";

export const dashboardEventKindValues = [
  "job.created",
  "job.updated",
  "approval.created",
  "approval.updated",
  "commitment.updated",
  "connector.updated",
  "watcher.updated",
  "memory.updated",
  "diagnostic.changed",
  "governance.changed"
] as const;

export type DashboardEventKind = (typeof dashboardEventKindValues)[number];
export type DashboardEventDomain =
  | "job"
  | "approval"
  | "commitment"
  | "connector"
  | "watcher"
  | "memory"
  | "diagnostic"
  | "governance";
export type DashboardEventSeverity = "info" | "attention" | "critical";
export type DashboardFreshnessState = "live" | "reconnecting" | "stale" | "fallback";

export type DashboardEventTarget = {
  section: string;
  itemId?: string;
  label: string;
};

export type DashboardEvent = {
  schemaVersion: 1;
  sequence: number;
  id: string;
  kind: DashboardEventKind;
  domain: DashboardEventDomain;
  principalUserId: string;
  workspaceId: string | null;
  resourceId: string;
  summary: string;
  severity: DashboardEventSeverity;
  observedAt: string;
  updatedAt: string;
  dedupeKey: string;
  target: DashboardEventTarget | null;
  metadata: Record<string, string | number | boolean | null>;
};

export type DashboardEventBatch = {
  schemaVersion: 1;
  principalUserId: string;
  workspaceId: string | null;
  observedAt: string;
  freshness: {
    state: Extract<DashboardFreshnessState, "live">;
    staleAfterMs: number;
    fallbackAfterMs: number;
  };
  events: DashboardEvent[];
};

export type BuildDashboardEventBatchParams = {
  dashboard: DashboardData;
  jobs: JobRecord[];
  principalUserId: string;
  lastEventId?: number;
  observedAt?: string;
  staleAfterMs?: number;
  fallbackAfterMs?: number;
  limit?: number;
};

type DashboardEventDraft = Omit<DashboardEvent, "schemaVersion" | "sequence" | "id" | "observedAt">;

const DEFAULT_EVENT_LIMIT = 100;
const DEFAULT_STALE_AFTER_MS = 10_000;
const DEFAULT_FALLBACK_AFTER_MS = 30_000;

const severityRank: Record<DashboardEventSeverity, number> = {
  critical: 0,
  attention: 1,
  info: 2
};

function parseTime(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortEvents(left: DashboardEventDraft, right: DashboardEventDraft): number {
  const severityDelta = severityRank[left.severity] - severityRank[right.severity];
  if (severityDelta !== 0) {
    return severityDelta;
  }

  return parseTime(right.updatedAt) - parseTime(left.updatedAt) || left.dedupeKey.localeCompare(right.dedupeKey);
}

function buildEventDraft(params: {
  kind: DashboardEventKind;
  domain: DashboardEventDomain;
  principalUserId: string;
  workspaceId: string | null;
  resourceId: string;
  summary: string;
  severity?: DashboardEventSeverity;
  updatedAt: string;
  target?: DashboardEventTarget | null;
  metadata?: Record<string, string | number | boolean | null>;
}): DashboardEventDraft {
  return {
    kind: params.kind,
    domain: params.domain,
    principalUserId: params.principalUserId,
    workspaceId: params.workspaceId,
    resourceId: params.resourceId,
    summary: params.summary,
    severity: params.severity ?? "info",
    updatedAt: params.updatedAt,
    dedupeKey: `${params.kind}:${params.workspaceId ?? "personal"}:${params.resourceId}`,
    target: params.target ?? null,
    metadata: params.metadata ?? {}
  };
}

function jobWorkspaceId(job: JobRecord): string | null {
  return "workspaceId" in job.payload ? job.payload.workspaceId ?? null : null;
}

function isJobVisibleInWorkspace(job: JobRecord, activeWorkspaceId: string | null): boolean {
  const workspaceId = jobWorkspaceId(job);
  return activeWorkspaceId ? workspaceId === activeWorkspaceId || workspaceId === null : workspaceId === null;
}

function buildJobSummary(job: JobRecord): string {
  switch (job.status) {
    case "dead_letter":
      return `Job ${job.id} dead-lettered after ${job.attemptCount}/${job.maxAttempts} attempts.`;
    case "retrying":
      return `Job ${job.id} is retrying after a worker failure.`;
    case "running":
      return `Job ${job.id} is running.`;
    case "completed":
      return `Job ${job.id} completed.`;
    case "queued":
      return `Job ${job.id} queued.`;
    case "paused":
      return `Job ${job.id} paused by operator control.`;
    case "cancelled":
      return `Job ${job.id} cancelled by operator control.`;
  }
}

function jobSeverity(job: JobRecord): DashboardEventSeverity {
  if (job.status === "dead_letter") {
    return "critical";
  }

  if (job.status === "retrying" || job.status === "running") {
    return "attention";
  }

  return "info";
}

function buildApprovalSummary(approval: ApprovalRequest): string {
  if (approval.decision === "pending") {
    return `${approval.title} is waiting for an operator decision.`;
  }

  return `${approval.title} was ${approval.decision}.`;
}

function approvalSeverity(approval: ApprovalRequest): DashboardEventSeverity {
  if (approval.decision !== "pending") {
    return "info";
  }

  return approval.riskClass === "R4" || approval.riskClass === "R3" ? "critical" : "attention";
}

function commitmentSeverity(commitment: Commitment): DashboardEventSeverity {
  return commitment.status === "blocked" || commitment.status === "stale" ? "critical" : "attention";
}

function isCommitmentEventWorthy(commitment: Commitment): boolean {
  return commitment.status === "blocked" || commitment.status === "stale" || commitment.status === "needs-review";
}

function watcherSeverity(watcher: Watcher): DashboardEventSeverity {
  return watcher.status === "paused" || watcher.status === "expired" ? "attention" : "info";
}

function buildDiagnosticSummary(diagnostic: DashboardDiagnostic): string {
  return `${diagnostic.title}: ${diagnostic.reasons[0] ?? `${diagnostic.count} signal(s) detected`}`;
}

function buildMemoryEvents(params: {
  dashboard: DashboardData;
  principalUserId: string;
  workspaceId: string | null;
  observedAtMs: number;
}): DashboardEventDraft[] {
  return params.dashboard.memories
    .map((memory): { memory: MemoryRecord; freshness: ReturnType<typeof getMemoryFreshness> } => ({
      memory,
      freshness: getMemoryFreshness(memory, params.observedAtMs)
    }))
    .filter(({ freshness }) => freshness !== "fresh")
    .map(({ memory, freshness }) =>
      buildEventDraft({
        kind: "memory.updated",
        domain: "memory",
        principalUserId: params.principalUserId,
        workspaceId: params.workspaceId,
        resourceId: memory.id,
        summary: `Memory ${memory.id} is ${freshness.replaceAll("_", " ")}.`,
        severity: freshness === "expired" ? "critical" : "attention",
        updatedAt: memory.updatedAt,
        target: {
          section: "memory",
          itemId: memory.id,
          label: "Review memory"
        },
        metadata: {
          freshness,
          category: memory.category,
          memoryType: memory.memoryType
        }
      })
    );
}

export function buildDashboardEventBatch(params: BuildDashboardEventBatchParams): DashboardEventBatch {
  const observedAt = params.observedAt ?? new Date().toISOString();
  const observedAtMs = parseTime(observedAt) || Date.now();
  const workspaceId = params.dashboard.activeWorkspace?.id ?? null;
  const firstSequence = Math.max(0, params.lastEventId ?? 0) + 1;
  const drafts: DashboardEventDraft[] = [
    ...params.jobs
      .filter((job) => isJobVisibleInWorkspace(job, workspaceId))
      .map((job) =>
        buildEventDraft({
          kind: job.createdAt === job.updatedAt ? "job.created" : "job.updated",
          domain: "job",
          principalUserId: params.principalUserId,
          workspaceId: jobWorkspaceId(job),
          resourceId: job.id,
          summary: buildJobSummary(job),
          severity: jobSeverity(job),
          updatedAt: job.updatedAt,
          target: {
            section: "operations",
            itemId: `operations-job-${job.id}`,
            label: "Open job recovery"
          },
          metadata: {
            status: job.status,
            kind: job.kind,
            attemptCount: job.attemptCount,
            maxAttempts: job.maxAttempts
          }
        })
      ),
    ...params.dashboard.approvals.map((approval) =>
      buildEventDraft({
        kind: approval.decision === "pending" ? "approval.created" : "approval.updated",
        domain: "approval",
        principalUserId: params.principalUserId,
        workspaceId,
        resourceId: approval.id,
        summary: buildApprovalSummary(approval),
        severity: approvalSeverity(approval),
        updatedAt: approval.respondedAt ?? approval.createdAt,
        target: {
          section: "approvals",
          itemId: approval.id,
          label: "Open approval"
        },
        metadata: {
          decision: approval.decision,
          riskClass: approval.riskClass,
          goalId: approval.goalId,
          taskId: approval.taskId
        }
      })
    ),
    ...params.dashboard.commitments.filter(isCommitmentEventWorthy).map((commitment) =>
      buildEventDraft({
        kind: "commitment.updated",
        domain: "commitment",
        principalUserId: params.principalUserId,
        workspaceId,
        resourceId: commitment.id,
        summary: `${commitment.title} is ${commitment.status.replaceAll("-", " ")}.`,
        severity: commitmentSeverity(commitment),
        updatedAt: commitment.updatedAt,
        target: {
          section: "commitments",
          itemId: commitment.id,
          label: "Open commitment"
        },
        metadata: {
          status: commitment.status,
          urgency: commitment.urgency
        }
      })
    ),
    ...(params.dashboard.operations?.connectorHealth.items ?? []).map((connector) =>
      buildEventDraft({
        kind: "connector.updated",
        domain: "connector",
        principalUserId: params.principalUserId,
        workspaceId,
        resourceId: connector.credentialId,
        summary: connector.summary,
        severity: connector.severity === "critical" ? "critical" : "attention",
        updatedAt: connector.updatedAt,
        target: connector.target,
        metadata: {
          provider: connector.provider,
          status: connector.status,
          expectedReadinessLabel: connector.expectedReadinessLabel
        }
      })
    ),
    ...params.dashboard.watchers.map((watcher) =>
      buildEventDraft({
        kind: "watcher.updated",
        domain: "watcher",
        principalUserId: params.principalUserId,
        workspaceId,
        resourceId: watcher.id,
        summary: `Watcher ${watcher.targetEntity} is ${watcher.status}.`,
        severity: watcherSeverity(watcher),
        updatedAt: watcher.updatedAt,
        target: {
          section: "watchers",
          itemId: watcher.id,
          label: "Open watcher"
        },
        metadata: {
          status: watcher.status,
          goalId: watcher.goalId
        }
      })
    ),
    ...buildMemoryEvents({
      dashboard: params.dashboard,
      principalUserId: params.principalUserId,
      workspaceId,
      observedAtMs
    }),
    ...params.dashboard.diagnostics.items.map((diagnostic) =>
      buildEventDraft({
        kind: "diagnostic.changed",
        domain: "diagnostic",
        principalUserId: params.principalUserId,
        workspaceId,
        resourceId: diagnostic.kind,
        summary: buildDiagnosticSummary(diagnostic),
        severity: diagnostic.severity === "critical" ? "critical" : "attention",
        updatedAt: params.dashboard.diagnostics.generatedAt,
        target: diagnostic.targets[0] ?? null,
        metadata: {
          kind: diagnostic.kind,
          count: diagnostic.count
        }
      })
    ),
    ...(params.dashboard.workspaceGovernance
      ? [
          buildEventDraft({
            kind: "governance.changed",
            domain: "governance",
            principalUserId: params.principalUserId,
            workspaceId: params.dashboard.workspaceGovernance.workspaceId,
            resourceId: params.dashboard.workspaceGovernance.workspaceId,
            summary: `Governance is ${params.dashboard.workspaceGovernance.approvalMode.replaceAll("_", " ")} with max auto ${params.dashboard.workspaceGovernance.maxAutoRunRiskClass}.`,
            severity: params.dashboard.workspaceGovernance.approvalMode === "always_review" ? "attention" : "info",
            updatedAt: params.dashboard.workspaceGovernance.updatedAt,
            target: {
              section: "governance",
              itemId: params.dashboard.workspaceGovernance.workspaceId,
              label: "Open governance"
            },
            metadata: {
              approvalMode: params.dashboard.workspaceGovernance.approvalMode,
              maxAutoRunRiskClass: params.dashboard.workspaceGovernance.maxAutoRunRiskClass
            }
          })
        ]
      : [])
  ];

  const events = drafts
    .sort(sortEvents)
    .slice(0, params.limit ?? DEFAULT_EVENT_LIMIT)
    .map((draft, index) => {
      const sequence = firstSequence + index;
      return {
        schemaVersion: 1,
        sequence,
        id: String(sequence),
        observedAt,
        ...draft
      } satisfies DashboardEvent;
    });

  return {
    schemaVersion: 1,
    principalUserId: params.principalUserId,
    workspaceId,
    observedAt,
    freshness: {
      state: "live",
      staleAfterMs: params.staleAfterMs ?? DEFAULT_STALE_AFTER_MS,
      fallbackAfterMs: params.fallbackAfterMs ?? DEFAULT_FALLBACK_AFTER_MS
    },
    events
  };
}

export function buildDashboardEventSignature(batch: DashboardEventBatch): string {
  return JSON.stringify(
    batch.events.map((event) => ({
      kind: event.kind,
      resourceId: event.resourceId,
      updatedAt: event.updatedAt,
      severity: event.severity,
      summary: event.summary
    }))
  );
}
