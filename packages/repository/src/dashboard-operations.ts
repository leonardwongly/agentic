import type {
  ApprovalRequest,
  AutopilotEvent,
  AutopilotSettings,
  GoalBundle,
  IntegrationAccount,
  JobRecord,
  ProviderCredential,
  Workspace,
  WorkspaceGovernance
} from "@agentic/contracts";
import {
  describeIntegrationReadiness,
  type IntegrationExecutionMode,
  type IntegrationReadinessTier
} from "@agentic/integrations";

const DEFAULT_MAX_PENDING_JOB_AGE_MS = 15 * 60 * 1000;
const DEFAULT_PROVIDER_VALIDATION_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_SHELL_EFFECTIVENESS_WINDOW_DAYS = 30;
const SHELL_EFFECTIVENESS_APPROVAL_ATTENTION_SECONDS = 30 * 60;
const SHELL_EFFECTIVENESS_RECOVERY_ATTENTION_SECONDS = 15 * 60;

export type DashboardOperationsStatus = "healthy" | "attention" | "critical" | "idle";
export type DashboardOperationsIssueSeverity = Exclude<DashboardOperationsStatus, "healthy" | "idle">;

export type DashboardOperationsTarget = {
  section: string;
  itemId?: string;
  label: string;
};

export type DashboardOperationsRemediation = {
  kind: "open_target" | "replay_job" | "release_expired_lease" | "cancel_job";
  label: string;
  note: string;
  permission: "owner";
  statusUrl?: string;
};

export type DashboardAsyncExecutionIssue = {
  id: string;
  jobId: string;
  label: string;
  summary: string;
  severity: DashboardOperationsIssueSeverity;
  status: JobRecord["status"];
  updatedAt: string;
  target: DashboardOperationsTarget | null;
  remediation: DashboardOperationsRemediation | null;
};

export type DashboardAsyncExecutionSummary = {
  status: DashboardOperationsStatus;
  queuedJobs: number;
  retryingJobs: number;
  runningJobs: number;
  deadLetterJobs: number;
  expiredLeaseCount: number;
  stalePendingCount: number;
  issueCount: number;
  oldestPendingJobAgeSeconds: number | null;
  maxPendingJobAgeSeconds: number;
  items: DashboardAsyncExecutionIssue[];
};

export type DashboardConnectorHealthIssue = {
  id: string;
  credentialId: string;
  label: string;
  summary: string;
  severity: DashboardOperationsIssueSeverity;
  provider: ProviderCredential["provider"];
  status: ProviderCredential["status"];
  updatedAt: string;
  target: DashboardOperationsTarget;
  expectedReadinessTier: IntegrationReadinessTier | "mixed" | null;
  expectedReadinessLabel: string | null;
  expectedSupportedModes: IntegrationExecutionMode[];
  linkedIntegrationIds: string[];
  linkedIntegrationNames: string[];
  meetingReadinessTarget: boolean | null;
  remediation: DashboardConnectorRemediation | null;
};

export type DashboardConnectorRemediation = {
  kind: "revalidate_connector_credential" | "mark_connector_reconnect_required" | "open_target";
  label: string;
  note: string;
  permission: "owner";
};

export type DashboardConnectorHealthSummary = {
  status: DashboardOperationsStatus;
  totalCount: number;
  connectedCount: number;
  degradedCount: number;
  reconnectRequiredCount: number;
  refreshFailedCount: number;
  revokedCount: number;
  expiredCount: number;
  validationStaleCount: number;
  issueCount: number;
  items: DashboardConnectorHealthIssue[];
};

export type DashboardAutonomyPostureLevel =
  | "blocked"
  | "operator_controlled"
  | "approval_gated"
  | "bounded_autonomy"
  | "elevated_autonomy";

export type DashboardAutonomyOverridePath = {
  id: string;
  label: string;
  note: string;
  permission: "owner";
  target: DashboardOperationsTarget;
};

export type DashboardAutonomyPosture = {
  status: DashboardOperationsStatus;
  level: DashboardAutonomyPostureLevel;
  label: string;
  summary: string;
  reasons: string[];
  stats: string[];
  overridePaths: DashboardAutonomyOverridePath[];
};

export type DashboardShellEffectiveness = {
  status: DashboardOperationsStatus;
  summary: string;
  measurementWindowDays: number;
  windowStartedAt: string;
  approvalSampleCount: number;
  medianApprovalDecisionSeconds: number | null;
  recoveryStartCount: number;
  recoveryResolvedCount: number;
  medianRecoveryStartSeconds: number | null;
  pendingApprovalCount: number;
  openRuntimeIssueCount: number;
  metrics: string[];
  highlights: string[];
};

export type DashboardOperationsTower = {
  generatedAt: string;
  autonomyPosture: DashboardAutonomyPosture;
  asyncExecution: DashboardAsyncExecutionSummary;
  connectorHealth: DashboardConnectorHealthSummary;
  shellEffectiveness: DashboardShellEffectiveness;
};

type BuildDashboardOperationsParams = {
  activeWorkspace: Workspace | null;
  workspaceGovernance: WorkspaceGovernance | null;
  autopilotSettings: AutopilotSettings;
  goals: GoalBundle[];
  approvals: ApprovalRequest[];
  autopilotEvents: AutopilotEvent[];
  integrations: IntegrationAccount[];
  jobs: JobRecord[];
  providerCredentials: ProviderCredential[];
  generatedAt: string;
};

