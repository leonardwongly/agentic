import {
  GoalBundleSchema,
  WorkspaceGovernanceSchema,
  createHumanActorContext,
  enterpriseWorkspaceGovernanceDefaults
} from "@agentic/contracts";
import { captureExecutionOutcomeSignals, captureMemoriesFromBundle } from "@agentic/orchestrator";

function buildGovernance(overrides: Partial<ReturnType<typeof WorkspaceGovernanceSchema.parse>> = {}) {
  return WorkspaceGovernanceSchema.parse({
    workspaceId: "workspace-1",
    ...enterpriseWorkspaceGovernanceDefaults,
    updatedBy: "user-1",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides
  });
}

function buildBundle() {
  return GoalBundleSchema.parse({
    goal: {
      id: "goal-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      workflowId: "workflow-1",
      title: "Inbox triage",
      request: "Review my inbox and draft replies.",
      intent: "communications-triage",
      status: "running",
      confidence: 0.91,
      explanation: "High confidence based on prior inbox triage behavior and explicit user request.",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z"
    },
    workflow: {
      id: "workflow-1",
      goalId: "goal-1",
      workspaceId: "workspace-1",
      status: "running",
      currentStep: "communications",
      checkpoint: null,
      startedAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      createdAt: "2024-01-01T00:00:00.000Z"
    },
    tasks: [
      {
        id: "task-1",
        goalId: "goal-1",
        workflowId: "workflow-1",
        title: "Draft sender-aware replies",
        summary: "Prepare reply drafts.",
        state: "completed",
        assignedAgent: "communications",
        toolCapabilities: ["draft", "send"],
        riskClass: "R2",
        requiresApproval: true,
        dependsOn: [],
        artifactIds: ["artifact-1"],
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z"
      },
      {
        id: "task-2",
        goalId: "goal-1",
        workflowId: "workflow-1",
        title: "Capture follow-up note",
        summary: "Create a local note with next steps.",
        state: "completed",
        assignedAgent: "workflow",
        toolCapabilities: ["create"],
        riskClass: "R1",
        requiresApproval: false,
        dependsOn: [],
        artifactIds: [],
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z"
      }
    ],
    artifacts: [
      {
        id: "artifact-1",
        goalId: "goal-1",
        taskId: "task-1",
        artifactType: "draft",
        title: "VIP reply draft",
        content: "Draft response for vip@example.com.",
        createdAt: "2024-01-01T00:00:00.000Z"
      }
    ],
    approvals: [
      {
        id: "approval-1",
        goalId: "goal-1",
        taskId: "task-1",
        title: "Approve VIP follow-up",
        rationale: "External customer reply needs confirmation before execution.",
        riskClass: "R2",
        decision: "approved",
        requestedAction: "Draft a sender-aware follow-up for vip@example.com.",
        actionIntent: {
          type: "send_message",
          adapter: "gmail",
          to: "vip@example.com",
          subject: "Re: Next steps",
          body: "Hi, here is the draft follow-up.",
          threadId: null,
          mode: "draft"
        },
        decisionScope: "once",
        decisionRationale: "Approved for this customer follow-up only.",
        history: [
          {
            decision: "approved",
            scope: "once",
            rationale: "Approved for this customer follow-up only.",
            actor: "user-1",
            createdAt: "2024-01-01T00:00:00.000Z"
          }
        ],
        explanation: {
          requestReason: "Customer-facing follow-up requires a review checkpoint.",
          impactSummary: "Drafts a reply that may be sent externally after review."
        },
        createdAt: "2024-01-01T00:00:00.000Z",
        expiryAt: "2024-01-03T00:00:00.000Z",
        respondedAt: "2024-01-01T00:00:00.000Z"
      }
    ],
    watchers: [],
    actionLogs: []
  });
}

