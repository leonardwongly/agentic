import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActionGroup, DataTable, MetricCard, Panel, RiskPill, SectionHeader, StatusPill } from "../apps/web/components/ui";

describe("dashboard UI primitives", () => {
  it("renders non-color-only status and risk labels", () => {
    const markup = renderToStaticMarkup(
      <Panel title="Cockpit">
        <SectionHeader title="Section" subtitle="Accessible section header" />
        <MetricCard label="Approvals" value={3} detail="pending" status="attention" />
        <StatusPill label="review due" tone="attention" />
        <RiskPill label="R3 high risk" tone="critical" />
        <ActionGroup label="Cockpit actions">
          <button type="button">Open details</button>
        </ActionGroup>
      </Panel>
    );

    expect(markup).toContain("Cockpit");
    expect(markup).toContain("review due");
    expect(markup).toContain("R3 high risk");
    expect(markup).toContain('role="toolbar"');
    expect(markup).toContain('aria-label="Cockpit actions"');
  });

  it("renders an accessible table caption and empty state", () => {
    const markup = renderToStaticMarkup(
      <DataTable
        caption="Trace rows"
        columns={[
          {
            key: "name",
            header: "Name",
            render: (row: { name: string }) => row.name
          }
        ]}
        rows={[]}
        getRowKey={(row) => row.name}
        emptyLabel="No trace rows."
      />
    );

    expect(markup).toContain("<caption>Trace rows</caption>");
    expect(markup).toContain("No trace rows.");
  });
});
