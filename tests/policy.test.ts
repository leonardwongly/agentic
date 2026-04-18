import type { AgentMetrics, WorkspaceGovernance } from "@agentic/contracts";
import {
  assessWorkspaceGovernanceConformance,
  buildGovernanceSimulationScenarios,
  evaluateTaskPolicy,
  riskFromCapabilities,
  simulateGovernanceScenarios,
  simulateTaskPolicy
} from "@agentic/policy";
import { createMemoryRecord } from "@agentic/memory";

describe("policy", () => {
  function buildScorecard(overrides: Partial<AgentMetrics> = {}): AgentMetrics {
    return {
      agentId: "agent-communications",
      period: "all" as const,
      periodStart: "2026-01-01T00:00:00.000Z",
      periodEnd: "2026-12-31T23:59:59.999Z",
      tasksTotal: 5,
      tasksCompleted: 5,
      tasksFailed: 0,
      tasksBlocked: 0,
      approvalsRequested: 5,
      approvalsApproved: 5,
      approvalsRejected: 0,
      averageConfidence: 0.94,
      averageExecutionTimeMs: 2_000,
      artifactsProduced: 4,
      artifactsByType: {
        draft: 4
      },
      errorCount: 0,
      lastErrorAt: null,
      lastErrorMessage: null,
      feedbackCount: 5,
      userCorrectionCount: 0,
      postApprovalFailureCount: 0,
      averageRating: null,
      successRate: 1,
      approvalRate: 1,
      correctionRate: 0,
      postApprovalFailureRate: 0,
      updatedAt: "2026-01-15T10:00:00.000Z",
      ...overrides
    };
  }

  function buildFreshApprovalMemories() {
    return Array.from({ length: 5 }, () =>
      createMemoryRecord({
        userId: "user-1",
        category: "preferences",
        memoryType: "confirmed",
        content: "User approved send actions for customer follow-up and approved similar send tasks before.",
        confidence: 0.95,
        source: "auto-capture"
      })
    );
  }

  function buildGovernance(overrides: Partial<WorkspaceGovernance> = {}): WorkspaceGovernance {
    return {
      workspaceId: "workspace-1",
      approvalMode: "risk_based",
      requireAuditExports: false,
      maxAutoRunRiskClass: "R3",
      externalSendRequiresApproval: false,
      calendarWriteRequiresApproval: false,
      retentionDays: 365,
      updatedBy: "user-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-15T00:00:00.000Z",
      ...overrides
    };
  }

  it("maps low-impact capabilities to R1", () => {
    expect(riskFromCapabilities(["read", "search"])).toBe("R1");
  });

  it("requires approval for external commitments", () => {
    const decision = evaluateTaskPolicy({
      capabilities: ["read", "send"],
      confidence: 0.84,
      title: "Send a customer reply"
    });

    expect(decision.riskClass).toBe("R3");
    expect(decision.requiresApproval).toBe(true);
    expect(decision.outcome).toBe("allowed_with_confirmation");
  });

  it("blocks irreversible actions", () => {
    const decision = evaluateTaskPolicy({
      capabilities: ["delete"],
      confidence: 0.91,
      title: "Delete the note"
    });

    expect(decision.riskClass).toBe("R4");
    expect(decision.requiresApproval).toBe(true);
    expect(decision.outcome).toBe("blocked");
  });

  it("downgrades low-confidence tasks to draft behavior", () => {
    const decision = evaluateTaskPolicy({
      capabilities: ["send"],
      confidence: 0.42,
      title: "Send a vague message"
    });

    expect(decision.outcome).toBe("downgrade_to_draft");
    expect(decision.requiresApproval).toBe(false);
  });

  it("does not promote trust from stale auto-captured memories", () => {
    const decision = evaluateTaskPolicy({
      capabilities: ["send"],
      confidence: 0.9,
      title: "Send the customer follow-up",
      memories: [
        createMemoryRecord({
          userId: "user-1",
          category: "preferences",
          memoryType: "confirmed",
          content: "User approved send actions for customer follow-up and approved similar send tasks before.",
          confidence: 0.95,
          source: "auto-capture",
          reviewAt: "2026-01-01T00:00:00.000Z"
        }),
        createMemoryRecord({
          userId: "user-1",
          category: "preferences",
          memoryType: "confirmed",
          content: "User approved send actions for customer follow-up and approved similar send tasks before.",
          confidence: 0.95,
          source: "auto-capture",
          reviewAt: "2026-01-01T00:00:00.000Z"
        }),
        createMemoryRecord({
          userId: "user-1",
          category: "preferences",
          memoryType: "confirmed",
          content: "User approved send actions for customer follow-up and approved similar send tasks before.",
          confidence: 0.95,
          source: "auto-capture",
          reviewAt: "2026-01-01T00:00:00.000Z"
        })
      ]
    });

    expect(decision.outcome).toBe("allowed_with_confirmation");
    expect(decision.requiresApproval).toBe(true);
  });

  it("allows R3 autonomy only when strong memory trust and a strong scorecard are both present", () => {
    const decision = evaluateTaskPolicy({
      capabilities: ["send"],
      confidence: 0.92,
      title: "Send the customer follow-up",
      memories: buildFreshApprovalMemories(),
      scorecard: buildScorecard()
    });

    expect(decision.outcome).toBe("allowed");
    expect(decision.requiresApproval).toBe(false);
    expect(decision.rationale).toContain("strong execution scorecard");
  });

  it("keeps approval required when memory trust is strong but the scorecard is weak", () => {
    const decision = evaluateTaskPolicy({
      capabilities: ["send"],
      confidence: 0.92,
      title: "Send the customer follow-up",
      memories: buildFreshApprovalMemories(),
      scorecard: buildScorecard({
        tasksTotal: 6,
        tasksCompleted: 2,
        tasksFailed: 4,
        errorCount: 4,
        successRate: 0.33,
        approvalRate: 0.4,
        correctionRate: 0.4
      })
    });

    expect(decision.outcome).toBe("allowed_with_confirmation");
    expect(decision.requiresApproval).toBe(true);
    expect(decision.rationale).toContain("scorecard is weak");
  });

  it("does not auto-promote R3 tasks from scorecard strength alone", () => {
    const decision = evaluateTaskPolicy({
      capabilities: ["send"],
      confidence: 0.9,
      title: "Send the customer follow-up",
      scorecard: buildScorecard()
    });

    expect(decision.outcome).toBe("allowed_with_confirmation");
    expect(decision.requiresApproval).toBe(true);
  });

  it("keeps approval required when recent user corrections are high despite otherwise strong execution", () => {
    const decision = evaluateTaskPolicy({
      capabilities: ["send"],
      confidence: 0.93,
      title: "Send the customer follow-up",
      memories: buildFreshApprovalMemories(),
      scorecard: buildScorecard({
        feedbackCount: 4,
        userCorrectionCount: 2,
        correctionRate: 0.5
      })
    });

    expect(decision.outcome).toBe("allowed_with_confirmation");
    expect(decision.requiresApproval).toBe(true);
    expect(decision.rationale).toContain("user correction");
  });

  it("keeps approval required when approved actions often fail after approval", () => {
    const decision = evaluateTaskPolicy({
      capabilities: ["send"],
      confidence: 0.93,
      title: "Send the customer follow-up",
      memories: buildFreshApprovalMemories(),
      scorecard: buildScorecard({
        approvalsRequested: 5,
        approvalsApproved: 5,
        feedbackCount: 5,
        postApprovalFailureCount: 2,
        postApprovalFailureRate: 0.4
      })
    });

    expect(decision.outcome).toBe("allowed_with_confirmation");
    expect(decision.requiresApproval).toBe(true);
    expect(decision.rationale).toContain("post-approval failure");
  });

  it("forces approval when governance is set to always review", () => {
    const decision = evaluateTaskPolicy({
      capabilities: ["create"],
      confidence: 0.91,
      title: "Create the weekly operating note",
      governance: buildGovernance({
        approvalMode: "always_review"
      })
    });

    expect(decision.outcome).toBe("allowed_with_confirmation");
    expect(decision.requiresApproval).toBe(true);
    expect(decision.rationale).toContain("always-review mode");
  });

  it("forces approval for external sends when governance disallows autonomous send actions", () => {
    const decision = evaluateTaskPolicy({
      capabilities: ["send"],
      confidence: 0.92,
      title: "Send the customer follow-up",
      memories: buildFreshApprovalMemories(),
      scorecard: buildScorecard(),
      governance: buildGovernance({
        externalSendRequiresApproval: true
      })
    });

    expect(decision.outcome).toBe("allowed_with_confirmation");
    expect(decision.requiresApproval).toBe(true);
    expect(decision.rationale).toContain("external sends");
  });

  it("forces approval for calendar writes when governance disallows autonomous scheduling", () => {
    const decision = evaluateTaskPolicy({
      capabilities: ["read", "schedule"],
      confidence: 0.87,
      title: "Schedule the project kickoff",
      governance: buildGovernance({
        calendarWriteRequiresApproval: true
      })
    });

    expect(decision.outcome).toBe("allowed_with_confirmation");
    expect(decision.requiresApproval).toBe(true);
    expect(decision.rationale).toContain("calendar writes");
  });

  it("forces approval when the task risk exceeds the workspace auto-run ceiling", () => {
    const decision = evaluateTaskPolicy({
      capabilities: ["create", "update"],
      confidence: 0.88,
      title: "Create and update the weekly plan",
      governance: buildGovernance({
        maxAutoRunRiskClass: "R1"
      })
    });

    expect(decision.riskClass).toBe("R2");
    expect(decision.outcome).toBe("allowed_with_confirmation");
    expect(decision.requiresApproval).toBe(true);
    expect(decision.rationale).toContain("limits autonomous execution to R1");
  });

  it("classifies governance conformance drift across pass, warn, and fail checks", () => {
    const conformant = assessWorkspaceGovernanceConformance(
      buildGovernance({
        requireAuditExports: true,
        externalSendRequiresApproval: true,
        calendarWriteRequiresApproval: true,
        maxAutoRunRiskClass: "R2"
      })
    );
    const needsAttention = assessWorkspaceGovernanceConformance(
      buildGovernance({
        requireAuditExports: true,
        externalSendRequiresApproval: true,
        calendarWriteRequiresApproval: false,
        maxAutoRunRiskClass: "R3"
      })
    );
    const nonConformant = assessWorkspaceGovernanceConformance(buildGovernance());

    expect(conformant).toMatchObject({
      status: "conformant"
    });
    expect(conformant?.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "audit-exports", status: "pass" }),
        expect.objectContaining({ id: "risk-ceiling", status: "pass" })
      ])
    );
    expect(needsAttention).toMatchObject({
      status: "needs_attention"
    });
    expect(needsAttention?.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "calendar-write-approval", status: "warn" }),
        expect.objectContaining({ id: "risk-ceiling", status: "warn" })
      ])
    );
    expect(nonConformant).toMatchObject({
      status: "non_conformant"
    });
    expect(nonConformant?.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "audit-exports", status: "fail" }),
        expect.objectContaining({ id: "external-send-approval", status: "fail" })
      ])
    );
  });

  it("builds the default governance simulation scenarios for the operator loop", () => {
    const scenarios = buildGovernanceSimulationScenarios();

    expect(scenarios.map((scenario) => scenario.id)).toEqual([
      "low-risk-read",
      "draft-update",
      "external-send",
      "calendar-write",
      "destructive-action"
    ]);
  });

  it("simulates governance scenarios with conformance context and decision traces", () => {
    const scenarios = simulateGovernanceScenarios({
      governance: buildGovernance({
        requireAuditExports: true,
        externalSendRequiresApproval: true,
        calendarWriteRequiresApproval: true,
        maxAutoRunRiskClass: "R2"
      })
    });
    const lowRiskRead = scenarios.find((scenario) => scenario.id === "low-risk-read");
    const externalSend = scenarios.find((scenario) => scenario.id === "external-send");
    const destructiveAction = scenarios.find((scenario) => scenario.id === "destructive-action");

    expect(lowRiskRead?.result.decision).toMatchObject({
      outcome: "allowed",
      requiresApproval: false
    });
    expect(lowRiskRead?.result.conformance?.status).toBe("conformant");
    expect(externalSend?.result.decision).toMatchObject({
      outcome: "allowed_with_confirmation",
      requiresApproval: true
    });
    expect(externalSend?.result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "governance-gate",
          stage: "governance",
          status: "warn"
        })
      ])
    );
    expect(destructiveAction?.result.decision).toMatchObject({
      outcome: "blocked",
      requiresApproval: true
    });
  });

  it("returns full simulation detail when low confidence downgrades the task to draft mode", () => {
    const simulation = simulateTaskPolicy({
      capabilities: ["send"],
      confidence: 0.4,
      title: "Send the ambiguous external update",
      governance: buildGovernance({
        requireAuditExports: true,
        externalSendRequiresApproval: true,
        calendarWriteRequiresApproval: true,
        maxAutoRunRiskClass: "R2"
      })
    });

    expect(simulation.decision).toMatchObject({
      outcome: "downgrade_to_draft",
      requiresApproval: false,
      riskClass: "R3"
    });
    expect(simulation.conformance?.status).toBe("conformant");
    expect(simulation.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "confidence-threshold",
          stage: "input",
          status: "warn"
        })
      ])
    );
  });
});
