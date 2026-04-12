import {
  ActionIntentSchema,
  ApprovalRequestSchema,
  ArtifactSchema,
  GoalBundleSchema,
  GoalSchema,
  TaskSchema,
  WorkflowStateSchema,
  nowIso,
  type WorkspaceGovernance
} from "@agentic/contracts";
import { executeApprovedTask, reconcileExecutionResults } from "@agentic/orchestrator";
import { vi } from "vitest";

function buildBundle(params: {
  taskCapabilities: Array<"send" | "schedule" | "create" | "draft" | "read">;
  actionIntent: ReturnType<typeof ActionIntentSchema.parse>;
}) {
  const goalId = "goal-exec";
  const workflowId = "workflow-exec";
  const taskId = "task-exec";

  return GoalBundleSchema.parse({
    goal: GoalSchema.parse({
      id: goalId,
      userId: "user-1",
      workflowId,
      title: "Execution test goal",
      request: "Test execution dispatch.",
      intent: "general-coordination",
      status: "running",
      confidence: 0.8,
      explanation: "Execution test bundle.",
      createdAt: nowIso(),
      updatedAt: nowIso()
    }),
    workflow: WorkflowStateSchema.parse({
      id: workflowId,
      goalId,
      status: "waiting",
      currentStep: "approval-gate",
      checkpoint: "approval-gate",
      createdAt: nowIso(),
      updatedAt: nowIso()
    }),
    tasks: [
      TaskSchema.parse({
        id: taskId,
        goalId,
        workflowId,
        title: "Dispatch task",
        summary: "Execute a typed intent.",
        assignedAgent: "workflow",
        state: "waiting",
        riskClass: "R3",
        requiresApproval: true,
        toolCapabilities: params.taskCapabilities,
        artifactIds: ["artifact-1"],
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
    ],
    artifacts: [
      ArtifactSchema.parse({
        id: "artifact-1",
        goalId,
        taskId,
        artifactType: "draft",
        title: "Draft output",
        content: "This content should not override typed execution payloads.",
        createdAt: nowIso()
      })
    ],
    approvals: [
      ApprovalRequestSchema.parse({
        id: "approval-1",
        goalId,
        taskId,
        title: "Review dispatch",
        rationale: "Needs explicit confirmation.",
        riskClass: "R3",
        decision: "approved",
        requestedAction: "Execute a typed intent.",
        actionIntent: params.actionIntent,
        createdAt: nowIso(),
        expiryAt: new Date(Date.now() + 60_000).toISOString(),
        respondedAt: nowIso()
      })
    ],
    watchers: [],
    actionLogs: []
  });
}

function buildGovernance(overrides: Partial<WorkspaceGovernance> = {}): WorkspaceGovernance {
  return {
    workspaceId: "workspace-1",
    approvalMode: "risk_based",
    requireAuditExports: false,
    maxAutoRunRiskClass: "R1",
    externalSendRequiresApproval: true,
    calendarWriteRequiresApproval: true,
    retentionDays: 365,
    updatedBy: "user-1",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...overrides
  };
}

describe("execution dispatch", () => {
  it("uses typed send_message intents instead of placeholder recipients", async () => {
    const bundle = buildBundle({
      taskCapabilities: ["read", "send"],
      actionIntent: ActionIntentSchema.parse({
        type: "send_message",
        to: "client@example.com",
        subject: "Follow-up",
        body: "Here is the approved response."
      })
    });
    const createDraft = vi.fn().mockResolvedValue({ id: "draft-1" });

    const { result, log } = await executeApprovedTask({
      task: bundle.tasks[0],
      bundle,
      adapters: {
        gmail: {
          createDraft,
          sendDraft: vi.fn(),
          listRecentEmails: vi.fn()
        }
      }
    });

    expect(result.success).toBe(true);
    expect(result.action).toBe("send_message");
    expect(result.kind).toBe("execution.completed");
    expect(createDraft).toHaveBeenCalledWith({
      to: "client@example.com",
      subject: "Follow-up",
      body: "Here is the approved response."
    });
    expect(log.kind).toBe("execution.completed");
  });

  it("executes typed create_note intents with the validated note payload", async () => {
    const bundle = buildBundle({
      taskCapabilities: ["read", "create"],
      actionIntent: ActionIntentSchema.parse({
        type: "create_note",
        title: "Weekly plan",
        content: "Focus blocks and follow-up items."
      })
    });
    const createLocalNote = vi.fn().mockResolvedValue({ slug: "weekly-plan" });

    const { result } = await executeApprovedTask({
      task: bundle.tasks[0],
      bundle,
      adapters: {
        notes: {
          createLocalNote
        }
      }
    });

    expect(result.success).toBe(true);
    expect(result.kind).toBe("execution.completed");
    expect(createLocalNote).toHaveBeenCalledWith({
      title: "Weekly plan",
      content: "Focus blocks and follow-up items."
    });
  });

  it("skips execution when approval only carries a manual-review intent", async () => {
    const bundle = buildBundle({
      taskCapabilities: ["read", "send"],
      actionIntent: ActionIntentSchema.parse({
        type: "manual_review",
        actionType: "send",
        summary: "Review the outbound draft manually.",
        reason: "No validated recipient was captured.",
        artifactIds: ["artifact-1"]
      })
    });
    const createDraft = vi.fn();

    const { result, log } = await executeApprovedTask({
      task: bundle.tasks[0],
      bundle,
      adapters: {
        gmail: {
          createDraft,
          sendDraft: vi.fn(),
          listRecentEmails: vi.fn()
        }
      }
    });

    expect(result.success).toBe(false);
    expect(result.action).toBe("manual_review");
    expect(result.kind).toBe("execution.skipped");
    expect(result.detail).toMatch(/execution skipped/i);
    expect(createDraft).not.toHaveBeenCalled();
    expect(log.kind).toBe("execution.skipped");
  });

  it("re-checks governance and skips external sends when no approved approval is present", async () => {
    const bundle = GoalBundleSchema.parse({
      ...buildBundle({
        taskCapabilities: ["read", "send"],
        actionIntent: ActionIntentSchema.parse({
          type: "send_message",
          to: "client@example.com",
          subject: "Follow-up",
          body: "Here is the approved response."
        })
      }),
      approvals: []
    });
    const createDraft = vi.fn().mockResolvedValue({ id: "draft-1" });

    const { result, log } = await executeApprovedTask({
      task: bundle.tasks[0],
      bundle,
      adapters: {
        gmail: {
          createDraft,
          sendDraft: vi.fn(),
          listRecentEmails: vi.fn()
        }
      },
      governance: buildGovernance()
    });

    expect(result.success).toBe(false);
    expect(result.kind).toBe("execution.skipped");
    expect(result.detail).toContain("requires approval before external sends");
    expect(createDraft).not.toHaveBeenCalled();
    expect(log.kind).toBe("execution.skipped");
  });

  it("allows execution when governance would require approval but a matching approval is already approved", async () => {
    const bundle = buildBundle({
      taskCapabilities: ["read", "send"],
      actionIntent: ActionIntentSchema.parse({
        type: "send_message",
        to: "client@example.com",
        subject: "Follow-up",
        body: "Here is the approved response."
      })
    });
    const createDraft = vi.fn().mockResolvedValue({ id: "draft-1" });

    const { result } = await executeApprovedTask({
      task: bundle.tasks[0],
      bundle,
      adapters: {
        gmail: {
          createDraft,
          sendDraft: vi.fn(),
          listRecentEmails: vi.fn()
        }
      },
      governance: buildGovernance()
    });

    expect(result.success).toBe(true);
    expect(result.kind).toBe("execution.completed");
    expect(createDraft).toHaveBeenCalledTimes(1);
  });

  it("reconciles successful execution into completed task state and completed workflow status", () => {
    const queuedBundle = GoalBundleSchema.parse({
      ...buildBundle({
        taskCapabilities: ["read", "create"],
        actionIntent: ActionIntentSchema.parse({
          type: "create_note",
          title: "Weekly plan",
          content: "Focus blocks and follow-up items."
        })
      }),
      workflow: {
        ...buildBundle({
          taskCapabilities: ["read", "create"],
          actionIntent: ActionIntentSchema.parse({
            type: "create_note",
            title: "Weekly plan",
            content: "Focus blocks and follow-up items."
          })
        }).workflow,
        status: "running"
      },
      tasks: buildBundle({
        taskCapabilities: ["read", "create"],
        actionIntent: ActionIntentSchema.parse({
          type: "create_note",
          title: "Weekly plan",
          content: "Focus blocks and follow-up items."
        })
      }).tasks.map((task) => ({
        ...task,
        state: "queued" as const
      }))
    });
    const reconciled = reconcileExecutionResults({
      bundle: queuedBundle,
      results: [
        {
          taskId: queuedBundle.tasks[0].id,
          success: true,
          action: "create_note",
          detail: "Local note created (slug: weekly-plan).",
          timestamp: nowIso(),
          kind: "execution.completed"
        }
      ]
    });

    expect(reconciled.tasks[0]?.state).toBe("completed");
    expect(reconciled.goal.status).toBe("completed");
    expect(reconciled.workflow.status).toBe("completed");
    expect(reconciled.workflow.checkpoint).toBe("done");
    expect(reconciled.actionLogs.some((log) => log.kind === "task.state_changed")).toBe(true);
  });

  it("reconciles skipped execution into blocked task state and recovery checkpoint", () => {
    const queuedBundle = GoalBundleSchema.parse({
      ...buildBundle({
        taskCapabilities: ["read", "send"],
        actionIntent: ActionIntentSchema.parse({
          type: "manual_review",
          actionType: "send",
          summary: "Review the outbound draft manually.",
          reason: "No validated recipient was captured.",
          artifactIds: ["artifact-1"]
        })
      }),
      workflow: {
        ...buildBundle({
          taskCapabilities: ["read", "send"],
          actionIntent: ActionIntentSchema.parse({
            type: "manual_review",
            actionType: "send",
            summary: "Review the outbound draft manually.",
            reason: "No validated recipient was captured.",
            artifactIds: ["artifact-1"]
          })
        }).workflow,
        status: "running"
      },
      tasks: buildBundle({
        taskCapabilities: ["read", "send"],
        actionIntent: ActionIntentSchema.parse({
          type: "manual_review",
          actionType: "send",
          summary: "Review the outbound draft manually.",
          reason: "No validated recipient was captured.",
          artifactIds: ["artifact-1"]
        })
      }).tasks.map((task) => ({
        ...task,
        state: "queued" as const
      }))
    });
    const reconciled = reconcileExecutionResults({
      bundle: queuedBundle,
      results: [
        {
          taskId: queuedBundle.tasks[0].id,
          success: false,
          action: "manual_review",
          detail: "Execution skipped: No validated recipient was captured.",
          timestamp: nowIso(),
          kind: "execution.skipped"
        }
      ]
    });

    expect(reconciled.tasks[0]?.state).toBe("blocked");
    expect(reconciled.goal.status).toBe("running");
    expect(reconciled.workflow.status).toBe("running");
    expect(reconciled.workflow.checkpoint).toBe("execution-recovery");
  });
});
