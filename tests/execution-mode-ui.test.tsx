import { renderToStaticMarkup } from "react-dom/server";
import { ApprovalRequestSchema, ArtifactSchema, GoalBundleSchema, TaskSchema, nowIso } from "@agentic/contracts";
import {
  ExecutionModeBadge,
  ImplementationTierBadge,
  approvalMatchesExecutionModeFilter,
  bundleMatchesExecutionModeFilter,
  extractArtifactExecutionMode,
  findTaskExecutionMode,
  getExecutionModeFilterOption,
  getImplementationTierPresentation,
  getExecutionModePresentation,
  matchesExecutionModeFilter
} from "../apps/web/components/ui";

describe("execution mode UI helpers", () => {
  it("derives task execution mode from linked artifact metadata and falls back safely", () => {
    const task = TaskSchema.parse({
      id: "task-1",
      goalId: "goal-1",
      workflowId: "workflow-1",
      title: "Task",
      summary: "Task summary",
      assignedAgent: "workflow",
      state: "running",
      riskClass: "R2",
      requiresApproval: false,
      dependsOn: [],
      toolCapabilities: ["create"],
      artifactIds: ["artifact-1"],
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    const artifact = ArtifactSchema.parse({
      id: "artifact-1",
      goalId: "goal-1",
      taskId: "task-1",
      artifactType: "draft",
      title: "Artifact",
      content: "Artifact content",
      metadata: {
        executionMode: "custom_prompt_scaffold"
      },
      createdAt: nowIso()
    });

    expect(extractArtifactExecutionMode(artifact)).toBe("custom_prompt_scaffold");
    expect(findTaskExecutionMode(task, [artifact])).toBe("custom_prompt_scaffold");
    expect(findTaskExecutionMode(task, [{ ...artifact, metadata: {} }])).toBeNull();
  });

  it("renders unavailable mode explicitly instead of implying production execution", () => {
    const markup = renderToStaticMarkup(<ExecutionModeBadge mode={null} />);

    expect(markup).toContain("Mode unavailable");
    expect(getExecutionModePresentation(null).label).toBe("Mode unavailable");
  });

  it("renders explicit implementation tiers for production and incomplete execution paths", () => {
    const governedMarkup = renderToStaticMarkup(<ImplementationTierBadge mode="governed_specialist" />);
    const scaffoldMarkup = renderToStaticMarkup(<ImplementationTierBadge mode="custom_prompt_scaffold" />);
    const unavailableMarkup = renderToStaticMarkup(<ImplementationTierBadge mode={null} />);

    expect(governedMarkup).toContain("Production");
    expect(scaffoldMarkup).toContain("Experimental");
    expect(unavailableMarkup).toContain("Tier unavailable");
    expect(getImplementationTierPresentation("governed_specialist").label).toBe("Production");
    expect(getImplementationTierPresentation("manual_review_required").label).toBe("Experimental");
    expect(getImplementationTierPresentation(null).label).toBe("Tier unavailable");
  });

  it("matches explicit and unavailable filters consistently across standalone modes", () => {
    expect(matchesExecutionModeFilter("governed_specialist", "all")).toBe(true);
    expect(matchesExecutionModeFilter("governed_specialist", "governed_specialist")).toBe(true);
    expect(matchesExecutionModeFilter("deterministic_scaffold", "all")).toBe(true);
    expect(matchesExecutionModeFilter("deterministic_scaffold", "deterministic_scaffold")).toBe(true);
    expect(matchesExecutionModeFilter("custom_prompt_scaffold", "deterministic_scaffold")).toBe(false);
    expect(matchesExecutionModeFilter(null, "unavailable")).toBe(true);
    expect(matchesExecutionModeFilter(undefined, "unavailable")).toBe(true);
    expect(matchesExecutionModeFilter("manual_review_required", "unavailable")).toBe(false);
    expect(getExecutionModeFilterOption("governed_specialist").label).toBe("Governed specialist");
    expect(getExecutionModeFilterOption("unavailable").label).toBe("Mode unavailable");
  });

  it("filters goal bundles using persisted task and artifact execution metadata", () => {
    const deterministicBundle = GoalBundleSchema.parse({
      goal: {
        id: "goal-1",
        userId: "user-1",
        workspaceId: null,
        workflowId: "workflow-1",
        title: "Deterministic bundle",
        request: "Prepare a deterministic artifact.",
        intent: "follow_up",
        status: "running",
        confidence: 0.78,
        explanation: "A bounded workflow produced this artifact.",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z"
      },
      workflow: {
        id: "workflow-1",
        goalId: "goal-1",
        workspaceId: null,
        status: "running",
        currentStep: "draft",
        checkpoint: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z"
      },
      tasks: [
        {
          id: "task-1",
          goalId: "goal-1",
          workflowId: "workflow-1",
          title: "Draft next step",
          summary: "Draft the next step artifact.",
          assignedAgent: "workflow",
          state: "running",
          riskClass: "R2",
          requiresApproval: false,
          dependsOn: [],
          toolCapabilities: ["create"],
          artifactIds: ["artifact-1"],
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
          title: "Deterministic result",
          content: "Draft content",
          metadata: {
            executionMode: "governed_specialist"
          },
          createdAt: "2024-01-01T00:01:00.000Z"
        }
      ],
      approvals: [],
      watchers: [],
      actionLogs: []
    });

    const legacyBundle = GoalBundleSchema.parse({
      goal: {
        id: "goal-2",
        userId: "user-1",
        workspaceId: null,
        workflowId: "workflow-2",
        title: "Legacy bundle",
        request: "Open an older artifact.",
        intent: "follow_up",
        status: "waiting",
        confidence: 0.42,
        explanation: "This record predates persisted execution-mode metadata.",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z"
      },
      workflow: {
        id: "workflow-2",
        goalId: "goal-2",
        workspaceId: null,
        status: "running",
        currentStep: "review",
        checkpoint: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z"
      },
      tasks: [
        {
          id: "task-2",
          goalId: "goal-2",
          workflowId: "workflow-2",
          title: "Inspect legacy artifact",
          summary: "Review the older artifact.",
          assignedAgent: "workflow",
          state: "waiting",
          riskClass: "R2",
          requiresApproval: false,
          dependsOn: [],
          toolCapabilities: ["read"],
          artifactIds: ["artifact-2"],
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z"
        }
      ],
      artifacts: [
        {
          id: "artifact-2",
          goalId: "goal-2",
          taskId: "task-2",
          artifactType: "summary",
          title: "Legacy result",
          content: "No execution metadata is available here.",
          metadata: {},
          createdAt: "2024-01-01T00:01:00.000Z"
        }
      ],
      approvals: [],
      watchers: [],
      actionLogs: []
    });

    expect(bundleMatchesExecutionModeFilter(deterministicBundle, "governed_specialist")).toBe(true);
    expect(bundleMatchesExecutionModeFilter(deterministicBundle, "unavailable")).toBe(false);
    expect(bundleMatchesExecutionModeFilter(legacyBundle, "unavailable")).toBe(true);
    expect(bundleMatchesExecutionModeFilter(legacyBundle, "governed_specialist")).toBe(false);
  });

  it("filters approvals using the related bundle execution mode and fails closed when metadata is missing", () => {
    const bundle = GoalBundleSchema.parse({
      goal: {
        id: "goal-1",
        userId: "user-1",
        workspaceId: null,
        workflowId: "workflow-1",
        title: "Approval bundle",
        request: "Send the reviewed response.",
        intent: "email_follow_up",
        status: "waiting",
        confidence: 0.91,
        explanation: "External sends remain scaffolded and require approval.",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z"
      },
      workflow: {
        id: "workflow-1",
        goalId: "goal-1",
        workspaceId: null,
        status: "running",
        currentStep: "approval",
        checkpoint: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z"
      },
      tasks: [
        {
          id: "task-1",
          goalId: "goal-1",
          workflowId: "workflow-1",
          title: "Review customer draft",
          summary: "Prepare the external response for approval.",
          assignedAgent: "communications",
          state: "waiting",
          riskClass: "R3",
          requiresApproval: true,
          dependsOn: [],
          toolCapabilities: ["draft", "send"],
          artifactIds: ["artifact-1"],
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
          title: "Customer draft",
          content: "Response draft",
          metadata: {
            executionMode: "custom_prompt_scaffold"
          },
          createdAt: "2024-01-01T00:01:00.000Z"
        }
      ],
      approvals: [],
      watchers: [],
      actionLogs: []
    });

    const matchingApproval = ApprovalRequestSchema.parse({
      id: "approval-1",
      goalId: "goal-1",
      taskId: "task-1",
      title: "Approve send",
      rationale: "External send requires approval.",
      riskClass: "R3",
      decision: "pending",
      requestedAction: "Send the prepared customer reply.",
      preview: {
        actionType: "send",
        summary: "Send the prepared customer reply.",
        target: "customer@example.com",
        changes: [],
        impact: {
          affectedPeople: ["customer@example.com"],
          affectedSystems: ["email"],
          permissions: ["send"],
          rollback: "manual"
        }
      },
      explanation: null,
      history: [],
      createdAt: "2024-01-01T00:00:00.000Z",
      expiryAt: "2024-01-02T00:00:00.000Z",
      respondedAt: null
    });

    const legacyApproval = ApprovalRequestSchema.parse({
      ...matchingApproval,
      id: "approval-2",
      goalId: "goal-legacy",
      taskId: "task-legacy",
      title: "Review legacy action"
    });

    expect(approvalMatchesExecutionModeFilter(matchingApproval, bundle, "custom_prompt_scaffold")).toBe(true);
    expect(approvalMatchesExecutionModeFilter(matchingApproval, bundle, "manual_review_required")).toBe(false);
    expect(approvalMatchesExecutionModeFilter(legacyApproval, null, "unavailable")).toBe(true);
    expect(approvalMatchesExecutionModeFilter(legacyApproval, null, "custom_prompt_scaffold")).toBe(false);
  });
});
