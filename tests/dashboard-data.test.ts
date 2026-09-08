import { assembleDashboardData } from "../packages/repository/src/dashboard-data";
import { DEFAULT_AUTOPILOT_RELIABILITY_CONTROLS } from "@agentic/contracts";
import { getTelemetrySnapshot, resetTelemetrySnapshot } from "@agentic/observability";

describe("assembleDashboardData instrumentation", () => {
  const originalTimingLog = process.env.AGENTIC_DASHBOARD_TIMING_LOG;
  const originalWarnMs = process.env.AGENTIC_DASHBOARD_WARN_MS;

  afterEach(() => {
    process.env.AGENTIC_DASHBOARD_TIMING_LOG = originalTimingLog;
    process.env.AGENTIC_DASHBOARD_WARN_MS = originalWarnMs;
    resetTelemetrySnapshot();
  });

  it("does not emit timing logs when assembly stays under the warning threshold", () => {
    process.env.AGENTIC_DASHBOARD_TIMING_LOG = "0";
    process.env.AGENTIC_DASHBOARD_WARN_MS = "100000";
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    assembleDashboardData({
      userId: "user-1",
      workspaces: [],
      activeWorkspace: null,
      workspaceSelection: null,
      workspaceMembers: [],
      workspaceGovernance: null,
      goals: [],
      goalShares: [],
      privacyOperations: [],
      approvals: [],
      evidenceRecords: [],
      commitments: [],
      briefingPreferences: {
        userId: "user-1",
        timezone: "UTC",
        focus: "balanced",
        schedules: [],
        actorContext: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z"
      },
      autopilotSettings: {
        userId: "user-1",
        mode: "notify_only",
        debounceMinutes: 15,
        reliabilityControls: DEFAULT_AUTOPILOT_RELIABILITY_CONTROLS,
        actorContext: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z"
      },
      autopilotEvents: [],
      memories: [],
      integrations: [],
      watchers: [],
      filterBundlesForWorkspace: (goals) => goals,
      mergeCommitments: () => [],
      buildDiagnostics: () => ({
        status: "healthy",
        totalCount: 0,
        generatedAt: "2024-01-01T00:00:00.000Z",
        items: []
      }),
      buildControlPlane: () => ({
        generatedAt: "2024-01-01T00:00:00.000Z",
        sections: []
      }),
      buildNowQueue: () => ({
        generatedAt: "2024-01-01T00:00:00.000Z",
        totalCount: 0,
        items: []
      }),
      buildOperatingSections: () => ({
        generatedAt: "2024-01-01T00:00:00.000Z",
        roleView: {
          role: null,
          label: "Setup view",
          summary: "No active workspace is selected.",
          focusAreas: [],
          prioritizedSectionKeys: []
        },
        teamWorkflow: {
          mode: "setup",
          label: "Team workflow not active",
          summary: "No active workspace is selected.",
          visibilityLabel: "Setup-only visibility",
          queueMetrics: [],
          ownershipAssignments: [],
          queues: [],
          controls: [],
          auditCoverage: {
            required: false,
            status: "attention",
            summary: "Activate a workspace before evaluating whether audit export coverage is meeting the governed baseline.",
            latestStatus: null,
            latestCompletedAt: null
          },
          actionBoundaries: [],
          handoffGuidance: [],
          permissions: {
            manageMembers: {
              allowed: false,
              reason: "Select or create a workspace before managing members."
            },
            editGovernance: {
              allowed: false,
              reason: "Select a workspace before editing governance controls."
            },
            exportAudit: {
              allowed: false,
              reason: "Select a workspace before exporting workspace audit evidence."
            },
            managePrivacyOperations: {
              allowed: false,
              reason: "Select a workspace before running privacy lifecycle operations."
            }
          },
          escalationTargetRole: null,
          slaStatus: "attention",
          slaSummary: "A workspace must be activated before team ownership can be enforced."
        },
        nextBestAction: {
          kind: "configure_workspace",
          label: "Activate a workspace",
          summary: "Select or create a workspace before using the operator shell.",
          status: "attention",
          targetSection: "workspaces",
          role: null
        },
        sections: []
      }),
      buildBriefingHistory: () => [],
      sortArtifacts: (artifacts) => artifacts,
      sortActionLogs: (logs) => logs
    });

    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("emits a warning when assembly crosses the configured threshold", () => {
    process.env.AGENTIC_DASHBOARD_TIMING_LOG = "0";
    process.env.AGENTIC_DASHBOARD_WARN_MS = "1";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const dateNowSpy = vi.spyOn(Date, "now");
    dateNowSpy.mockReturnValueOnce(100).mockReturnValueOnce(103);

    assembleDashboardData({
      userId: "user-1",
      workspaces: [],
      activeWorkspace: null,
      workspaceSelection: null,
      workspaceMembers: [],
      workspaceGovernance: null,
      goals: [],
      goalShares: [],
      privacyOperations: [],
      approvals: [],
      evidenceRecords: [],
      commitments: [],
      briefingPreferences: {
        userId: "user-1",
        timezone: "UTC",
        focus: "balanced",
        schedules: [],
        actorContext: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z"
      },
      autopilotSettings: {
        userId: "user-1",
        mode: "notify_only",
        debounceMinutes: 15,
        reliabilityControls: DEFAULT_AUTOPILOT_RELIABILITY_CONTROLS,
        actorContext: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z"
      },
      autopilotEvents: [],
      memories: [],
      integrations: [],
      watchers: [],
      filterBundlesForWorkspace: (goals) => goals,
      mergeCommitments: () => [],
      buildDiagnostics: () => ({
        status: "healthy",
        totalCount: 0,
        generatedAt: "2024-01-01T00:00:00.000Z",
        items: []
      }),
      buildControlPlane: () => ({
        generatedAt: "2024-01-01T00:00:00.000Z",
        sections: []
      }),
      buildNowQueue: () => ({
        generatedAt: "2024-01-01T00:00:00.000Z",
        totalCount: 0,
        items: []
      }),
      buildOperatingSections: () => ({
        generatedAt: "2024-01-01T00:00:00.000Z",
        roleView: {
          role: null,
          label: "Setup view",
          summary: "No active workspace is selected.",
          focusAreas: [],
          prioritizedSectionKeys: []
        },
        teamWorkflow: {
          mode: "setup",
          label: "Team workflow not active",
          summary: "No active workspace is selected.",
          visibilityLabel: "Setup-only visibility",
          queueMetrics: [],
          ownershipAssignments: [],
          queues: [],
          controls: [],
          auditCoverage: {
            required: false,
            status: "attention",
            summary: "Activate a workspace before evaluating whether audit export coverage is meeting the governed baseline.",
            latestStatus: null,
            latestCompletedAt: null
          },
          actionBoundaries: [],
          handoffGuidance: [],
          permissions: {
            manageMembers: {
              allowed: false,
              reason: "Select or create a workspace before managing members."
            },
            editGovernance: {
              allowed: false,
              reason: "Select a workspace before editing governance controls."
            },
            exportAudit: {
              allowed: false,
              reason: "Select a workspace before exporting workspace audit evidence."
            },
            managePrivacyOperations: {
              allowed: false,
              reason: "Select a workspace before running privacy lifecycle operations."
            }
          },
          escalationTargetRole: null,
          slaStatus: "attention",
          slaSummary: "A workspace must be activated before team ownership can be enforced."
        },
        nextBestAction: {
          kind: "configure_workspace",
          label: "Activate a workspace",
          summary: "Select or create a workspace before using the operator shell.",
          status: "attention",
          targetSection: "workspaces",
          role: null
        },
        sections: []
      }),
      buildBriefingHistory: () => [],
      sortArtifacts: (artifacts) => artifacts,
      sortActionLogs: (logs) => logs
    });

    expect(warnSpy).toHaveBeenCalledWith(
      "[dashboard-data] assembled dashboard payload",
      expect.objectContaining({
        durationMs: expect.any(Number),
        totalGoals: 0,
        scopedGoals: 0
      })
    );
    dateNowSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("records dashboard queue, connector, and payload health metrics", () => {
    resetTelemetrySnapshot();

    assembleDashboardData({
      userId: "user-1",
      workspaces: [],
      activeWorkspace: null,
      workspaceSelection: null,
      workspaceMembers: [],
      workspaceGovernance: null,
      goals: [],
      goalShares: [],
      privacyOperations: [],
      approvals: [],
      evidenceRecords: [],
      commitments: [],
      briefingPreferences: {
        userId: "user-1",
        timezone: "UTC",
        focus: "balanced",
        schedules: [],
        actorContext: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z"
      },
      autopilotSettings: {
        userId: "user-1",
        mode: "notify_only",
        debounceMinutes: 15,
        reliabilityControls: DEFAULT_AUTOPILOT_RELIABILITY_CONTROLS,
        actorContext: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z"
      },
      autopilotEvents: [],
      memories: [],
      integrations: [],
      watchers: [],
      filterBundlesForWorkspace: (goals) => goals,
      mergeCommitments: () => [],
      buildDiagnostics: () => ({
        status: "healthy",
        totalCount: 0,
        generatedAt: "2024-01-01T00:00:00.000Z",
        items: []
      }),
      buildControlPlane: () => ({
        generatedAt: "2024-01-01T00:00:00.000Z",
        sections: []
      }),
      buildNowQueue: () => ({
        generatedAt: "2024-01-01T00:00:00.000Z",
        totalCount: 0,
        items: []
      }),
      buildOperatingSections: () => ({
        generatedAt: "2024-01-01T00:00:00.000Z",
        roleView: {
          role: null,
          label: "Setup view",
          summary: "No active workspace is selected.",
          focusAreas: [],
          prioritizedSectionKeys: []
        },
        teamWorkflow: {
          mode: "setup",
          label: "Team workflow not active",
          summary: "No active workspace is selected.",
          visibilityLabel: "Setup-only visibility",
          queueMetrics: [],
          ownershipAssignments: [],
          queues: [],
          controls: [],
          auditCoverage: {
            required: false,
            status: "attention",
            summary: "Activate a workspace before evaluating whether audit export coverage is meeting the governed baseline.",
            latestStatus: null,
            latestCompletedAt: null
          },
          actionBoundaries: [],
          handoffGuidance: [],
          permissions: {
            manageMembers: { allowed: false, reason: "Select or create a workspace before managing members." },
            editGovernance: { allowed: false, reason: "Select a workspace before editing governance controls." },
            exportAudit: { allowed: false, reason: "Select a workspace before exporting workspace audit evidence." },
            managePrivacyOperations: { allowed: false, reason: "Select a workspace before running privacy lifecycle operations." }
          },
          escalationTargetRole: null,
          slaStatus: "attention",
          slaSummary: "A workspace must be activated before team ownership can be enforced."
        },
        nextBestAction: {
          kind: "configure_workspace",
          label: "Activate a workspace",
          summary: "Select or create a workspace before using the operator shell.",
          status: "attention",
          targetSection: "workspaces",
          role: null
        },
        sections: []
      }),
      buildOperations: () => ({
        generatedAt: "2024-01-01T00:00:00.000Z",
        asyncExecution: {
          status: "critical",
          queuedJobs: 3,
          retryingJobs: 1,
          runningJobs: 2,
          deadLetterJobs: 1,
          expiredLeaseCount: 1,
          stalePendingCount: 2,
          issueCount: 4,
          oldestPendingJobAgeSeconds: 90,
          maxPendingJobAgeSeconds: 900,
          items: []
        },
        connectorHealth: {
          status: "attention",
          totalCount: 2,
          connectedCount: 1,
          degradedCount: 1,
          reconnectRequiredCount: 1,
          refreshFailedCount: 0,
          revokedCount: 0,
          expiredCount: 0,
          validationStaleCount: 1,
          issueCount: 1,
          items: []
        },
        autonomyPosture: {
          status: "attention",
          level: "approval_gated",
          label: "Approval gated",
          summary: "Governed automation remains approval gated.",
          reasons: [],
          stats: [],
          overridePaths: []
        },
        shellEffectiveness: {
          status: "attention",
          summary: "Some recovery signals need attention.",
          measurementWindowDays: 30,
          windowStartedAt: "2023-12-01T00:00:00.000Z",
          approvalSampleCount: 0,
          medianApprovalDecisionSeconds: null,
          recoveryStartCount: 0,
          recoveryResolvedCount: 0,
          medianRecoveryStartSeconds: null,
          pendingApprovalCount: 0,
          openRuntimeIssueCount: 1,
          metrics: [],
          highlights: []
        }
      }),
      buildBriefingHistory: () => [],
      sortArtifacts: (artifacts) => artifacts,
      sortActionLogs: (logs) => logs
    });

    const snapshot = getTelemetrySnapshot();

    expect(snapshot.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "dashboard.health.queue_depth",
          value: 3,
          attributes: expect.objectContaining({ queueStatus: "queued", operationsStatus: "critical" })
        }),
        expect.objectContaining({
          name: "dashboard.health.queue_lag_seconds",
          value: 90,
          attributes: expect.objectContaining({ stalePendingCount: 2 })
        }),
        expect.objectContaining({
          name: "dashboard.health.connector_count",
          value: 1,
          attributes: expect.objectContaining({ connectorState: "issue", connectorStatus: "attention" })
        }),
        expect.objectContaining({
          name: "dashboard.health.connector_slo_gate",
          value: 0.5,
          attributes: expect.objectContaining({
            gate: "credential_connected_ratio",
            status: "warn",
            threshold: "1.0",
            connectorStatus: "attention"
          })
        }),
        expect.objectContaining({
          name: "dashboard.health.connector_slo_gate",
          value: 1,
          attributes: expect.objectContaining({
            gate: "reconnect_required_count",
            status: "fail",
            threshold: "0"
          })
        }),
        expect.objectContaining({
          name: "dashboard.health.connector_slo_gate",
          value: 1,
          attributes: expect.objectContaining({
            gate: "validation_stale_count",
            status: "warn",
            threshold: "0"
          })
        }),
        expect.objectContaining({
          name: "dashboard.health.operations_status.total",
          attributes: expect.objectContaining({
            asyncStatus: "critical",
            connectorStatus: "attention",
            shellStatus: "attention"
          })
        })
      ])
    );
    expect(snapshot.logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "dashboard.health.metrics_recorded",
          attributes: expect.objectContaining({
            queuedJobs: 3,
            connectorIssues: 1,
            connectorReconnectRequired: 1,
            connectorValidationStale: 1
          })
        })
      ])
    );
  });

  it("enriches approvals with explanation paths backed by evidence records", () => {
    const dashboard = assembleDashboardData({
      userId: "user-1",
      workspaces: [],
      activeWorkspace: null,
      workspaceSelection: null,
      workspaceMembers: [],
      workspaceGovernance: null,
      goals: [
        {
          goal: {
            id: "goal-1",
            userId: "user-1",
            workspaceId: null,
            workflowId: "workflow-1",
            title: "Review outbound reply",
            request: "Review my inbox",
            intent: "Resolve one approval",
            status: "completed",
            confidence: 1,
            explanation: "Approval workflow for an outbound reply.",
            wedge: { key: "general_coordination", label: "Review", selection: "selected_production", rationale: "Approval workflow for an outbound reply." },
            completionContract: { id: "contract-1", summary: "Resolve one approval", successCriteria: ["Decision recorded"], evidenceSignals: ["Approval decision logged"], approvalExpectations: [], doneWhen: "Decision is recorded" },
            responsibility: { owner: { kind: "user", userId: "user-1", workspaceRole: "owner", systemActor: null, label: "User" }, delegate: null, reviewer: null, escalationOwner: null, handoffStatus: "owner_control", audit: { requiredEvents: [], requireActorContext: false, requireReasonForDelegation: false, requireReasonForEscalation: false, requireReviewerIdentity: false }, lastChangedAt: null, handoffSummary: null, delegationReason: null, escalationReason: null, lastChangedBy: null },
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z"
          },
          workflow: {
            id: "workflow-1",
            goalId: "goal-1",
            workspaceId: null,
            status: "completed",
            currentStep: "done",
            checkpoint: "done",
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z"
          },
          tasks: [
            {
              id: "task-1",
              goalId: "goal-1",
              workflowId: "workflow-1",
              title: "Send a reply",
              summary: "Send the approved response.",
              assignedAgent: "communications",
              state: "completed",
              riskClass: "R2",
              requiresApproval: true,
              dependsOn: [],
              toolCapabilities: ["draft", "send"],
              artifactIds: [],
              responsibility: { owner: { kind: "user", userId: "user-1", workspaceRole: "owner", systemActor: null, label: "User" }, delegate: null, reviewer: null, escalationOwner: null, handoffStatus: "owner_control", audit: { requiredEvents: [], requireActorContext: false, requireReasonForDelegation: false, requireReasonForEscalation: false, requireReviewerIdentity: false }, lastChangedAt: null, handoffSummary: null, delegationReason: null, escalationReason: null, lastChangedBy: null },
              createdAt: "2024-01-01T00:00:00.000Z",
              updatedAt: "2024-01-01T00:00:00.000Z"
            }
          ],
          artifacts: [],
          approvals: [],
          watchers: [],
          actionLogs: []
        }
      ],
      goalShares: [],
      privacyOperations: [],
      approvals: [
        {
          id: "approval-1",
          goalId: "goal-1",
          taskId: "task-1",
          title: "Send a reply",
          rationale: "External replies need confirmation before sending.",
          riskClass: "R2",
          decision: "approved",
          requestedAction: "Send the draft to the customer.",
          actionIntent: {
            schemaVersion: "v1",
            type: "send_message",
            adapter: "gmail",
            riskClass: "R2",
            mode: "send",
            to: "customer@example.com",
            subject: "Follow-up",
            body: "Thanks for the update.",
            threadId: null,
            metadata: {}
          },
          preview: {
            actionType: "send",
            summary: "Send a customer reply.",
            target: "customer@example.com",
            changes: [],
            impact: {
              affectedPeople: ["customer@example.com"],
              affectedSystems: ["email"],
              permissions: [],
              rollback: "manual"
            }
          },
          decisionScope: "similar_24h",
          decisionRationale: "This matches the approved reply pattern.",
          history: [],
          explanation: null,
          createdAt: "2024-01-01T00:00:00.000Z",
          expiryAt: "2024-01-02T00:00:00.000Z",
          respondedAt: "2024-01-01T00:05:00.000Z",
          responsibility: { owner: { kind: "user", userId: "user-1", workspaceRole: "owner", systemActor: null, label: "User" }, delegate: null, reviewer: null, escalationOwner: null, handoffStatus: "owner_control", audit: { requiredEvents: [], requireActorContext: false, requireReasonForDelegation: false, requireReasonForEscalation: false, requireReviewerIdentity: false }, lastChangedAt: null, handoffSummary: null, delegationReason: null, escalationReason: null, lastChangedBy: null }
        }
      ],
      evidenceRecords: [
        {
          id: "evidence-1",
          userId: "user-1",
          goalId: "goal-1",
          taskId: "task-1",
          approvalId: "approval-1",
          sourceKind: "approval_response",
          sourceId: "approval-1",
          sourceSummary: "Approved reply.",
          riskClass: "R2",
          requestedAction: "Send the draft to the customer.",
          requestRationale: "External replies need confirmation before sending.",
          requiresApproval: true,
          decision: "approved",
          decisionScope: "similar_24h",
          decisionRationale: "This matches the approved reply pattern.",
          respondedAt: "2024-01-01T00:05:00.000Z",
          resultingTaskState: "completed",
          resultingGoalStatus: "completed",
          actionLogIds: ["log-1", "log-2"],
          artifactIds: ["artifact-1"],
          memoryIds: ["memory-1"],
          actorContext: null,
          createdAt: "2024-01-01T00:05:00.000Z",
          updatedAt: "2024-01-01T00:06:00.000Z"
        }
      ],
      commitments: [],
      briefingPreferences: {
        userId: "user-1",
        timezone: "UTC",
        focus: "balanced",
        schedules: [],
        actorContext: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z"
      },
      autopilotSettings: {
        userId: "user-1",
        mode: "notify_only",
        debounceMinutes: 15,
        reliabilityControls: DEFAULT_AUTOPILOT_RELIABILITY_CONTROLS,
        actorContext: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z"
      },
      autopilotEvents: [],
      memories: [],
      integrations: [],
      watchers: [],
      filterBundlesForWorkspace: (goals) => goals,
      mergeCommitments: () => [],
      buildDiagnostics: () => ({
        status: "healthy",
        totalCount: 0,
        generatedAt: "2024-01-01T00:00:00.000Z",
        items: []
      }),
      buildControlPlane: ({ approvals, evidenceRecords }) => ({
        generatedAt: "2024-01-01T00:00:00.000Z",
        sections: [
          {
            key: "trust",
            title: "Trust",
            description: "Trust summary",
            status: "healthy",
            targetSection: "approvals",
            stats: [`${evidenceRecords.length} evidence`, `${approvals.length} approvals`, "Max auto R1"],
            highlights: []
          }
        ]
      }),
      buildNowQueue: () => ({
        generatedAt: "2024-01-01T00:00:00.000Z",
        totalCount: 0,
        items: []
      }),
      buildOperatingSections: ({ approvals, evidenceRecords }) => ({
        generatedAt: "2024-01-01T00:00:00.000Z",
        roleView: { role: null, label: "Default", summary: "Default view", focusAreas: [], prioritizedSectionKeys: [] },
        teamWorkflow: { mode: "setup", label: "Default", summary: "Default workflow", visibilityLabel: "Internal", queueMetrics: [], ownershipAssignments: [], queues: [], controls: [], auditCoverage: { required: false, status: "healthy", summary: "No audit required", latestStatus: null, latestCompletedAt: null }, actionBoundaries: [], handoffGuidance: [], permissions: { manageMembers: { level: "full", reason: null }, editGovernance: { level: "full", reason: null } } },
        nextBestAction: { kind: "configure_workspace", label: "No action", summary: "No pending actions", status: "healthy", targetSection: "trust", role: "editor" },
        sections: [
          {
            key: "trust",
            title: "Trust",
            description: "Trust summary",
            status: "healthy",
            targetSection: "approvals",
            metrics: [`${approvals.length} approvals`, `${evidenceRecords.length} evidence`],
            highlights: []
          }
        ]
      }) as any,
      buildBriefingHistory: () => [],
      sortArtifacts: (artifacts) => artifacts,
      sortActionLogs: (logs) => logs
    });

    expect(dashboard.approvals[0]?.explanation).toMatchObject({
      requestReason: "External replies need confirmation before sending.",
      decisionSummary: "Approved for similar 24h. This matches the approved reply pattern.",
      outcomeSummary: "Task is completed and goal is completed after the response.",
      evidenceSummary: "Linked 2 action logs, 1 artifact, and 1 memory.",
      evidence: {
        actionLogCount: 2,
        artifactCount: 1,
        memoryCount: 1,
        updatedAt: "2024-01-01T00:06:00.000Z"
      }
    });
  });

  it("attaches governance conformance to the assembled dashboard payload", () => {
    const dashboard = assembleDashboardData({
      userId: "user-1",
      workspaces: [],
      activeWorkspace: null,
      workspaceSelection: null,
      workspaceMembers: [],
      workspaceGovernance: {
        workspaceId: "workspace-1",
        approvalMode: "risk_based",
        requireAuditExports: false,
        maxAutoRunRiskClass: "R1",
        publicSharingEnabled: false,
        providerAccessRequiresApproval: false,
        externalSendRequiresApproval: true,
        calendarWriteRequiresApproval: true,
        escalationRequiresApproval: false,
        shadowReplayPolicy: { enabled: false, promotionMode: "disabled", rollbackOutcome: "downgrade_to_draft", minimumMatchedEpisodes: 1, minimumPrecision: 0.8, maximumNegativeOutcomeRate: 0.1, maximumFailureCostRate: 0.05 },
        retentionDays: 365,
        updatedBy: "user-1",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z"
      },
      goals: [],
      goalShares: [],
      privacyOperations: [],
      approvals: [],
      evidenceRecords: [],
      commitments: [],
      briefingPreferences: {
        userId: "user-1",
        timezone: "UTC",
        focus: "balanced",
        schedules: [],
        actorContext: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z"
      },
      autopilotSettings: {
        userId: "user-1",
        mode: "notify_only",
        debounceMinutes: 15,
        reliabilityControls: DEFAULT_AUTOPILOT_RELIABILITY_CONTROLS,
        actorContext: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z"
      },
      autopilotEvents: [],
      memories: [],
      integrations: [],
      watchers: [],
      filterBundlesForWorkspace: (goals) => goals,
      mergeCommitments: () => [],
      buildDiagnostics: () => ({
        status: "healthy",
        totalCount: 0,
        generatedAt: "2024-01-01T00:00:00.000Z",
        items: []
      }),
      buildControlPlane: () => ({
        generatedAt: "2024-01-01T00:00:00.000Z",
        sections: []
      }),
      buildNowQueue: () => ({
        generatedAt: "2024-01-01T00:00:00.000Z",
        totalCount: 0,
        items: []
      }),
      buildOperatingSections: () => ({
        generatedAt: "2024-01-01T00:00:00.000Z",
        roleView: { role: null, label: "Default", summary: "Default view", focusAreas: [], prioritizedSectionKeys: [] },
        teamWorkflow: { mode: "setup", label: "Default", summary: "Default workflow", visibilityLabel: "Internal", queueMetrics: [], ownershipAssignments: [], queues: [], controls: [], auditCoverage: { required: false, status: "healthy", summary: "No audit required", latestStatus: null, latestCompletedAt: null }, actionBoundaries: [], handoffGuidance: [], permissions: { manageMembers: { level: "full", reason: null }, editGovernance: { level: "full", reason: null } } },
        nextBestAction: { kind: "configure_workspace", label: "No action", summary: "No pending actions", status: "healthy", targetSection: "trust", role: "editor" },
        sections: []
      }) as any,
      buildBriefingHistory: () => [],
      sortArtifacts: (artifacts) => artifacts,
      sortActionLogs: (logs) => logs
    });

    expect(dashboard.governanceConformance).toMatchObject({
      status: "non_conformant",
      checks: expect.arrayContaining([
        expect.objectContaining({
          id: "audit-exports",
          status: "fail"
        }),
        expect.objectContaining({
          id: "retention-window",
          status: "pass"
        })
      ])
    });
  });
});
