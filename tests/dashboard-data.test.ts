import { assembleDashboardData } from "../packages/repository/src/dashboard-data";

describe("assembleDashboardData instrumentation", () => {
  const originalTimingLog = process.env.AGENTIC_DASHBOARD_TIMING_LOG;
  const originalWarnMs = process.env.AGENTIC_DASHBOARD_WARN_MS;

  afterEach(() => {
    process.env.AGENTIC_DASHBOARD_TIMING_LOG = originalTimingLog;
    process.env.AGENTIC_DASHBOARD_WARN_MS = originalWarnMs;
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
        timezone: "Asia/Singapore",
        focus: "balanced",
        schedules: [],
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z"
      },
      autopilotSettings: {
        userId: "user-1",
        mode: "notify_only",
        debounceMinutes: 15,
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
        timezone: "Asia/Singapore",
        focus: "balanced",
        schedules: [],
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z"
      },
      autopilotSettings: {
        userId: "user-1",
        mode: "notify_only",
        debounceMinutes: 15,
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
            title: "Review outbound reply",
            status: "completed",
            successCriteria: "Decision recorded",
            summary: "Resolve one approval",
            sourceRequest: "Review my inbox",
            explanation: "Approval workflow for an outbound reply.",
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z"
          },
          workflow: {
            id: "workflow-1",
            goalId: "goal-1",
            status: "completed",
            checkpoint: "done",
            updatedAt: "2024-01-01T00:00:00.000Z"
          },
          tasks: [
            {
              id: "task-1",
              goalId: "goal-1",
              title: "Send a reply",
              summary: "Send the approved response.",
              assignedAgent: "communications",
              state: "completed",
              riskClass: "R2",
              requiresApproval: true,
              dependsOn: [],
              toolCapabilities: ["draft", "send"],
              artifactIds: [],
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
            type: "send_message",
            adapter: "gmail",
            mode: "send",
            to: "customer@example.com",
            subject: "Follow-up",
            body: "Thanks for the update."
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
          respondedAt: "2024-01-01T00:05:00.000Z"
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
          createdAt: "2024-01-01T00:05:00.000Z",
          updatedAt: "2024-01-01T00:06:00.000Z"
        }
      ],
      commitments: [],
      briefingPreferences: {
        userId: "user-1",
        timezone: "Asia/Singapore",
        focus: "balanced",
        schedules: [],
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z"
      },
      autopilotSettings: {
        userId: "user-1",
        mode: "notify_only",
        debounceMinutes: 15,
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
      }),
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
});
