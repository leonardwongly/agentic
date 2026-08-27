import { renderToStaticMarkup } from "react-dom/server";
import { ApprovalRequestSchema, GoalBundleSchema } from "@agentic/contracts";
import { GoalDetailPanel } from "../apps/web/components/panels/goal-detail-panel";
import { ApprovalDetailPanel } from "../apps/web/components/panels/approval-detail-panel";
import { RelativeTime, formatConfidencePercentage } from "../apps/web/components/ui";
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
  it("DEFECT (UX): GoalDetailPanel renders the entire 'Goal Contract' block twice in one view", () => {
    // GoalSchema.transform always derives `wedge` + `completionContract`, so both
    // identical `{goal.wedge && goal.completionContract ? ...}` guards in
    // goal-detail-panel.tsx (the detail-list variant and the <ul> bullet variant)
    // fire together. Existing tests use toContain(...) and never counted, so the
    // duplicate slipped through.
    const markup = renderToStaticMarkup(<GoalDetailPanel bundle={buildBundle()} onClose={() => {}} />);

    const contractHeadings = markup.match(/>Goal Contract</g) ?? [];
    const doneWhenLabels = markup.match(/>Done when</g) ?? [];

    // TRUE current behavior: the same section (heading + every field) is duplicated.
    expect(contractHeadings.length).toBe(2);
    expect(doneWhenLabels.length).toBe(2);

    // Suggested fix: delete the second, redundant block (goal-detail-panel.tsx
    // ~lines 669-720) so a single "Goal Contract" section with one "Done when"
    // field is shown; two identically-titled sections make an operator unsure which
    // reflects the real contract.
  });

  it("DEFECT (UX): an artifact's TYPE is shown through a STATUS-colored badge, so 'draft' reads as an alert state", () => {
    // goal-detail-panel.tsx passes `artifact.artifactType` to <StatusBadge status=.../ />,
    // which maps the word "draft" to the same amber/warning tone used for draft /
    // waiting / pending *statuses*. The artifact therefore gets no real status at all
    // and its mere kind is painted as if it needs attention.
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

    // TRUE current behavior: two different artifact KINDS receive two different
    // status tones purely from their type word ("draft" -> warning, "summary" -> default).
    expect(draftSection).toContain('class="badge badge-warning badge-md">draft<');
    expect(summarySection).toContain('class="badge badge-default badge-md">summary<');

    // Suggested fix: render the artifact type as a neutral, explicitly-labelled
    // "Type: draft" pill (or a plain Badge variant="default") and reserve
    // StatusBadge for a genuine lifecycle status field, so amber never silently
    // implies "action needed" for a completed artifact.
  });

  it("DEFECT (UX): integer-rounded confidence can display absolute certainty next to an approval decision", () => {
    // formatConfidencePercentage is rendered beside "Approve/Reject" and in the
    // Goal/Task meta. Math.round() lets a 99.5% model claim "100%" and a 0.4% model
    // claim "0%", overstating (or understating) certainty at the exact moment an
    // operator is deciding whether to allow an external action.
    expect(formatConfidencePercentage(0.995)).toBe("100%"); // true value is not certain
    expect(formatConfidencePercentage(0.9949)).toBe("99%");
    expect(formatConfidencePercentage(0.004)).toBe("0%"); // true value is not zero

    // Suggested fix: clamp the displayed range (e.g. cap at "99%", floor at "1%")
    // or render one decimal near the boundaries, so the UI never states absolute
    // certainty for a probabilistic signal.
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
});
