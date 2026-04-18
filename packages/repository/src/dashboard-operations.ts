import type { GoalBundle, JobRecord, ProviderCredential, Workspace } from "@agentic/contracts";

const DEFAULT_MAX_PENDING_JOB_AGE_MS = 15 * 60 * 1000;
const DEFAULT_PROVIDER_VALIDATION_STALE_MS = 7 * 24 * 60 * 60 * 1000;

export type DashboardOperationsStatus = "healthy" | "attention" | "critical" | "idle";
export type DashboardOperationsIssueSeverity = Exclude<DashboardOperationsStatus, "healthy" | "idle">;

export type DashboardOperationsTarget = {
  section: string;
  itemId?: string;
  label: string;
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

export type DashboardOperationsTower = {
  generatedAt: string;
  asyncExecution: DashboardAsyncExecutionSummary;
  connectorHealth: DashboardConnectorHealthSummary;
};

type BuildDashboardOperationsParams = {
  activeWorkspace: Workspace | null;
  goals: GoalBundle[];
  jobs: JobRecord[];
  providerCredentials: ProviderCredential[];
  generatedAt: string;
};

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
    case "briefing_create":
    case "template_run":
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
    case "briefing_create":
      return `Briefing queue · ${goalTitleById.get(job.payload.goalId) ?? "goal briefing"}`;
    case "template_run":
      return `Template run · ${goalTitleById.get(job.payload.goalId) ?? job.payload.templateId}`;
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
    case "briefing_create":
    case "template_run":
      return {
        section: "goals",
        itemId: job.payload.goalId,
        label: goalTitleById.get(job.payload.goalId) ?? "Open goal"
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
  const base = {
    id: `operations-job-${job.id}`,
    jobId: job.id,
    label: buildJobLabel(job, goalTitleById, activeWorkspace),
    status: job.status,
    updatedAt: job.updatedAt,
    target: buildJobTarget(job, goalTitleById)
  } satisfies Omit<DashboardAsyncExecutionIssue, "summary" | "severity">;

  if (job.status === "dead_letter") {
    return {
      issue: {
        ...base,
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
  validationStaleMs: number
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
  const base = {
    id: `operations-connector-${credential.id}`,
    credentialId: credential.id,
    label,
    provider: credential.provider,
    status: credential.status,
    updatedAt: credential.updatedAt,
    target: {
      section: "integrations",
      label: `Open ${credential.provider} integrations`
    }
  } satisfies Omit<DashboardConnectorHealthIssue, "summary" | "severity">;

  if (credential.status === "reconnect_required") {
    return {
      issue: {
        ...base,
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
    const { issue, expired, validationStale } = buildConnectorIssueForCredential(
      credential,
      now,
      DEFAULT_PROVIDER_VALIDATION_STALE_MS
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

  return {
    generatedAt: params.generatedAt,
    asyncExecution: {
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
    },
    connectorHealth: {
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
    }
  };
}