describe("captureExecutionOutcomeSignals", () => {
  it("returns no records when no execution results are provided", () => {
    const captured = captureExecutionOutcomeSignals(buildBundle(), "user-1", []);

    expect(captured.memories).toHaveLength(0);
    expect(captured.episodes).toHaveLength(0);
  });

  it("captures a summary memory and episodes for mixed execution outcomes", () => {
    const actorContext = createHumanActorContext("user-1", "session-1");
    const captured = captureExecutionOutcomeSignals(buildBundle(), "user-1", [
      {
        taskId: "task-1",
        success: true,
        action: "send_message",
        detail: "Draft created (id: draft-1) for vip@example.com.",
        timestamp: "2024-01-01T00:01:00.000Z",
        kind: "execution.completed"
      },
      {
        taskId: "task-2",
        success: false,
        action: "create_note",
        detail: "Execution failed: disk quota exceeded while writing note content.",
        timestamp: "2024-01-01T00:02:00.000Z",
        kind: "execution.failed"
      }
    ], actorContext);

    expect(captured.memories).toHaveLength(2);
    expect(captured.memories[0].content).toContain("1 succeeded, 1 failed or were skipped");
    expect(captured.memories[1].content).toContain("disk quota exceeded");
    expect(captured.memories.every((memory) => memory.actorContext?.subjectUserId === "user-1")).toBe(true);
    expect(captured.episodes).toHaveLength(2);
    expect(captured.episodes[0].outcome).toBe("success");
    expect(captured.episodes[1].outcome).toBe("failure");
    expect(captured.episodes[0].recommendation).toMatchObject({
      kind: "execution_path",
      action: "send_message",
      fallbackMode: "normal",
      evidenceHint: "established"
    });
    expect(captured.episodes[0].outcomeLink).toMatchObject({
      taskId: "task-1",
      approvalDecision: "approved",
      executionKind: "completed",
      outcomeScore: 1
    });
    expect(captured.episodes[0].provenance).toMatchObject({
      ownerUserId: "user-1",
      workspaceId: "workspace-1",
      source: "execution"
    });
    expect(captured.episodes[0].provenance.memoryIds.length).toBeGreaterThan(0);
    expect(captured.episodes[1].recommendation).toMatchObject({
      kind: "execution_path",
      action: "create_note",
      fallbackMode: "review_required"
    });
    expect(captured.episodes[1].outcomeLink).toMatchObject({
      taskId: "task-2",
      executionKind: "failed",
      outcomeScore: -1
    });
    expect(captured.episodes[1].metadata).toMatchObject({
      goalId: "goal-1",
      taskId: "task-2",
      action: "create_note",
      success: false
    });
    expect(captured.episodes[1].privacy.retention.expiresAt).toBe("2024-12-31T00:02:00.000Z");
  });

  it("links execution episodes to task-scoped approval evidence records", () => {
    const captured = captureExecutionOutcomeSignals(
      buildBundle(),
      "user-1",
      [
        {
          taskId: "task-1",
          success: true,
          action: "send_message",
          detail: "Draft created (id: draft-1) for vip@example.com.",
          timestamp: "2024-01-01T00:01:00.000Z",
          kind: "execution.completed"
        },
        {
          taskId: "task-2",
          success: false,
          action: "create_note",
          detail: "Execution failed: disk quota exceeded while writing note content.",
          timestamp: "2024-01-01T00:02:00.000Z",
          kind: "execution.failed"
        }
      ],
      createHumanActorContext("user-1", "session-1"),
      {
        evidenceRecordIdsByTaskId: {
          "task-1": ["evidence-task-1", "evidence-task-1", " "],
          "task-2": ["evidence-task-2"]
        }
      }
    );

    expect(captured.episodes[0].provenance.evidenceRecordIds).toEqual(["evidence-task-1"]);
    expect(captured.episodes[1].provenance.evidenceRecordIds).toEqual(["evidence-task-2"]);
  });

  it("truncates oversized execution detail in failure memories and episodes", () => {
    const oversizedDetail = `Execution failed: ${"x".repeat(400)}`;
    const captured = captureExecutionOutcomeSignals(buildBundle(), "user-1", [
      {
        taskId: "task-2",
        success: false,
        action: "create_note",
        detail: oversizedDetail,
        timestamp: "2024-01-01T00:03:00.000Z",
        kind: "execution.failed"
      }
    ]);

    expect(captured.memories).toHaveLength(2);
    expect(captured.memories[1].content.length).toBeLessThan(500);
    expect(String(captured.episodes[0].metadata?.detail).length).toBeLessThanOrEqual(220);
    expect(String(captured.episodes[0].metadata?.detail)).toContain("...");
  });

  it("redacts sensitive execution details before learning capture", () => {
    const captured = captureExecutionOutcomeSignals(buildBundle(), "user-1", [
      {
        taskId: "task-1",
        success: false,
        action: "send_message",
        detail: "Execution failed for vip@example.com with token=abc123.",
        timestamp: "2024-01-01T00:04:00.000Z",
        kind: "execution.failed"
      }
    ]);

    expect(JSON.stringify(captured)).not.toContain("vip@example.com");
    expect(JSON.stringify(captured)).not.toContain("abc123");
    expect(captured.episodes[0].privacy.redaction).toMatchObject({
      applied: true,
      rules: ["email", "secret-like"]
    });
  });
});