const EXECUTION_MODE_ORDER: IntegrationExecutionMode[] = ["draft", "approval", "autonomous"];

function extractProviderCredentialId(account: Pick<IntegrationAccount, "metadata">): string | null {
  const raw = account.metadata.providerCredentialId;
  return typeof raw === "string" && raw.trim().length > 0 ? raw : null;
}

function findLinkedIntegrations(
  credential: ProviderCredential,
  integrations: IntegrationAccount[]
): IntegrationAccount[] {
  return integrations.filter((account) => extractProviderCredentialId(account) === credential.id);
}

function describeExpectedIntegrationReadiness(account: IntegrationAccount): {
  tier: IntegrationReadinessTier;
  label: string;
  supportedModes: IntegrationExecutionMode[];
} {
  const readiness = describeIntegrationReadiness({
    ...account,
    status: "ready",
    metadata:
      account.metadata.provider === "google" && account.metadata.managed === true
        ? {
            ...account.metadata,
            managed: false
          }
        : account.metadata
  });

  return {
    tier: readiness.tier,
    label: readiness.label,
    supportedModes: readiness.supportedModes
  };
}

function buildConnectorReadinessExpectation(
  integrations: IntegrationAccount[]
): Pick<
  DashboardConnectorHealthIssue,
  | "expectedReadinessTier"
  | "expectedReadinessLabel"
  | "expectedSupportedModes"
  | "linkedIntegrationIds"
  | "linkedIntegrationNames"
  | "meetingReadinessTarget"
> {
  if (integrations.length === 0) {
    return {
      expectedReadinessTier: null,
      expectedReadinessLabel: null,
      expectedSupportedModes: [],
      linkedIntegrationIds: [],
      linkedIntegrationNames: [],
      meetingReadinessTarget: null
    };
  }

  const sortedIntegrations = [...integrations].sort((left, right) => left.id.localeCompare(right.id));
  const expectedProfiles = sortedIntegrations.map((account) => ({
    account,
    readiness: describeExpectedIntegrationReadiness(account)
  }));
  const distinctTiers = [...new Set(expectedProfiles.map((profile) => profile.readiness.tier))];
  const distinctLabels = [...new Set(expectedProfiles.map((profile) => profile.readiness.label))];
  const expectedSupportedModes = EXECUTION_MODE_ORDER.filter((mode) =>
    expectedProfiles.some((profile) => profile.readiness.supportedModes.includes(mode))
  );

  return {
    expectedReadinessTier: distinctTiers.length === 1 ? distinctTiers[0]! : "mixed",
    expectedReadinessLabel: distinctLabels.length === 1 ? distinctLabels[0]! : "Mixed readiness",
    expectedSupportedModes,
    linkedIntegrationIds: sortedIntegrations.map((account) => account.id),
    linkedIntegrationNames: sortedIntegrations.map((account) => account.name),
    meetingReadinessTarget: false
  };
}

function parseTimestampMs(timestamp: string | null | undefined): number | null {
  if (!timestamp) {
    return null;
  }

  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : null;
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

function humanizeSnakeCase(value: string): string {
  return value.replaceAll("_", " ");
}

function computeMedian(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[midpoint] ?? null;
  }

  const left = sorted[midpoint - 1];
  const right = sorted[midpoint];

  return left !== undefined && right !== undefined ? Math.round((left + right) / 2) : null;
}

