import { renderToStaticMarkup } from "react-dom/server";
import { ApprovalRequestSchema, GoalBundleSchema } from "@agentic/contracts";
import { GoalDetailPanel } from "../apps/web/components/panels/goal-detail-panel";
import { ApprovalDetailPanel } from "../apps/web/components/panels/approval-detail-panel";
import { RelativeTime, formatConfidencePercentage } from "../apps/web/components/ui";
import {
  extractArtifactExecutionMode,
  getExecutionModePresentation,
  getImplementationTierPresentation
} from "../apps/web/components/ui/execution-mode";
import { describe, expect, it } from "vitest";

function buildBundle(overrides: Partial<Parameters<typeof GoalBundleSchema.parse>[0]> = {}) {
  return GoalBundleSchema.parse({
    goal: {
      id: "goal-copy",
      userId: "user-1",
      workspaceId: null,
      workflowId: "workflow-copy",
      title: "Coordinate follow-up",
      request: "Prepare next steps.",
      intent: "general_coordination",
      status: "running",
      confidence: 0.9,
      explanation: "A governed path prepared the result.",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z"
    },
    workflow: {
      id: "workflow-copy",
      goalId: "goal-copy",
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
    actionLogs: [],
    ...overrides
  });
}

function artifactSection(markup: string): string {
  const start = markup.indexOf("Artifacts (");
  return start === -1 ? "" : markup.slice(start, start + 600);
}

describe("adversarial UI: confusing copy & visual states", () => {
  it("Regression: GoalDetailPanel renders a single 'Goal Contract' block, not a duplicate", () => {
    // GoalSchema.transform always derives `wedge` + `completionContract`. The panel used to render
    // two identical `{goal.wedge && goal.completionContract ? ...}` blocks (a detail-list variant
    // and a <ul> bullet variant), so every field appeared twice and a screen reader announced the
    // same section twice. The redundant second block has been removed.
    const markup = renderToStaticMarkup(<GoalDetailPanel bundle={buildBundle()} onClose={() => {}} />);

    const contractHeadings = markup.match(/>Goal Contract</g) ?? [];
    const doneWhenLabels = markup.match(/>Done when</g) ?? [];

    expect(contractHeadings.length).toBe(1);
    expect(doneWhenLabels.length).toBe(1);
  });

  it("Regression: an artifact's TYPE is a neutral labelled pill, not a status-colored badge", () => {
    // goal-detail-panel.tsx used to pass `artifact.artifactType` to <StatusBadge status=.../>,
    // which mapped the word "draft" to the amber/warning tone used for real alert statuses - so a
    // completed draft artifact read as "needs attention". The type is now an explicitly-labelled,
    // neutral pill and StatusBadge is reserved for genuine lifecycle statuses.
    const draftBundle = buildBundle({
      artifacts: [
        {
          id: "artifact-draft",
          goalId: "goal-copy",
          taskId: "task-1",
          artifactType: "draft",
          title: "Reply draft",
          content: "Body",
          metadata: {},
          createdAt: "2024-01-01T00:00:00.000Z"
        }
      ]
    });
    const summaryBundle = buildBundle({
      artifacts: [
        {
          id: "artifact-summary",
          goalId: "goal-copy",
          taskId: "task-1",
          artifactType: "summary",
          title: "Weekly summary",
          content: "Body",
          metadata: {},
          createdAt: "2024-01-01T00:00:00.000Z"
        }
      ]
    });

    const draftSection = artifactSection(renderToStaticMarkup(<GoalDetailPanel bundle={draftBundle} onClose={() => {}} />));
    const summarySection = artifactSection(renderToStaticMarkup(<GoalDetailPanel bundle={summaryBundle} onClose={() => {}} />));

    // Both artifact kinds render through the SAME neutral pill, explicitly labelled as a type.
    expect(draftSection).toContain('class="pill">Type: draft<');
    expect(summarySection).toContain('class="pill">Type: summary<');
    // A mere kind is no longer painted with the warning tone.
    expect(draftSection).not.toContain("badge-warning");
    expect(draftSection).not.toContain('">draft<');
  });

  it("Regression: near-boundary confidence never states absolute certainty, while exact 0/1 stay truthful", () => {
    // formatConfidencePercentage is rendered beside "Approve/Reject" and in the Goal/Task meta.
    // Math.round() alone let a 99.5% model claim "100%" and a 0.4% model claim "0%". The fix caps
    // a near-boundary value away from certainty, but keeps EXACT 0 and 1 exact so genuine rates
    // (e.g. a 0 negative-outcome rate) still read truthfully.
    expect(formatConfidencePercentage(0.995)).toBe("99%"); // no longer claims certainty
    expect(formatConfidencePercentage(0.9949)).toBe("99%");
    expect(formatConfidencePercentage(0.004)).toBe("1%"); // no longer claims impossibility
    expect(formatConfidencePercentage(1)).toBe("100%"); // exact stays exact
    expect(formatConfidencePercentage(0)).toBe("0%"); // exact stays exact
    expect(formatConfidencePercentage(0.9)).toBe("90%"); // mid-range untouched
  });

  it("distinguishes the safe/commit action from the decline action and hides both once decided", () => {
    const base = {
      id: "approval-copy",
      goalId: "goal-copy",
      taskId: "task-1",
      title: "Send customer reply",
      rationale: "External send requires review.",
      riskClass: "R3",
      requestedAction: "Send the reply.",
      preview: {
        actionType: "send",
        summary: "Send the reply.",
        target: "customer@example.com",
        changes: [],
        impact: { affectedPeople: [], affectedSystems: [], permissions: [], rollback: "manual" }
      },
      explanation: null,
      history: [],
      createdAt: "2024-01-01T00:00:00.000Z",
      expiryAt: "2024-01-02T00:00:00.000Z",
      respondedAt: null
    };

    const pendingMarkup = renderToStaticMarkup(
      <ApprovalDetailPanel approval={ApprovalRequestSchema.parse({ ...base, decision: "pending" })} onApprove={() => {}} onReject={() => {}} />
    );
    // Commit vs decline must be visually distinct (primary vs secondary), not two
    // identical buttons an operator could click by reflex.
    expect(/primary-button[^>]*>\s*Approve\s*</.test(pendingMarkup)).toBe(true);
    expect(/secondary-button[^>]*>\s*Reject\s*</.test(pendingMarkup)).toBe(true);
    // With no in-flight submission they must actually be enabled.
    expect(pendingMarkup).not.toContain("disabled=\"\"");

    const rejectedMarkup = renderToStaticMarkup(
      <ApprovalDetailPanel approval={ApprovalRequestSchema.parse({ ...base, id: "approval-copy-2", decision: "rejected" })} onApprove={() => {}} onReject={() => {}} />
    );
    // A already-decided approval must not keep offering Approve/Reject, and must
    // surface the outcome in a non-color-only, error-toned status label.
    expect(rejectedMarkup).not.toContain(">Approve<");
    expect(rejectedMarkup).not.toContain(">Reject<");
    expect(rejectedMarkup).toContain('class="badge badge-error badge-md">rejected<');
  });

  it("guards a broken clock instead of leaking 'Invalid Date'/'NaN' into a timestamp", () => {
    // RelativeTime is rendered for created/responded/evidence rows. Unparseable
    // input must degrade to human copy, never "Invalid Date" or "NaN".
    const markup = renderToStaticMarkup(<RelativeTime date="not-a-real-date" />);
    expect(markup).toContain("Invalid timestamp");
    expect(markup).not.toContain("Invalid Date");
    expect(markup).not.toContain("NaN");
  });

  it("Regression: formatPercent in policy traces guards NaN, Infinity, and out-of-range values", () => {
    // goal-detail-panel.tsx has a local formatPercent used for trust scores, precision,
    // negative-outcome rates, and failure-cost rates. Unlike formatConfidencePercentage (which
    // already guarded boundaries), formatPercent used to leak "NaN%" and "Infinity%" into the
    // panel when upstream data was corrupt. The fix clamps to [0,1] and returns "n/a" for
    // non-finite values so operators never see math artifacts beside policy decisions.
    const nanBundle = buildBundle({
      actionLogs: [
        {
          id: "log-nan",
          goalId: "goal-copy",
          taskId: null,
          workflowId: "workflow-copy",
          actor: "policy",
          kind: "policy.evaluated",
          message: "Policy evaluated.",
          details: {
            riskClass: "R2",
            outcome: "allowed",
            rationale: "Test.",
            confidence: 0.5,
            requiresApproval: false,
            policyTrace: {
              decision: {
                riskClass: "R2",
                outcome: "allowed",
                rationale: "Test.",
                confidence: 0.5,
                requiresApproval: false
              },
              checks: [],
              trust: { approvedCount: 0, rejectedCount: 0, trustScore: NaN },
              scorecardTrust: { strong: false, weak: false, rationale: null },
              autonomyBudget: null,
              conformance: null,
              learningValidation: {
                replayValidated: false,
                safeSuggestionPrecision: Infinity,
                negativeOutcomeRate: -Infinity,
                failureCostRate: NaN,
                driftStatus: "insufficient_data",
                rationale: "Not enough data."
              }
            }
          },
          createdAt: "2024-01-01T00:01:00.000Z",
          prevHash: null
        }
      ]
    });

    const markup = renderToStaticMarkup(<GoalDetailPanel bundle={nanBundle} onClose={() => {}} />);

    // No math artifacts should leak into the rendered panel.
    expect(markup).not.toContain("NaN%");
    expect(markup).not.toContain("Infinity%");
    expect(markup).not.toContain("-Infinity%");
    // The guard should produce either "n/a" or a clamped percentage.
    expect(markup).toContain("n/a");
  });

  it("Regression: prototype-chain keys in artifact metadata are not read as an execution mode", () => {
    // isAgentExecutionMode used `value in executionModePresentations`, which is true for inherited
    // keys like "constructor"/"toString"/"__proto__". That let attacker-writable artifact metadata
    // flow into deriveAgentImplementationTier -> implementationTierPresentations[undefined] and
    // crash the goal-panel render. Object.hasOwn rejects inherited keys and the getters fall back.
    for (const hostile of ["constructor", "toString", "__proto__", "valueOf", "hasOwnProperty"]) {
      const mode = extractArtifactExecutionMode({ metadata: { executionMode: hostile } });
      expect(mode).toBeNull();
    }

    // Even if a prototype key is forced past the type guard, the getters degrade to the
    // "unavailable" presentation instead of throwing.
    expect(() => getExecutionModePresentation("constructor" as never)).not.toThrow();
    expect(() => getImplementationTierPresentation("constructor" as never)).not.toThrow();
    expect(getImplementationTierPresentation("constructor" as never).label).toBe("Tier unavailable");
    expect(getExecutionModePresentation("constructor" as never).label).toBe("Mode unavailable");
  });
});
