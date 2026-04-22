import { renderToStaticMarkup } from "react-dom/server";
import { GoalBundleSchema } from "@agentic/contracts";
import { GoalDetailPanel } from "../apps/web/components/panels/goal-detail-panel";

describe("GoalDetailPanel", () => {
  it("renders execution mode and confidence context for tasks and artifacts", () => {
    const bundle = GoalBundleSchema.parse({
      goal: {
        id: "goal-1",
        userId: "user-1",
        workspaceId: null,
        workflowId: "workflow-1",
        title: "Coordinate follow-up",
        request: "Prepare next steps for the customer thread.",
        intent: "follow_up",
        status: "running",
        confidence: 0.84,
        explanation: "A deterministic workflow scaffold prepared the next-step artifact.",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z"
      },
      workflow: {
        id: "workflow-1",
        goalId: "goal-1",
        workspaceId: null,
        status: "running",
        currentStep: "review",
        checkpoint: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z"
      },
      tasks: [
        {
          id: "task-1",
          goalId: "goal-1",
          workflowId: "workflow-1",
          title: "Draft internal follow-up note",
          summary: "Prepare an internal summary and next-step note.",
          assignedAgent: "workflow",
          state: "running",
          riskClass: "R2",
          requiresApproval: false,
          dependsOn: [],
          toolCapabilities: ["create", "monitor"],
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
          title: "Follow-up note",
          content: "Summarize the latest thread and capture the next checkpoint.",
          metadata: {
            executionMode: "deterministic_scaffold"
          },
          createdAt: "2024-01-01T00:01:00.000Z"
        }
      ],
      approvals: [],
      watchers: [],
      actionLogs: []
    });

    const markup = renderToStaticMarkup(
      <GoalDetailPanel bundle={bundle} onClose={() => {}} />
    );

    expect(markup).toContain("Implementation tier");
    expect(markup).toContain("Experimental");
    expect(markup).toContain("Execution mode");
    expect(markup).toContain("Deterministic scaffold");
    expect(markup).toContain("Goal confidence");
    expect(markup).toContain("84%");
  });

  it("renders context review details from the latest context resolution log", () => {
    const bundle = GoalBundleSchema.parse({
      goal: {
        id: "goal-2",
        userId: "user-1",
        workspaceId: null,
        workflowId: "workflow-2",
        title: "Travel planning",
        request: "Plan travel with the correct preferences.",
        intent: "travel_readiness",
        status: "running",
        confidence: 0.8,
        explanation: "The orchestrator kept conflicting travel evidence visible for review.",
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
      tasks: [],
      artifacts: [],
      approvals: [],
      watchers: [],
      actionLogs: [
        {
          id: "log-1",
          goalId: "goal-2",
          taskId: null,
          workflowId: "workflow-2",
          actor: "orchestrator",
          kind: "context.resolved",
          message: "Resolved context before planning.",
          details: {
            contextPack: {
              selectedMemoryIds: ["memory-1", "memory-2"],
              staleMemoryIds: [],
              conflictingMemoryIds: ["memory-1", "memory-2"],
              reviewRequiredMemoryIds: ["memory-1", "memory-2"],
              conflicts: [
                {
                  category: "travel",
                  subject: "seat preference",
                  reason: 'Conflicting travel context for "seat preference" needs review.'
                }
              ],
              evidenceSummary: {
                selectedCount: 2,
                reviewRequiredCount: 2,
                conflictCount: 1
              }
            }
          },
          createdAt: "2024-01-01T00:01:00.000Z",
          prevHash: null
        }
      ]
    });

    const markup = renderToStaticMarkup(
      <GoalDetailPanel bundle={bundle} onClose={() => {}} />
    );

    expect(markup).toContain("Context Review");
    expect(markup).toContain("Selected memories:");
    expect(markup).toContain("Needs review:");
    expect(markup).toContain("Conflicts:");
    expect(markup).toContain("seat preference");
  });

  it("renders persisted policy traces from policy evaluation logs", () => {
    const bundle = GoalBundleSchema.parse({
      goal: {
        id: "goal-3",
        userId: "user-1",
        workspaceId: null,
        workflowId: "workflow-3",
        title: "Inbox follow-up",
        request: "Prepare a customer follow-up safely.",
        intent: "communications-triage",
        status: "waiting",
        confidence: 0.91,
        explanation: "The operator should be able to inspect why approval is still required.",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z"
      },
      workflow: {
        id: "workflow-3",
        goalId: "goal-3",
        workspaceId: null,
        status: "waiting",
        currentStep: "approval",
        checkpoint: "approval-gate",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z"
      },
      tasks: [
        {
          id: "task-3",
          goalId: "goal-3",
          workflowId: "workflow-3",
          title: "Prepare sender-aware drafts",
          summary: "Draft a response and hold the send path behind approval.",
          assignedAgent: "communications",
          state: "waiting",
          riskClass: "R3",
          requiresApproval: true,
          dependsOn: [],
          toolCapabilities: ["read", "draft", "send"],
          artifactIds: [],
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z"
        }
      ],
      artifacts: [],
      approvals: [],
      watchers: [],
      actionLogs: [
        {
          id: "log-2",
          goalId: "goal-3",
          taskId: "task-3",
          workflowId: "workflow-3",
          actor: "policy",
          kind: "policy.evaluated",
          message: 'Evaluated policy for "Prepare sender-aware drafts".',
          details: {
            riskClass: "R3",
            outcome: "allowed_with_confirmation",
            rationale: "Replay validation has not cleared the learned send path yet.",
            confidence: 0.91,
            requiresApproval: true,
            policyTrace: {
              decision: {
                riskClass: "R3",
                outcome: "allowed_with_confirmation",
                rationale: "Replay validation has not cleared the learned send path yet.",
                confidence: 0.91,
                requiresApproval: true
              },
              checks: [
                {
                  id: "replay-validation-gate",
                  stage: "trust",
                  status: "warn",
                  summary: "Outcome-trace learning is not yet replay-validated for autonomy.",
                  detail: "Recent replay evidence regressed."
                }
              ],
              trust: {
                approvedCount: 5,
                rejectedCount: 0,
                trustScore: 1
              },
              scorecardTrust: {
                strong: true,
                weak: false,
                rationale: "Agent scorecard is strong."
              },
              autonomyBudget: {
                approvalMode: "risk_based",
                governanceCeilingRiskClass: "R3",
                requiresExplicitApprovalCapabilities: ["send", "schedule"],
                r3AutonomyEligible: true,
                shadowReplay: {
                  eligibleForR3: true,
                  enabled: true,
                  required: true,
                  promotionMode: "validated_autonomy",
                  rollbackOutcome: "allowed_with_confirmation",
                  thresholdSummary: ["3+ matched episodes", "80%+ precision"],
                  summary: "R3 autonomy depends on replay validation meeting 3+ matched episodes, 80%+ precision."
                },
                decisionInputs: [
                  {
                    id: "confidence_threshold",
                    category: "input",
                    active: true,
                    summary: "Minimum confidence gates autonomous execution.",
                    detail: "Tasks below 0.55 confidence are downgraded to draft behavior."
                  },
                  {
                    id: "replay_validation",
                    category: "learning",
                    active: true,
                    summary: "Replay validation protects learned R3 autonomy signals.",
                    detail: "Matched episodes, precision, negative outcomes, and failure cost must stay inside replay thresholds."
                  }
                ],
                summary:
                  "Risk-based governance can consider R3 autonomy up to R3, but elevated paths still depend on trust, scorecard, and replay-validation inputs."
              },
              conformance: {
                status: "conformant",
                summary: "Workspace governance matches the Phase 3 selected-wedge safeguards.",
                checks: []
              },
              learningValidation: {
                replayValidated: false,
                matchedPatterns: 1,
                matchedEpisodes: 4,
                suggestedPatterns: 1,
                safeSuggestionPrecision: 0.74,
                negativeOutcomeRate: 0.26,
                failureCostRate: 0.4,
                driftStatus: "regressing",
                rationale: "Recent replay evidence regressed."
              }
            }
          },
          createdAt: "2024-01-01T00:01:00.000Z",
          prevHash: null
        }
      ]
    });

    const markup = renderToStaticMarkup(
      <GoalDetailPanel bundle={bundle} onClose={() => {}} />
    );

    expect(markup).toContain("Policy Trace");
    expect(markup).toContain("Prepare sender-aware drafts");
    expect(markup).toContain("approval required");
    expect(markup).toContain("Budget mode: <strong>risk based</strong>");
    expect(markup).toContain("Explicit review: <strong>send, schedule</strong>");
    expect(markup).toContain("Shadow replay: <strong>required</strong>");
    expect(markup).toContain("Replay validation protects learned R3 autonomy signals.");
    expect(markup).toContain("Replay: <strong>needs approval</strong>");
    expect(markup).toContain("Outcome-trace learning is not yet replay-validated for autonomy.");
    expect(markup).toContain("Precision: <strong>74%</strong>");
    expect(markup).toContain("Drift: <strong>regressing</strong>");
  });
});
