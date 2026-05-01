import { renderToStaticMarkup } from "react-dom/server";
import { UnifiedFeed } from "../apps/web/components/ui/unified-feed";

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
});