function formatDurationSeconds(seconds: number | null): string {
  if (seconds === null) {
    return "unavailable";
  }

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.round(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (remainingMinutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${remainingMinutes}m`;
}

function countOpenShellRuntimeIssues(params: {
  jobs: JobRecord[];
  generatedAtMs: number;
  connectorIssueCount: number;
}): number {
  const maxPendingJobAgeMs = readMaxPendingJobAgeMs();
  const resolvedReplaySourceJobIds = new Set(
    params.jobs.flatMap((job) =>
      job.journal.replayedFromJobId && job.status === "completed"
        ? [job.journal.replayedFromJobId]
        : []
    )
  );
  const rootRuntimeIssueCount = params.jobs.reduce((count, job) => {
    if (job.journal.replayedFromJobId) {
      return count;
    }

    if (job.status === "dead_letter") {
      return resolvedReplaySourceJobIds.has(job.id) ? count : count + 1;
    }

    if (job.status === "retrying") {
      return count + 1;
    }

    const leaseExpiresAtMs = parseTimestampMs(job.leaseExpiresAt);

    if (job.status === "running" && leaseExpiresAtMs !== null && leaseExpiresAtMs <= params.generatedAtMs) {
      return count + 1;
    }

    const availableAtMs = parseTimestampMs(job.availableAt);
    const stalePending =
      job.status === "queued" &&
      availableAtMs !== null &&
      availableAtMs <= params.generatedAtMs - maxPendingJobAgeMs;

    return stalePending ? count + 1 : count;
  }, 0);

  return rootRuntimeIssueCount + params.connectorIssueCount;
}

function buildShellEffectiveness(params: {
  generatedAt: string;
  approvals: ApprovalRequest[];
  jobs: JobRecord[];
  asyncExecution: DashboardAsyncExecutionSummary;
  connectorHealth: DashboardConnectorHealthSummary;
}): DashboardShellEffectiveness {
  const generatedAtMs = parseTimestampMs(params.generatedAt) ?? Date.now();
  const windowStartMs =
    generatedAtMs - DEFAULT_SHELL_EFFECTIVENESS_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const windowStartedAt = new Date(windowStartMs).toISOString();
  const pendingApprovalCount = params.approvals.filter((approval) => approval.decision === "pending").length;
  const openRuntimeIssueCount = countOpenShellRuntimeIssues({
    jobs: params.jobs,
    generatedAtMs,
    connectorIssueCount: params.connectorHealth.issueCount
  });
  const approvalDecisionDurations = params.approvals.flatMap((approval) => {
    const createdAtMs = parseTimestampMs(approval.createdAt);
    const respondedAtMs = parseTimestampMs(approval.respondedAt);

    if (createdAtMs === null || respondedAtMs === null || respondedAtMs < createdAtMs || respondedAtMs < windowStartMs) {
      return [];
    }

    return [Math.round((respondedAtMs - createdAtMs) / 1000)];
  });
  const jobsById = new Map(params.jobs.map((job) => [job.id, job]));
  const recoveryStartDurations = params.jobs.flatMap((job) => {
    const replayedFromJobId = job.journal.replayedFromJobId;
    const replayQueuedAtMs = parseTimestampMs(job.createdAt);

    if (!replayedFromJobId || replayQueuedAtMs === null || replayQueuedAtMs < windowStartMs) {
      return [];
    }

    const originalJob = jobsById.get(replayedFromJobId);
    const failureAnchorMs = parseTimestampMs(originalJob?.deadLetteredAt ?? originalJob?.updatedAt ?? null);

    if (failureAnchorMs === null || replayQueuedAtMs < failureAnchorMs) {
      return [];
    }

    return [Math.round((replayQueuedAtMs - failureAnchorMs) / 1000)];
  });
  const recoveryStartCount = recoveryStartDurations.length;
  const recoveryResolvedCount = params.jobs.filter((job) => {
    const replayedFromJobId = job.journal.replayedFromJobId;
    const replayQueuedAtMs = parseTimestampMs(job.createdAt);

    if (!replayedFromJobId || replayQueuedAtMs === null || replayQueuedAtMs < windowStartMs) {
      return false;
    }

    return job.status === "completed";
  }).length;
  const medianApprovalDecisionSeconds = computeMedian(approvalDecisionDurations);
  const medianRecoveryStartSeconds = computeMedian(recoveryStartDurations);
  const approvalSampleCount = approvalDecisionDurations.length;
  const hasEvidence = approvalSampleCount > 0 || recoveryStartCount > 0;
  const slowApproval = medianApprovalDecisionSeconds !== null &&
    medianApprovalDecisionSeconds > SHELL_EFFECTIVENESS_APPROVAL_ATTENTION_SECONDS;
  const slowRecovery = medianRecoveryStartSeconds !== null &&
    medianRecoveryStartSeconds > SHELL_EFFECTIVENESS_RECOVERY_ATTENTION_SECONDS;
  const unresolvedRecovery = recoveryStartCount > recoveryResolvedCount;

  let status: DashboardOperationsStatus;
  let summary: string;

  if (!hasEvidence && pendingApprovalCount === 0 && openRuntimeIssueCount === 0) {
    status = "idle";
    summary = "Not enough recent operator decisions or queue recoveries are available to benchmark shell effectiveness yet.";
  } else if (
    openRuntimeIssueCount >= 2 &&
    recoveryResolvedCount === 0 &&
    pendingApprovalCount > 0 &&
    approvalSampleCount === 0
  ) {
    status = "critical";
    summary =
      "The operator shell is under active pressure: runtime blockers are open, approvals are still waiting, and there is no recent evidence of successful operator clearing.";
  } else if (slowApproval || slowRecovery || unresolvedRecovery || pendingApprovalCount > 0 || openRuntimeIssueCount > 0 || !hasEvidence) {
    status = "attention";
    summary =
      "The operator shell is active, but current decision or recovery evidence shows work is not yet clearing within the intended bounds.";
  } else {
    status = "healthy";
    summary =
      "The operator shell is clearing approvals and queue recoveries within the recent measurement window without active blockers.";
  }

  const highlights = [
    approvalSampleCount > 0
      ? `Recent approvals reached a median decision time of ${formatDurationSeconds(medianApprovalDecisionSeconds)}.`
      : "No recently completed approvals are available inside the current measurement window.",
    unresolvedRecovery
      ? `${formatCount(recoveryStartCount - recoveryResolvedCount, "recovery replay")} still has not completed successfully.`
      : recoveryStartCount > 0
        ? "Every observed replay in the current window has completed successfully."
        : null,
    pendingApprovalCount > 0
      ? `${formatCount(pendingApprovalCount, "pending approval")} still needs operator attention.`
      : null,
    openRuntimeIssueCount > 0
      ? `${formatCount(openRuntimeIssueCount, "open runtime issue")} still sits in the control tower.`
      : null,
    recoveryStartCount > 0
      ? `Queue recoveries started with a median latency of ${formatDurationSeconds(medianRecoveryStartSeconds)}.`
      : "No queue replay starts were observed inside the current measurement window."
  ].filter((highlight): highlight is string => highlight !== null);

  return {
    status,
    summary,
    measurementWindowDays: DEFAULT_SHELL_EFFECTIVENESS_WINDOW_DAYS,
    windowStartedAt,
    approvalSampleCount,
    medianApprovalDecisionSeconds,
    recoveryStartCount,
    recoveryResolvedCount,
    medianRecoveryStartSeconds,
    pendingApprovalCount,
    openRuntimeIssueCount,
    metrics: [
      `${formatCount(approvalSampleCount, "approval decision")} / ${DEFAULT_SHELL_EFFECTIVENESS_WINDOW_DAYS}d`,
      `Median approval ${formatDurationSeconds(medianApprovalDecisionSeconds)}`,
      `${formatCount(recoveryStartCount, "recovery start")} / ${DEFAULT_SHELL_EFFECTIVENESS_WINDOW_DAYS}d`,
      `Median recovery ${formatDurationSeconds(medianRecoveryStartSeconds)}`,
      `${formatCount(openRuntimeIssueCount, "runtime issue")}`,
      `${formatCount(pendingApprovalCount, "pending approval")}`
    ],
    highlights: highlights.slice(0, 4)
  };
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function describeShadowReplayThresholds(governance: WorkspaceGovernance): string {
  const policy = governance.shadowReplayPolicy;

  return [
    `${policy.minimumMatchedEpisodes}+ matched episode${policy.minimumMatchedEpisodes === 1 ? "" : "s"}`,
    `${formatPercent(policy.minimumPrecision)} precision`,
    `<= ${formatPercent(policy.maximumNegativeOutcomeRate)} negative outcomes`,
    `<= ${formatPercent(policy.maximumFailureCostRate)} failure cost`
  ].join(", ");
}

function readMaxPendingJobAgeMs(): number {
  const parsed = Number(process.env.AGENTIC_READY_MAX_PENDING_JOB_AGE_MS ?? `${DEFAULT_MAX_PENDING_JOB_AGE_MS}`);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_PENDING_JOB_AGE_MS;
}

function matchesWorkspaceScope(workspaceId: string | null | undefined, activeWorkspace: Workspace | null): boolean {
  if (!activeWorkspace) {
    return true;
  }

  if (workspaceId === activeWorkspace.id) {
    return true;
  }

  return workspaceId === null && activeWorkspace.isPersonal;
}

function isCredentialVisibleInScope(
  credential: ProviderCredential,
  activeWorkspace: Workspace | null
): boolean {
  if (!activeWorkspace) {
    return true;
  }

  return credential.workspaceId === null || credential.workspaceId === activeWorkspace.id;
}

function isJobVisibleInScope(
  job: JobRecord,
  activeWorkspace: Workspace | null,
  scopedGoalIds: Set<string>
): boolean {
  switch (job.payload.type) {
    case "goal_create":
    case "goal_refine":
    case "briefing_create":
    case "template_run":
    case "approval_follow_up":
    case "approval_notification":
      return scopedGoalIds.has(job.payload.goalId) || matchesWorkspaceScope(job.payload.workspaceId, activeWorkspace);
    case "privacy_operation":
      return matchesWorkspaceScope(job.payload.workspaceId, activeWorkspace);
    case "public_share_view":
      return scopedGoalIds.has(job.payload.goalId);
    case "autopilot_process":
    case "docs_render":
      return true;
  }
}

function buildJobLabel(job: JobRecord, goalTitleById: Map<string, string>, activeWorkspace: Workspace | null): string {
  switch (job.payload.type) {
    case "goal_create":
      return `Goal queue · ${goalTitleById.get(job.payload.goalId) ?? "new goal draft"}`;
    case "goal_refine":
      return `Goal refine · ${goalTitleById.get(job.payload.goalId) ?? "goal refinement"}`;
    case "briefing_create":
      return `Briefing queue · ${goalTitleById.get(job.payload.goalId) ?? "goal briefing"}`;
    case "template_run":
      return `Template run · ${goalTitleById.get(job.payload.goalId) ?? job.payload.templateId}`;
    case "approval_follow_up":
      return `Approval follow-up · ${goalTitleById.get(job.payload.goalId) ?? job.payload.approvalId}`;
    case "approval_notification":
      return `Approval notification · ${goalTitleById.get(job.payload.goalId) ?? job.payload.approvalId}`;
    case "privacy_operation":
      return `${humanizeSnakeCase(job.payload.kind)} · ${activeWorkspace?.name ?? "workspace privacy"}`;
    case "autopilot_process":
      return `Autopilot event · ${humanizeSnakeCase(job.payload.kind)}`;
    case "public_share_view":
      return `Share analytics · ${goalTitleById.get(job.payload.goalId) ?? "shared goal"}`;
    case "docs_render":
      return "Docs render job";
  }
}

function buildJobTarget(job: JobRecord, goalTitleById: Map<string, string>): DashboardOperationsTarget | null {
  switch (job.payload.type) {
    case "goal_create":
    case "goal_refine":
    case "briefing_create":
    case "template_run":
      return {
        section: "goals",
        itemId: job.payload.goalId,
        label: goalTitleById.get(job.payload.goalId) ?? "Open goal"
      };
    case "approval_follow_up":
    case "approval_notification":
      return {
        section: "goals",
        itemId: job.payload.goalId,
        label: goalTitleById.get(job.payload.goalId) ?? "Open approval goal"
      };
    case "privacy_operation":
      return {
        section: "privacy",
        itemId: job.payload.operationId,
        label: "Open privacy operation"
      };
    case "autopilot_process":
      return {
        section: "autopilot",
        itemId: job.payload.autopilotEventId,
        label: "Open autopilot event"
      };
    case "public_share_view":
      return {
        section: "goals",
        itemId: job.payload.goalId,
        label: goalTitleById.get(job.payload.goalId) ?? "Open shared goal"
      };
    case "docs_render":
      return null;
  }
}

function buildJobRemediation(
  job: JobRecord,
  target: DashboardOperationsTarget | null,
  recoveryKind?: "expired_lease" | "stale_pending" | "retrying"
): DashboardOperationsRemediation | null {
  if (job.status === "dead_letter" && job.journal.recovery?.strategy === "replay_job") {
    return {
      kind: "replay_job",
      label: job.journal.recovery.operatorActionLabel ?? "Replay job",
      note: job.journal.recovery.note,
      permission: "owner",
      statusUrl: job.journal.recovery.statusUrl ?? `/api/jobs/${job.id}`
    };
  }

  if (recoveryKind === "expired_lease") {
    return {
      kind: "release_expired_lease",
      label: "Release lease",
      note: "Release the expired worker lease so another worker can claim the job.",
      permission: "owner",
      statusUrl: `/api/jobs/${job.id}`
    };
  }

  if (recoveryKind === "stale_pending" || recoveryKind === "retrying") {
    return {
      kind: "cancel_job",
      label: "Cancel job",
      note: "Cancel the queued job and preserve an operator recovery audit trail.",
      permission: "owner",
      statusUrl: `/api/jobs/${job.id}`
    };
  }

  if (!target) {
    return null;
  }

  return {
    kind: "open_target",
    label: target.label,
    note: "Open the affected workflow context before retrying or escalating the queue issue.",
    permission: "owner"
  };
}

function buildAsyncIssueForJob(params: {
  job: JobRecord;
  now: number;
  maxPendingJobAgeMs: number;
  goalTitleById: Map<string, string>;
  activeWorkspace: Workspace | null;
}): {
  issue: DashboardAsyncExecutionIssue | null;
  expiredLease: boolean;
  stalePending: boolean;
} {
  const { job, now, maxPendingJobAgeMs, goalTitleById, activeWorkspace } = params;
  const leaseExpiresAtMs = parseTimestampMs(job.leaseExpiresAt);
  const availableAtMs = parseTimestampMs(job.availableAt);
  const expiredLease = job.status === "running" && leaseExpiresAtMs !== null && leaseExpiresAtMs <= now;
  const stalePending =
    (job.status === "queued" || job.status === "retrying") &&
    availableAtMs !== null &&
    availableAtMs <= now - maxPendingJobAgeMs;
  const target = buildJobTarget(job, goalTitleById);
  const base = {
    id: `operations-job-${job.id}`,
    jobId: job.id,
    label: buildJobLabel(job, goalTitleById, activeWorkspace),
    status: job.status,
    updatedAt: job.updatedAt,
    target,
    remediation: null
  } satisfies Omit<DashboardAsyncExecutionIssue, "summary" | "severity">;

  if (job.status === "dead_letter") {
    return {
      issue: {
        ...base,
        remediation: buildJobRemediation(job, target),
        severity: "critical",
        summary: `Dead-lettered after ${job.attemptCount}/${job.maxAttempts} attempts.`
      },
      expiredLease,
      stalePending
    };
  }

  if (expiredLease) {
    return {
      issue: {
        ...base,
        remediation: buildJobRemediation(job, target, "expired_lease"),
        severity: "critical",
        summary: `Lease expired ${formatAgeAgo(job.leaseExpiresAt ?? job.updatedAt, now)} while the job still reads as running.`
      },
      expiredLease,
      stalePending
    };
  }

  if (stalePending) {
    return {
      issue: {
        ...base,
        remediation: buildJobRemediation(job, target, "stale_pending"),
        severity: "critical",
        summary: `Pending since ${formatAgeAgo(job.availableAt, now)} without a worker claim.`
      },
      expiredLease,
      stalePending
    };
  }

  if (job.status === "retrying") {
    return {
      issue: {
        ...base,
        remediation: buildJobRemediation(job, target, "retrying"),
        severity: "attention",
        summary: `Retry ${job.attemptCount}/${job.maxAttempts} is queued after the last worker failure.`
      },
      expiredLease,
      stalePending
    };
  }

  return {
    issue: null,
    expiredLease,
    stalePending
  };
}

function buildConnectorIssueForCredential(
  credential: ProviderCredential,
  now: number,
  validationStaleMs: number,
  linkedIntegrations: IntegrationAccount[]
): {
  issue: DashboardConnectorHealthIssue | null;
  expired: boolean;
  validationStale: boolean;
} {
  const expiresAtMs = parseTimestampMs(credential.expiresAt);
  const lastValidatedAtMs = parseTimestampMs(credential.lastValidatedAt);
  const expired = expiresAtMs !== null && expiresAtMs <= now;
  const validationReferenceMs = lastValidatedAtMs ?? parseTimestampMs(credential.updatedAt);
  const validationStale =
    credential.status === "connected" &&
    validationReferenceMs !== null &&
    now - validationReferenceMs >= validationStaleMs;
  const label = [credential.provider, credential.accountEmail ?? credential.displayName]
    .filter((value): value is string => Boolean(value && value.trim().length > 0))
    .join(" · ") || `${credential.provider} connector`;
  const readinessExpectation = buildConnectorReadinessExpectation(linkedIntegrations);
  const base = {
    id: `operations-connector-${credential.id}`,
    credentialId: credential.id,
    label,
    provider: credential.provider,
    status: credential.status,
    updatedAt: credential.updatedAt,
    ...readinessExpectation,
    target: {
      section: "integrations",
      itemId: linkedIntegrations.length === 1 ? linkedIntegrations[0]!.id : undefined,
      label: `Open ${credential.provider} integrations`
    },
    remediation: null
  } satisfies Omit<DashboardConnectorHealthIssue, "summary" | "severity">;

  if (credential.status === "reconnect_required") {
    return {
      issue: {
        ...base,
        remediation: {
          kind: "open_target",
          label: "Reconnect",
          note: "Open the integration setup and complete provider re-authentication.",
          permission: "owner"
        },
        severity: "critical",
        summary: "Re-authentication is required before provider actions can resume."
      },
      expired,
      validationStale
    };
  }

  if (credential.status === "revoked") {
    return {
      issue: {
        ...base,
        remediation: {
          kind: "mark_connector_reconnect_required",
          label: "Require reconnect",
          note: "Convert this revoked credential into an explicit reconnect-required state for operators.",
          permission: "owner"
        },
        severity: "critical",
        summary: "Credential access was revoked and provider actions are blocked."
      },
      expired,
      validationStale
    };
  }

  if (expired) {
    return {
      issue: {
        ...base,
        remediation: {
          kind: "mark_connector_reconnect_required",
          label: "Require reconnect",
          note: "Mark the expired credential as requiring provider reconnect before automation resumes.",
          permission: "owner"
        },
        severity: "critical",
        summary: `Credential expired ${formatAgeAgo(credential.expiresAt ?? credential.updatedAt, now)} and needs rotation or re-authentication.`
      },
      expired,
      validationStale
    };
  }

  if (credential.status === "refresh_failed") {
    return {
      issue: {
        ...base,
        remediation: {
          kind: "revalidate_connector_credential",
          label: "Revalidate",
          note: "Re-check the credential and clear refresh failure state if provider access is healthy.",
          permission: "owner"
        },
        severity: "attention",
        summary: "Token refresh failed, so the connector may stop working until it is revalidated."
      },
      expired,
      validationStale
    };
  }

  if (validationStale) {
    return {
      issue: {
        ...base,
        remediation: {
          kind: "revalidate_connector_credential",
          label: "Revalidate",
          note: "Refresh validation evidence before using this connector for automation decisions.",
          permission: "owner"
        },
        severity: "attention",
        summary: `Credential has not been validated since ${formatAgeAgo(credential.lastValidatedAt ?? credential.updatedAt, now)}.`
      },
      expired,
      validationStale
    };
  }

  return {
    issue: null,
    expired,
    validationStale
  };
}

function pushOverridePath(
  paths: DashboardAutonomyOverridePath[],
  path: DashboardAutonomyOverridePath | null
): void {
  if (!path || paths.some((existing) => existing.id === path.id)) {
    return;
  }

  paths.push(path);
}

function buildAutonomyPosture(params: {
  asyncExecution: DashboardAsyncExecutionSummary;
  connectorHealth: DashboardConnectorHealthSummary;
  workspaceGovernance: WorkspaceGovernance | null;
  autopilotSettings: AutopilotSettings;
  approvals: ApprovalRequest[];
  autopilotEvents: AutopilotEvent[];
}): DashboardAutonomyPosture {
  const pendingApprovals = params.approvals.filter((approval) => approval.decision === "pending");
  const failedEvents = params.autopilotEvents.filter((event) => event.status === "failed");
  const firstPendingApproval = pendingApprovals[0] ?? null;
  const firstAsyncIssue = params.asyncExecution.items[0] ?? null;
  const firstConnectorIssue = params.connectorHealth.items[0] ?? null;
  const approvalMode = params.workspaceGovernance?.approvalMode ?? "risk_based";
  const maxAutoRunRiskClass = params.workspaceGovernance?.maxAutoRunRiskClass ?? "R1";
  const shadowReplayPolicy = params.workspaceGovernance?.shadowReplayPolicy ?? null;
  const shadowReplayConfigured = params.workspaceGovernance !== null;
  const shadowReplayEnabledAtR3 =
    params.workspaceGovernance?.maxAutoRunRiskClass === "R3" && shadowReplayPolicy?.enabled === true;
  const shadowReplayDisabledAtR3 =
    params.workspaceGovernance?.maxAutoRunRiskClass === "R3" && shadowReplayPolicy?.enabled === false;
  const shadowReplayThresholds =
    shadowReplayEnabledAtR3 && params.workspaceGovernance
      ? describeShadowReplayThresholds(params.workspaceGovernance)
      : null;
  const hasCriticalRuntimeBlock =
    params.asyncExecution.status === "critical" || params.connectorHealth.status === "critical";

  let level: DashboardAutonomyPostureLevel;
  let label: string;
  let summary: string;

  if (hasCriticalRuntimeBlock) {
    level = "blocked";
    label = "Blocked";
    summary = "Autonomy is blocked until queue recovery and connector repair return the runtime to policy-safe bounds.";
  } else if (params.autopilotSettings.mode !== "auto_run") {
    level = "operator_controlled";
    label = "Operator-controlled";
    summary = "Autonomy remains operator-controlled because autopilot is not currently in auto-run mode.";
  } else if (approvalMode === "always_review" || maxAutoRunRiskClass === "R1") {
    level = "approval_gated";
    label = "Approval-gated";
    summary = "Autonomy is enabled only behind explicit review gates or low-risk limits under the current governance policy.";
  } else if (maxAutoRunRiskClass === "R2") {
    level = "bounded_autonomy";
    label = "Bounded autonomy";
    summary = "Autonomy can proceed within bounded risk and connector readiness limits under the current workspace policy.";
  } else if (shadowReplayDisabledAtR3) {
    level = "bounded_autonomy";
    label = "Bounded autonomy";
    summary =
      "Autonomy stays bounded because workspace governance disabled shadow replay while still advertising R3 autonomy. Restore replay gating before widening learned high-impact flows.";
  } else {
    level = "elevated_autonomy";
    label = "Elevated autonomy";
    summary =
      "Autonomy can proceed across higher-impact flows, but learned R3 actions stay approval-gated until shadow replay thresholds, connector health, and queue recovery remain within bounds.";
  }

  const status: DashboardOperationsStatus = hasCriticalRuntimeBlock
    ? "critical"
    : shadowReplayDisabledAtR3
      ? "attention"
    : pendingApprovals.length > 0 ||
        failedEvents.length > 0 ||
        params.asyncExecution.status === "attention" ||
        params.connectorHealth.status === "attention"
      ? "attention"
      : "healthy";

  const reasons = [
    firstAsyncIssue?.summary ?? null,
    firstConnectorIssue?.summary ?? null,
    shadowReplayDisabledAtR3
      ? "Workspace governance disabled shadow replay while still allowing R3 autonomy, so elevated autonomy stays held back until replay thresholds are restored."
      : shadowReplayThresholds
        ? `Shadow replay remains the R3 gate: ${shadowReplayThresholds}.`
        : null,
    params.autopilotSettings.mode !== "auto_run"
      ? `Autopilot mode is ${humanizeSnakeCase(params.autopilotSettings.mode)}, so execution remains operator-controlled.`
      : "Autopilot mode is auto run and can continue eligible work without another operator step.",
    pendingApprovals.length > 0
      ? `${formatCount(pendingApprovals.length, "pending approval")} ${
          pendingApprovals.length === 1 ? "still needs" : "still need"
        } operator review.`
      : null,
    failedEvents.length > 0
      ? `${formatCount(failedEvents.length, "failed autopilot event")} ${
          failedEvents.length === 1 ? "is" : "are"
        } waiting for recovery before widening autonomy.`
      : null,
    approvalMode === "always_review"
      ? "Workspace approval mode is always review, so every action remains human-gated."
      : `Risk-based governance currently allows auto-run through ${maxAutoRunRiskClass}.`
  ].filter((reason): reason is string => reason !== null);

  const overridePaths: DashboardAutonomyOverridePath[] = [];

  pushOverridePath(
    overridePaths,
    firstAsyncIssue
      ? {
          id: "autonomy-open-queue-recovery",
          label: "Open queue recovery",
          note: "Recover dead letters, stale leases, or retry loops before widening autonomy.",
          permission: "owner",
          target: {
            section: "operations",
            itemId: firstAsyncIssue.id,
            label: firstAsyncIssue.target?.label ?? firstAsyncIssue.label
          }
        }
      : null
  );

  pushOverridePath(
    overridePaths,
    firstConnectorIssue
      ? {
          id: "autonomy-open-connector-repair",
          label: "Review connector health",
          note: "Repair degraded credentials before trusting governed execution.",
          permission: "owner",
          target: {
            section: "operations",
            itemId: firstConnectorIssue.id,
            label: firstConnectorIssue.target.label
          }
        }
      : null
  );

  pushOverridePath(
    overridePaths,
    firstPendingApproval
      ? {
          id: "autonomy-review-approval",
          label: "Review pending approval",
          note: "Resolve the next approval gate before widening autonomy.",
          permission: "owner",
          target: {
            section: "approvals",
            itemId: firstPendingApproval.id,
            label: firstPendingApproval.title
          }
        }
      : null
  );

  pushOverridePath(overridePaths, {
    id: "autonomy-open-autopilot",
    label: "Open autopilot controls",
    note: "Adjust notify-only, draft-goal, or auto-run posture from the workspace control surface.",
    permission: "owner",
    target: {
      section: "autopilot",
      label: "Open autopilot controls"
    }
  });

  pushOverridePath(
    overridePaths,
    params.workspaceGovernance
      ? {
          id: "autonomy-open-governance",
          label: "Open governance policy",
          note: "Review approval mode, risk ceilings, and audit defaults before widening autonomy.",
          permission: "owner",
          target: {
            section: "governance",
            label: "Open governance policy"
          }
        }
      : null
  );

  return {
    status,
    level,
    label,
    summary,
    reasons: reasons.slice(0, 4),
    stats: [
      `Mode ${humanizeSnakeCase(params.autopilotSettings.mode)}`,
      `Approval ${humanizeSnakeCase(approvalMode)}`,
      `Max auto ${maxAutoRunRiskClass}`,
      shadowReplayDisabledAtR3
        ? "Shadow replay off"
        : shadowReplayThresholds
          ? `Shadow replay ${shadowReplayPolicy!.minimumMatchedEpisodes}+ / ${formatPercent(
              shadowReplayPolicy!.minimumPrecision
            )}`
          : shadowReplayConfigured
            ? "Shadow replay staged"
            : null,
      formatCount(pendingApprovals.length, "pending approval"),
      formatCount(failedEvents.length, "failed event")
    ].filter((stat): stat is string => stat !== null),
    overridePaths: overridePaths.slice(0, 4)
  };
}

export function buildDashboardOperationsTower(params: BuildDashboardOperationsParams): DashboardOperationsTower {
  const now = parseTimestampMs(params.generatedAt) ?? Date.now();
  const maxPendingJobAgeMs = readMaxPendingJobAgeMs();
  const scopedGoalIds = new Set(params.goals.map((bundle) => bundle.goal.id));
  const goalTitleById = new Map(params.goals.map((bundle) => [bundle.goal.id, bundle.goal.title]));
  const visibleJobs = params.jobs.filter((job) => isJobVisibleInScope(job, params.activeWorkspace, scopedGoalIds));
  const visibleCredentials = params.providerCredentials.filter((credential) =>
    isCredentialVisibleInScope(credential, params.activeWorkspace)
  );
  const queuedJobs = visibleJobs.filter((job) => job.status === "queued");
  const retryingJobs = visibleJobs.filter((job) => job.status === "retrying");
  const runningJobs = visibleJobs.filter((job) => job.status === "running");
  const deadLetterJobs = visibleJobs.filter((job) => job.status === "dead_letter");
  const duePendingJobs = visibleJobs.filter((job) => {
    if (job.status !== "queued" && job.status !== "retrying") {
      return false;
    }

    const availableAtMs = parseTimestampMs(job.availableAt);
    return availableAtMs !== null && availableAtMs <= now;
  });
  const oldestPendingJobAgeSeconds =
    duePendingJobs.length > 0
      ? Math.floor(
          Math.max(
            0,
            now -
              Math.min(
                ...duePendingJobs.map((job) => parseTimestampMs(job.availableAt) ?? now)
              )
          ) / 1000
        )
      : null;
  let expiredLeaseCount = 0;
  let stalePendingCount = 0;
  const asyncIssues = visibleJobs.flatMap((job) => {
    const { issue, expiredLease, stalePending } = buildAsyncIssueForJob({
      job,
      now,
      maxPendingJobAgeMs,
      goalTitleById,
      activeWorkspace: params.activeWorkspace
    });

    if (expiredLease) {
      expiredLeaseCount += 1;
    }

    if (stalePending) {
      stalePendingCount += 1;
    }

    return issue ? [issue] : [];
  });
  const asyncCriticalCount = asyncIssues.filter((item) => item.severity === "critical").length;
  const asyncStatus: DashboardOperationsStatus =
    visibleJobs.length === 0
      ? "idle"
      : asyncCriticalCount > 0
        ? "critical"
        : asyncIssues.length > 0
          ? "attention"
          : "healthy";

  let expiredCredentialCount = 0;
  let validationStaleCount = 0;
  const connectorIssues = visibleCredentials.flatMap((credential) => {
    const linkedIntegrations = findLinkedIntegrations(credential, params.integrations);
    const { issue, expired, validationStale } = buildConnectorIssueForCredential(
      credential,
      now,
      DEFAULT_PROVIDER_VALIDATION_STALE_MS,
      linkedIntegrations
    );

    if (expired) {
      expiredCredentialCount += 1;
    }

    if (validationStale) {
      validationStaleCount += 1;
    }

    return issue ? [issue] : [];
  });
  const connectorCriticalCount = connectorIssues.filter((item) => item.severity === "critical").length;
  const connectorStatus: DashboardOperationsStatus =
    visibleCredentials.length === 0
      ? "idle"
      : connectorCriticalCount > 0
        ? "critical"
        : connectorIssues.length > 0
          ? "attention"
          : "healthy";
  const asyncExecution: DashboardAsyncExecutionSummary = {
    status: asyncStatus,
    queuedJobs: queuedJobs.length,
    retryingJobs: retryingJobs.length,
    runningJobs: runningJobs.length,
    deadLetterJobs: deadLetterJobs.length,
    expiredLeaseCount,
    stalePendingCount,
    issueCount: asyncIssues.length,
    oldestPendingJobAgeSeconds,
    maxPendingJobAgeSeconds: Math.floor(maxPendingJobAgeMs / 1000),
    items: asyncIssues.slice(0, 6)
  };
  const connectorHealth: DashboardConnectorHealthSummary = {
    status: connectorStatus,
    totalCount: visibleCredentials.length,
    connectedCount: visibleCredentials.filter((credential) => credential.status === "connected").length,
    degradedCount: connectorIssues.length,
    reconnectRequiredCount: visibleCredentials.filter((credential) => credential.status === "reconnect_required").length,
    refreshFailedCount: visibleCredentials.filter((credential) => credential.status === "refresh_failed").length,
    revokedCount: visibleCredentials.filter((credential) => credential.status === "revoked").length,
    expiredCount: expiredCredentialCount,
    validationStaleCount,
    issueCount: connectorIssues.length,
    items: connectorIssues.slice(0, 6)
  };

  return {
    generatedAt: params.generatedAt,
    autonomyPosture: buildAutonomyPosture({
      asyncExecution,
      connectorHealth,
      workspaceGovernance: params.workspaceGovernance,
      autopilotSettings: params.autopilotSettings,
      approvals: params.approvals,
      autopilotEvents: params.autopilotEvents
    }),
    asyncExecution,
    connectorHealth,
    shellEffectiveness: buildShellEffectiveness({
      generatedAt: params.generatedAt,
      approvals: params.approvals,
      jobs: visibleJobs,
      asyncExecution,
      connectorHealth
    })
  };
}
