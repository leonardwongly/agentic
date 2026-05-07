import { renderToStaticMarkup } from "react-dom/server";
import { UnifiedFeed, useUnifiedFeed } from "../apps/web/components/ui/unified-feed";

type FeedHarnessProps = {
  actionLogs: Parameters<typeof useUnifiedFeed>[0]["actionLogs"];
};

function FeedHarness({ actionLogs }: FeedHarnessProps) {
  const items = useUnifiedFeed({
    goals: [],
    approvals: [],
    artifacts: [],
    actionLogs,
    onApprove: () => undefined,
    onReject: () => undefined,
    onViewGoal: () => undefined,
    onViewArtifact: () => undefined
  });

  return <UnifiedFeed items={items} />;
}

describe("UnifiedFeed", () => {
  it("renders a stable server-side timestamp before client hydration", () => {
    const timestamp = "2026-04-23T04:00:00.000Z";
    const markup = renderToStaticMarkup(
      <UnifiedFeed
        items={[
          {
            id: "approval-1",
            type: "approval",
            priority: 8,
            title: "Approve outbound reply",
            subtitle: "External send needs confirmation.",
            timestamp,
            riskClass: "R3",
            data: { id: "approval-1" }
          }
        ]}
      />
    );

    expect(markup).toContain(`dateTime="${timestamp}"`);
    expect(markup).toContain(`>${timestamp}</time>`);
  });

  it("derives high-activity insight timing from the action log snapshot", () => {
    const latestApprovalAt = "2026-05-07T11:18:16.562Z";
    const actionLogs = [
      "2026-05-07T11:14:00.000Z",
      "2026-05-07T11:15:00.000Z",
      "2026-05-07T11:16:00.000Z",
      "2026-05-07T11:17:00.000Z",
      latestApprovalAt
    ].map((createdAt, index) => ({
      id: `log-${index}`,
      workspaceId: null,
      goalId: `goal-${index}`,
      kind: "approval.responded",
      message: "Approval processed.",
      createdAt
    }));

    const firstMarkup = renderToStaticMarkup(<FeedHarness actionLogs={actionLogs} />);
    const secondMarkup = renderToStaticMarkup(<FeedHarness actionLogs={actionLogs} />);

    expect(firstMarkup).toBe(secondMarkup);
    expect(firstMarkup).toContain("High approval activity");
    expect(firstMarkup).toContain(`dateTime="${latestApprovalAt}"`);
    expect(firstMarkup).toContain(`>${latestApprovalAt}</time>`);
  });
});
