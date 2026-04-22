import {
  ApprovalRequestSchema,
  JobRecordSchema,
  WorkspaceGovernanceSchema,
  type ApprovalRequest,
  type JobRecord
} from "@agentic/contracts";
import { buildDashboardOperationsTower } from "../packages/repository/src/dashboard-operations";

function buildApproval(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return ApprovalRequestSchema.parse({
    id: overrides.id ?? "approval-1",
    goalId: overrides.goalId ?? "goal-1",
    taskId: overrides.taskId ?? "task-1",
    title: overrides.title ?? "Review outbound reply",
    rationale: overrides.rationale ?? "Outbound sends need review.",
    riskClass: overrides.riskClass ?? "R2",
    decision: overrides.decision ?? "approved",
    requestedAction: overrides.requestedAction ?? "Send the draft.",
    actionIntent: overrides.actionIntent ?? null,
    preview: overrides.preview ?? {
      actionType: "send",
      summary: "Send the approved draft.",
      target: "customer@example.com",
      changes: [],
      impact: {
        affectedPeople: ["customer@example.com"],
        affectedSystems: ["email"],
        permissions: ["send"],
        rollback: "manual"
      }
    },
    decisionScope: "decisionScope" in overrides ? overrides.decisionScope : "once",
    decisionRationale:
      "decisionRationale" in overrides ? overrides.decisionRationale : "Matches the approved pattern.",
    history: overrides.history ?? [],
    explanation: "explanation" in overrides ? overrides.explanation : null,
    createdAt: overrides.createdAt ?? "2026-04-20T10:00:00.000Z",
    expiryAt: overrides.expiryAt ?? "2026-04-21T10:00:00.000Z",
    respondedAt: "respondedAt" in overrides ? overrides.respondedAt : "2026-04-20T10:10:00.000Z"
  });
}

function buildJob(overrides: Partial<JobRecord> & { payload: JobRecord["payload"] }): JobRecord {
  return JobRecordSchema.parse({
    id: overrides.id ?? "job-1",
    userId: overrides.userId ?? "system",
    kind: overrides.kind ?? "approval_follow_up",
    status: overrides.status ?? "queued",
    idempotencyKey: overrides.idempotencyKey ?? null,
    payload: overrides.payload,
    actorContext: overrides.actorContext ?? null,
    maxAttempts: overrides.maxAttempts ?? 1,
    attemptCount: overrides.attemptCount ?? 0,
    claimedBy: overrides.claimedBy ?? null,
    lastAttemptAt: overrides.lastAttemptAt ?? null,
    claimedAt: overrides.claimedAt ?? null,
    leaseExpiresAt: overrides.leaseExpiresAt ?? null,
    availableAt: overrides.availableAt ?? overrides.createdAt ?? "2026-04-20T10:00:00.000Z",
    completedAt: overrides.completedAt ?? null,
    deadLetteredAt: overrides.deadLetteredAt ?? null,
    lastError: overrides.lastError ?? null,
    journal: overrides.journal,
    createdAt: overrides.createdAt ?? "2026-04-20T10:00:00.000Z",
    updatedAt: overrides.updatedAt ?? overrides.createdAt ?? "2026-04-20T10:00:00.000Z"
  });
}

