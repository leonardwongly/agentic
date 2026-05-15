import { renderToStaticMarkup } from "react-dom/server";
import { AbsoluteTime, RelativeTime } from "../apps/web/components/ui/relative-time";

describe("relative time", () => {
  it("server-renders a stable ISO timestamp before client hydration", () => {
    const markup = renderToStaticMarkup(<RelativeTime date="2026-05-15T01:02:03.000Z" />);

    expect(markup).toContain('dateTime="2026-05-15T01:02:03.000Z"');
    expect(markup).toContain('title="2026-05-15T01:02:03.000Z"');
    expect(markup).toContain(">2026-05-15T01:02:03.000Z</time>");
  });

  it("renders invalid timestamps as safe text instead of throwing during hydration", () => {
    expect(renderToStaticMarkup(<RelativeTime date="not-a-date" />)).toContain("Invalid timestamp");
    expect(renderToStaticMarkup(<AbsoluteTime date="not-a-date" />)).toContain("Invalid timestamp");
  });
});
