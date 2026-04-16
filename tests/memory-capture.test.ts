import { createHumanActorContext, type GoalBundle } from "@agentic/contracts";
import { captureExecutionOutcomeSignals, captureMemoriesFromBundle } from "@agentic/orchestrator";

function buildBundle(): GoalBundle {
  return {
    goal: {
      id: "goal-1",
      title: "Inbox triage",
      request: "Review my inbox and draft replies.",
      intent: "communications-triage",
      status: "active",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z"
    },
    workflow: {
      id: "workflow-1",
      goalId: "goal-1",
      state: "pending",
      startedAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      completedAt: null,
      blockedReason: null,
      lastTaskId: null,
      nextTaskId: null,
      lane: "active"
    },
    tasks: [
      {
        id: "task-1",
        title: "Draft sender-aware replies",
        summary: "Prepare reply drafts.",
        state: "completed",
        assignedAgent: "communications",
        toolCapabilities: ["draft", "send"],
        riskClass: "R2",
        dependsOn: [],
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z"
      },
      {
        id: "task-2",
        title: "Capture follow-up note",
        summary: "Create a local note with next steps.",
        state: "completed",
        assignedAgent: "workflow",
        toolCapabilities: ["create"],
        riskClass: "R1",
        dependsOn: [],
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z"
      }
    ],
    artifacts: [],
    approvals: [],
    actionLogs: []
  };
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
    expect(captured.episodes[1].metadata).toMatchObject({
      goalId: "goal-1",
      taskId: "task-2",
      action: "create_note",
      success: false
    });
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
});

describe("captureMemoriesFromBundle", () => {
  it("propagates actor attribution onto auto-captured memory records", () => {
    const actorContext = createHumanActorContext("user-1", "session-1");
    const captured = captureMemoriesFromBundle(buildBundle(), "user-1", actorContext);

    expect(captured.memories).toHaveLength(2);
    expect(captured.memories.every((memory) => memory.actorContext?.subjectUserId === "user-1")).toBe(true);
    expect(captured.episodes).toHaveLength(2);
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
});