describe("captureMemoriesFromBundle", () => {
  it("propagates actor attribution onto auto-captured memory records", () => {
    const actorContext = createHumanActorContext("user-1", "session-1");
    const captured = captureMemoriesFromBundle(buildBundle(), "user-1", actorContext);

    expect(captured.memories).toHaveLength(3);
    expect(captured.memories.every((memory) => memory.actorContext?.subjectUserId === "user-1")).toBe(true);
    expect(captured.memories[2]?.content).toContain('User approved "Draft sender-aware replies"');
    expect(captured.episodes).toHaveLength(2);
    expect(captured.episodes[0].recommendation).toMatchObject({
      kind: "task_plan",
      action: "send_message",
      fallbackMode: "normal",
      sourceGoalId: "goal-1",
      sourceTaskId: "task-1"
    });
    expect(captured.episodes[0].outcomeLink).toMatchObject({
      workflowId: "workflow-1",
      taskId: "task-1",
      approvalDecision: "approved",
      executionKind: "completed",
      outcomeScore: 1
    });
    expect(captured.episodes[0].privacy).toMatchObject({
      sensitivity: "R2",
      retention: expect.objectContaining({
        reviewAt: "2024-03-31T00:00:00.000Z",
        expiresAt: "2024-12-31T00:00:00.000Z"
      })
    });
    expect(captured.episodes[1].recommendation).toMatchObject({
      kind: "task_plan",
      action: "create_record",
      fallbackMode: "normal"
    });
    expect(captured.episodes[1].outcomeLink).toMatchObject({
      taskId: "task-2",
      executionKind: "completed",
      outcomeScore: 1
    });
  });

  it("links goal-bundle episodes to task-scoped approval evidence records", () => {
    const captured = captureMemoriesFromBundle(
      buildBundle(),
      "user-1",
      createHumanActorContext("user-1", "session-1"),
      {
        evidenceRecordIdsByTaskId: {
          "task-1": ["evidence-task-1"]
        }
      }
    );

    expect(captured.episodes[0].provenance.evidenceRecordIds).toEqual(["evidence-task-1"]);
    expect(captured.episodes[1].provenance.evidenceRecordIds).toEqual([]);
  });

  it("uses deterministic ids so repeated capture stays idempotent across retries", () => {
    const actorContext = createHumanActorContext("user-1", "session-1");
    const firstCapture = captureMemoriesFromBundle(buildBundle(), "user-1", actorContext);
    const secondCapture = captureMemoriesFromBundle(buildBundle(), "user-1", actorContext);

    expect(secondCapture.memories.map((memory) => memory.id)).toEqual(firstCapture.memories.map((memory) => memory.id));
    expect(secondCapture.episodes.map((episode) => episode.id)).toEqual(firstCapture.episodes.map((episode) => episode.id));
    expect(secondCapture.memories.map((memory) => memory.createdAt)).toEqual(firstCapture.memories.map((memory) => memory.createdAt));
    expect(secondCapture.episodes.map((episode) => episode.timestamp)).toEqual(firstCapture.episodes.map((episode) => episode.timestamp));
  });

  it("attaches retention and lifecycle metadata before persistence", () => {
    const captured = captureMemoriesFromBundle(buildBundle(), "user-1", createHumanActorContext("user-1", "session-1"), {
      governance: buildGovernance({ retentionDays: 30 }),
      now: "2024-01-01T00:00:00.000Z"
    });

    expect(captured.memories).not.toHaveLength(0);
    expect(captured.memories.every((memory) => memory.sensitivity === "learning-redacted")).toBe(true);
    expect(captured.memories.every((memory) => memory.reviewAt === "2024-01-16T00:00:00.000Z")).toBe(true);
    expect(captured.memories.every((memory) => memory.expiryAt === "2024-01-31T00:00:00.000Z")).toBe(true);
    expect(captured.episodes.every((episode) => episode.metadata?.learningPrivacy)).toBe(true);
    expect(captured.episodes[0].metadata?.learningPrivacy).toMatchObject({
      datasetId: "learning-capture-records",
      userId: "user-1",
      workspaceId: "workspace-1",
      captureAllowed: true,
      retentionDays: 30,
      expiresAt: "2024-01-31T00:00:00.000Z",
      exportable: true,
      deletable: true,
      redacted: true
    });
  });

  it("honors workspace learning opt-out before creating records", () => {
    const captured = captureMemoriesFromBundle(buildBundle(), "user-1", createHumanActorContext("user-1", "session-1"), {
      governance: buildGovernance({
        shadowReplayPolicy: {
          ...enterpriseWorkspaceGovernanceDefaults.shadowReplayPolicy,
          enabled: false
        }
      })
    });

    expect(captured.memories).toEqual([]);
    expect(captured.episodes).toEqual([]);
  });

  it("fails closed on user and actor boundary mismatches", () => {
    const captured = captureMemoriesFromBundle(buildBundle(), "user-2", createHumanActorContext("user-1", "session-1"), {
      governance: buildGovernance()
    });

    expect(captured.memories).toEqual([]);
    expect(captured.episodes).toEqual([]);
  });
});

