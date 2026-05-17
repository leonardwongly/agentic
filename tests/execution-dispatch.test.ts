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
import type { ActionExecutionConnectorReadiness } from "@agentic/integrations";
import { vi } from "vitest";

function buildBundle(params: {
  taskCapabilities: Array<"send" | "schedule" | "create" | "draft" | "read">;
  actionIntent: ReturnType<typeof ActionIntentSchema.parse>;
  assignedAgent?: "workflow" | "communications" | "calendar";
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
        assignedAgent: params.assignedAgent ?? "workflow",
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

const approvalGradeConnectors: ActionExecutionConnectorReadiness = {
  gmail: {
    tier: "approval-grade",
    label: "Approval-grade",
    reason: "Test Gmail readiness.",
    supportedModes: ["draft", "approval"],
    modeSupport: {
      draft: true,
      approval: true,
      autonomous: false
    },
    issues: [],
    managedProvider: null
  },
  calendar: {
    tier: "approval-grade",
    label: "Approval-grade",
    reason: "Test Calendar readiness.",
    supportedModes: ["draft", "approval"],
    modeSupport: {
      draft: true,
      approval: true,
      autonomous: false
    },
    issues: [],
    managedProvider: null
  }
};

describe("execution dispatch", () => {
  it("uses typed send_message intents instead of placeholder recipients", async () => {
    const bundle = buildBundle({
      assignedAgent: "communications",
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
      },
      connectorReadiness: approvalGradeConnectors
    });

    expect(result.success).toBe(true);
    expect(result.action).toBe("send_message");
    expect(result.kind).toBe("execution.completed");
    expect(result.outcome).toBe("completed");
    expect(result.retryable).toBe(false);
    expect(result.providerRef).toBe("draft-1");
    expect(result.idempotencyKey).toMatch(/^task:task-exec:/);
    expect(result.sideEffectTarget).toMatch(/^gmail:draft:client@example\.com:[0-9a-f]{16}$/);
    expect(result.recoveryStrategy).toBe("none");
    expect(result.dryRunSummary).toBe("Draft an email to client@example.com: Follow-up");
    expect(createDraft).toHaveBeenCalledWith({
      to: "client@example.com",
      subject: "Follow-up",
      body: "Here is the approved response.",
      idempotencyKey: result.idempotencyKey
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

  it("executes typed schedule_event intents with the validated calendar payload", async () => {
    const bundle = buildBundle({
      assignedAgent: "calendar",
      taskCapabilities: ["read", "schedule"],
      actionIntent: ActionIntentSchema.parse({
        type: "schedule_event",
        summary: "Customer handoff",
        start: "2026-04-20T09:00:00.000Z",
        end: "2026-04-20T09:30:00.000Z",
        description: "Share next steps and owners.",
        attendees: ["owner@example.com", "client@example.com"]
      })
    });
    const createEvent = vi.fn().mockResolvedValue({
      id: "event-1",
      htmlLink: "https://calendar.example.com/event-1"
    });

    const { result, log } = await executeApprovedTask({
      task: bundle.tasks[0],
      bundle,
      adapters: {
        calendar: {
          createEvent,
          updateEvent: vi.fn(),
          listUpcomingEvents: vi.fn()
        }
      },
      connectorReadiness: approvalGradeConnectors
    });

    expect(result.success).toBe(true);
    expect(result.action).toBe("schedule_event");
    expect(result.kind).toBe("execution.completed");
    expect(createEvent).toHaveBeenCalledWith({
      summary: "Customer handoff",
      start: "2026-04-20T09:00:00.000Z",
      end: "2026-04-20T09:30:00.000Z",
      description: "Share next steps and owners.",
      attendees: ["owner@example.com", "client@example.com"],
      idempotencyKey: result.idempotencyKey
    });
    expect(log.kind).toBe("execution.completed");
  });

  it("blocks provider execution when connector readiness is below approval-grade", async () => {
    const bundle = buildBundle({
      assignedAgent: "communications",
      taskCapabilities: ["read", "send"],
      actionIntent: ActionIntentSchema.parse({
        type: "send_message",
        to: "client@example.com",
        subject: "Follow-up",
        body: "Here is the approved response."
      })
    });
    const createDraft = vi.fn().mockResolvedValue({ id: "draft-should-not-exist" });

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
      connectorReadiness: {
        gmail: {
          tier: "experimental",
          label: "Experimental",
          reason: "Refresh token is missing.",
          supportedModes: [],
          modeSupport: {
            draft: false,
            approval: false,
            autonomous: false
          },
          issues: [],
          managedProvider: null
        }
      }
    });

    expect(result.success).toBe(false);
    expect(result.kind).toBe("execution.skipped");
    expect(result.outcome).toBe("skipped");
    expect(result.detail).toContain("gmail connector readiness is experimental");
    expect(result.recoveryStrategy).toBe("manual_review");
    expect(createDraft).not.toHaveBeenCalled();
    expect(log.kind).toBe("execution.skipped");

    const reconciled = reconcileExecutionResults({
      bundle: GoalBundleSchema.parse({
        ...bundle,
        tasks: bundle.tasks.map((task) => ({
          ...task,
          state: "queued" as const
        }))
      }),
      results: [result],
      logs: [log]
    });
    expect(reconciled.tasks[0]?.state).toBe("blocked");
    expect(reconciled.workflow.checkpoint).toBe("execution-recovery");
  });

  it("records partial-success metadata when draft creation succeeds but delivery fails", async () => {
    const bundle = buildBundle({
      assignedAgent: "communications",
      taskCapabilities: ["read", "send"],
      actionIntent: ActionIntentSchema.parse({
        type: "send_message",
        to: "client@example.com",
        subject: "Follow-up",
        body: "Here is the approved response.",
        mode: "send"
      })
    });
    const timeoutError = new Error("gmail send timed out");
    timeoutError.name = "TimeoutError";

    const { result, log } = await executeApprovedTask({
      task: bundle.tasks[0],
      bundle,
      adapters: {
        gmail: {
          createDraft: vi.fn().mockResolvedValue({ id: "draft-2" }),
          sendDraft: vi.fn().mockRejectedValue(timeoutError),
          listRecentEmails: vi.fn()
        }
      },
      connectorReadiness: approvalGradeConnectors
    });

    expect(result.success).toBe(false);
    expect(result.action).toBe("send_message");
    expect(result.kind).toBe("execution.failed");
    expect(result.outcome).toBe("partial_success");
    expect(result.retryable).toBe(true);
    expect(result.providerRef).toBe("draft-2");
    expect(result.idempotencyKey).toMatch(/^task:task-exec:/);
    expect(result.sideEffectTarget).toMatch(/^gmail:send:client@example\.com:[0-9a-f]{16}$/);
    expect(result.recoveryStrategy).toBe("retry");
    expect(result.compensationHints).toContain("Review draft draft-2 before retrying delivery.");
    expect(result.dryRunSummary).toBe("Draft and send email to client@example.com: Follow-up");
    expect(result.detail).toContain("Draft draft-2 was created but delivery failed");
    expect(log.kind).toBe("execution.failed");
    expect(log.details).toMatchObject({
      outcome: "partial_success",
      retryable: true,
      providerRef: "draft-2",
      recoveryStrategy: "retry"
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
        assignedAgent: "communications",
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
      connectorReadiness: approvalGradeConnectors,
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
      assignedAgent: "communications",
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
      connectorReadiness: approvalGradeConnectors,
      governance: buildGovernance()
    });

    expect(result.success).toBe(true);
    expect(result.kind).toBe("execution.completed");
    expect(createDraft).toHaveBeenCalledTimes(1);
  });

  it("falls back to manual review when no approved typed approval is present", async () => {
    const bundle = GoalBundleSchema.parse({
      ...buildBundle({
        taskCapabilities: ["read", "create"],
        actionIntent: ActionIntentSchema.parse({
          type: "create_note",
          title: "Weekly plan",
          content: "Focus blocks and follow-up items."
        })
      }),
      approvals: []
    });
    const createLocalNote = vi.fn().mockResolvedValue({ slug: "weekly-plan" });

    const { result, log } = await executeApprovedTask({
      task: bundle.tasks[0],
      bundle,
      adapters: {
        notes: {
          createLocalNote
        }
      }
    });

    expect(result.success).toBe(false);
    expect(result.kind).toBe("execution.skipped");
    expect(result.detail).toContain("cannot be executed automatically");
    expect(createLocalNote).not.toHaveBeenCalled();
    expect(log.kind).toBe("execution.skipped");
  });

  it("skips execution when the typed intent exceeds the task capability grant", async () => {
    const bundle = buildBundle({
      taskCapabilities: ["read"],
      actionIntent: ActionIntentSchema.parse({
        type: "create_note",
        title: "Weekly plan",
        content: "Focus blocks and follow-up items."
      })
    });
    const createLocalNote = vi.fn().mockResolvedValue({ slug: "weekly-plan" });

    const { result, log } = await executeApprovedTask({
      task: bundle.tasks[0],
      bundle,
      adapters: {
        notes: {
          createLocalNote
        }
      }
    });

    expect(result.success).toBe(false);
    expect(result.kind).toBe("execution.skipped");
    expect(result.detail).toContain("require one of [create]");
    expect(createLocalNote).not.toHaveBeenCalled();
    expect(log.kind).toBe("execution.skipped");
  });

  it("skips expanded typed intents when the intent risk exceeds the task grant", async () => {
    const bundle = buildBundle({
      assignedAgent: "workflow",
      taskCapabilities: ["read", "update"],
      actionIntent: ActionIntentSchema.parse({
        type: "update_record",
        riskClass: "R4",
        targetType: "goal",
        targetId: "goal-exec",
        patch: { status: "running" },
        reason: "Attempt to update a high-risk record without matching grant."
      })
    });

    const { result, log } = await executeApprovedTask({
      task: bundle.tasks[0],
      bundle,
      adapters: {}
    });

    expect(result.success).toBe(false);
    expect(result.kind).toBe("execution.skipped");
    expect(result.detail).toContain("risk R4 exceeds task risk grant R3");
    expect(log.kind).toBe("execution.skipped");
  });

  it("skips execution when the task capability grant violates the agent allowlist", async () => {
    const bundle = buildBundle({
      assignedAgent: "communications",
      taskCapabilities: ["read", "create"],
      actionIntent: ActionIntentSchema.parse({
        type: "create_note",
        title: "Weekly plan",
        content: "Focus blocks and follow-up items."
      })
    });
    const createLocalNote = vi.fn().mockResolvedValue({ slug: "weekly-plan" });

    const { result, log } = await executeApprovedTask({
      task: bundle.tasks[0],
      bundle,
      adapters: {
        notes: {
          createLocalNote
        }
      }
    });

    expect(result.success).toBe(false);
    expect(result.kind).toBe("execution.skipped");
    expect(result.detail).toContain('granted disallowed capability "create"');
    expect(createLocalNote).not.toHaveBeenCalled();
    expect(log.kind).toBe("execution.skipped");
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