describe("buildDashboardOperationsTower shell effectiveness", () => {
  it("derives bounded decision and recovery metrics from recent approvals and replayed jobs", () => {
    const originalJob = buildJob({
      id: "job-dead-letter",
      status: "dead_letter",
      attemptCount: 1,
      deadLetteredAt: "2026-04-20T11:00:00.000Z",
      updatedAt: "2026-04-20T11:00:00.000Z",
      payload: {
        type: "approval_follow_up",
        approvalId: "approval-1",
        goalId: "goal-1",
        taskId: "task-1",
        decision: "approved",
        workspaceId: null,
        metadata: {}
      }
    });
    const replayedJob = buildJob({
      id: "job-replayed",
      status: "completed",
      attemptCount: 1,
      createdAt: "2026-04-20T11:05:00.000Z",
      updatedAt: "2026-04-20T11:07:00.000Z",
      completedAt: "2026-04-20T11:07:00.000Z",
      payload: {
        type: "approval_follow_up",
        approvalId: "approval-1",
        goalId: "goal-1",
        taskId: "task-1",
        decision: "approved",
        workspaceId: null,
        metadata: {
          replayedFromJobId: "job-dead-letter"
        }
      }
    });

    const operations = buildDashboardOperationsTower({
      activeWorkspace: null,
      workspaceGovernance: null,
      autopilotSettings: {
        userId: "system",
        mode: "notify_only",
        debounceMinutes: 15,
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z"
      },
      goals: [],
      approvals: [
        buildApproval({
          id: "approval-1",
          createdAt: "2026-04-20T10:00:00.000Z",
          respondedAt: "2026-04-20T10:10:00.000Z"
        }),
        buildApproval({
          id: "approval-2",
          createdAt: "2026-04-20T12:00:00.000Z",
          respondedAt: "2026-04-20T12:20:00.000Z"
        })
      ],
      autopilotEvents: [],
      integrations: [],
      jobs: [originalJob, replayedJob],
      providerCredentials: [],
      generatedAt: "2026-04-21T00:00:00.000Z"
    });

    expect(operations.shellEffectiveness).toMatchObject({
      status: "healthy",
      measurementWindowDays: 30,
      approvalSampleCount: 2,
      medianApprovalDecisionSeconds: 900,
      recoveryStartCount: 1,
      recoveryResolvedCount: 1,
      medianRecoveryStartSeconds: 300,
      pendingApprovalCount: 0,
      openRuntimeIssueCount: 0
    });
    expect(operations.shellEffectiveness.metrics).toEqual(
      expect.arrayContaining([
        "2 approval decisions / 30d",
        "Median approval 15m",
        "1 recovery start / 30d",
        "Median recovery 5m",
        "0 runtime issues",
        "0 pending approvals"
      ])
    );
    expect(operations.shellEffectiveness.highlights).toEqual(
      expect.arrayContaining([
        "Recent approvals reached a median decision time of 15m.",
        "Queue recoveries started with a median latency of 5m.",
        "Every observed replay in the current window has completed successfully."
      ])
    );
  });

  it("fails closed when blockers are open but recent shell evidence is missing or incomplete", () => {
    const deadLetterJob = buildJob({
      id: "job-dead-letter",
      status: "dead_letter",
      attemptCount: 1,
      deadLetteredAt: "2026-04-20T11:00:00.000Z",
      updatedAt: "2026-04-20T11:00:00.000Z",
      lastError: "temporary worker failure",
      payload: {
        type: "approval_follow_up",
        approvalId: "approval-1",
        goalId: "goal-1",
        taskId: "task-1",
        decision: "approved",
        workspaceId: null,
        metadata: {}
      }
    });
    const unresolvedReplay = buildJob({
      id: "job-replayed",
      status: "queued",
      createdAt: "2026-04-20T11:05:00.000Z",
      updatedAt: "2026-04-20T11:05:00.000Z",
      payload: {
        type: "approval_follow_up",
        approvalId: "approval-1",
        goalId: "goal-1",
        taskId: "task-1",
        decision: "approved",
        workspaceId: null,
        metadata: {
          replayedFromJobId: "job-dead-letter"
        }
      }
    });

    const operations = buildDashboardOperationsTower({
      activeWorkspace: null,
      workspaceGovernance: null,
      autopilotSettings: {
        userId: "system",
        mode: "notify_only",
        debounceMinutes: 15,
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z"
      },
      goals: [],
      approvals: [
        buildApproval({
          id: "approval-pending",
          decision: "pending",
          decisionScope: null,
          decisionRationale: null,
          respondedAt: null
        })
      ],
      autopilotEvents: [],
      integrations: [],
      jobs: [deadLetterJob, unresolvedReplay],
      providerCredentials: [],
      generatedAt: "2026-04-21T00:00:00.000Z"
    });

    expect(operations.asyncExecution.issueCount).toBe(2);
    expect(operations.shellEffectiveness).toMatchObject({
      status: "attention",
      approvalSampleCount: 0,
      medianApprovalDecisionSeconds: null,
      recoveryStartCount: 1,
      recoveryResolvedCount: 0,
      medianRecoveryStartSeconds: 300,
      pendingApprovalCount: 1,
      openRuntimeIssueCount: 1
    });
    expect(operations.shellEffectiveness.summary).toContain("operator shell is active");
    expect(operations.shellEffectiveness.highlights).toEqual(
      expect.arrayContaining([
        "No recently completed approvals are available inside the current measurement window.",
        "1 recovery replay still has not completed successfully.",
        "1 pending approval still needs operator attention.",
        "1 open runtime issue still sits in the control tower."
      ])
    );
  });

  it("holds elevated autonomy back when R3 governance disables shadow replay", () => {
    const operations = buildDashboardOperationsTower({
      activeWorkspace: null,
      workspaceGovernance: WorkspaceGovernanceSchema.parse({
        workspaceId: "workspace-1",
        approvalMode: "risk_based",
        requireAuditExports: true,
        maxAutoRunRiskClass: "R3",
        externalSendRequiresApproval: false,
        calendarWriteRequiresApproval: false,
        shadowReplayPolicy: {
          enabled: false,
          minimumMatchedEpisodes: 3,
          minimumPrecision: 0.8,
          maximumNegativeOutcomeRate: 0.15,
          maximumFailureCostRate: 0.2
        },
        retentionDays: 365,
        updatedBy: "user-1",
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-20T00:00:00.000Z"
      }),
      autopilotSettings: {
        userId: "system",
        mode: "auto_run",
        debounceMinutes: 15,
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z"
      },
      goals: [],
      approvals: [],
      autopilotEvents: [],
      integrations: [],
      jobs: [],
      providerCredentials: [],
      generatedAt: "2026-04-21T00:00:00.000Z"
    });

    expect(operations.autonomyPosture).toMatchObject({
      status: "attention",
      level: "bounded_autonomy",
      label: "Bounded autonomy"
    });
    expect(operations.autonomyPosture.summary).toContain("disabled shadow replay");
    expect(operations.autonomyPosture.stats).toEqual(
      expect.arrayContaining(["Max auto R3", "Shadow replay off", "0 pending approvals", "0 failed events"])
    );
    expect(operations.autonomyPosture.reasons).toEqual(
      expect.arrayContaining([
        "Workspace governance disabled shadow replay while still allowing R3 autonomy, so elevated autonomy stays held back until replay thresholds are restored.",
        "Autopilot mode is auto run and can continue eligible work without another operator step.",
        "Risk-based governance currently allows auto-run through R3."
      ])
    );
  });
});