describe("captureExecutionOutcomeSignals", () => {
  it("uses deterministic ids for repeated execution outcome capture", () => {
    const results = [
      {
        taskId: "task-1",
        success: true,
        action: "send_message",
        detail: "Draft created (id: draft-1) for vip@example.com.",
        timestamp: "2024-01-01T00:01:00.000Z",
        kind: "execution.completed" as const
      },
      {
        taskId: "task-2",
        success: false,
        action: "create_note",
        detail: "Execution failed: disk quota exceeded while writing note content.",
        timestamp: "2024-01-01T00:02:00.000Z",
        kind: "execution.failed" as const
      }
    ];
    const firstCapture = captureExecutionOutcomeSignals(buildBundle(), "user-1", results);
    const secondCapture = captureExecutionOutcomeSignals(buildBundle(), "user-1", results);

    expect(secondCapture.memories.map((memory) => memory.id)).toEqual(firstCapture.memories.map((memory) => memory.id));
    expect(secondCapture.episodes.map((episode) => episode.id)).toEqual(firstCapture.episodes.map((episode) => episode.id));
  });

  it("redacts sensitive execution details before memory and episode persistence", () => {
    const captured = captureExecutionOutcomeSignals(
      buildBundle(),
      "user-1",
      [
        {
          taskId: "task-2",
          success: false,
          action: "create_note",
          detail: "Failed for vip@example.com with token=ghp_1234567890abcdef and Authorization: Bearer secretBearerValue123.",
          timestamp: "2024-01-01T00:03:00.000Z",
          kind: "execution.failed"
        }
      ],
      createHumanActorContext("user-1", "session-1"),
      {
        governance: buildGovernance()
      }
    );

    const serialized = JSON.stringify(captured);
    expect(serialized).not.toContain("vip@example.com");
    expect(serialized).not.toContain("ghp_1234567890abcdef");
    expect(serialized).not.toContain("secretBearerValue123");
    expect(serialized).toContain("[redacted-email]");
    expect(serialized).toContain("[redacted-secret]");
    expect(serialized).toContain("[redacted-token]");
  });
});
