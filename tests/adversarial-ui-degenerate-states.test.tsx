import { renderToStaticMarkup } from "react-dom/server";
import { GoalBundleSchema } from "@agentic/contracts";
import { GoalDetailPanel } from "../apps/web/components/panels/goal-detail-panel";
import { DataTable, EmptyState, MetricCard, NoResultsEmpty, type DataTableColumn } from "../apps/web/components/ui";
import { describe, expect, it } from "vitest";

// Hostile-input probe: strings a malicious or careless operator/user could type
// into a search box, a generated title, or an agent-produced artifact body.
const MARKUP_PROBE = '"><img src=x onerror=alert(1)>';
const SCRIPT_PROBE = "<script>alert(document.domain)</script>";

// Helper: build a minimal-but-valid bundle whose untrusted free-text fields all
// carry markup, so we can prove the panels never emit live HTML for domain data.
function buildPoisonedBundle() {
  return GoalBundleSchema.parse({
    goal: {
      id: "goal-poison",
      userId: "user-1",
      workspaceId: null,
      workflowId: "workflow-poison",
      title: MARKUP_PROBE,
      request: SCRIPT_PROBE,
      intent: "general_coordination",
      status: "running",
      confidence: 0.5,
      explanation: MARKUP_PROBE,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z"
    },
    workflow: {
      id: "workflow-poison",
      goalId: "goal-poison",
      workspaceId: null,
      status: "running",
      currentStep: "review",
      checkpoint: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z"
    },
    tasks: [],
    artifacts: [
      {
        id: "artifact-poison",
        goalId: "goal-poison",
        taskId: "task-poison",
        artifactType: "summary",
        title: MARKUP_PROBE,
        content: SCRIPT_PROBE,
        metadata: {},
        createdAt: "2024-01-01T00:00:00.000Z"
      }
    ],
    approvals: [],
    watchers: [],
    actionLogs: []
  });
}

describe("adversarial UI: degenerate & hostile data", () => {
  it("renders untrusted free text as escaped text, never as live HTML (search box)", () => {
    // NoResultsEmpty interpolates the raw query into the title template
    // `No results for "${query}"`, the classic place a naive implementation would
    // break out of an attribute or inject a tag.
    const markup = renderToStaticMarkup(<NoResultsEmpty query={MARKUP_PROBE} onClear={() => {}} />);

    // The quote is escaped so it cannot close the surrounding text/attribute, and
    // the tag is neutralised so no <img> element or onerror handler survives.
    expect(markup).toContain("&quot;");
    expect(markup).toContain("&lt;img");
    // The leading `<` is escaped, so no real <img> element can be created.
    expect(markup).not.toContain("<img");
  });

  it("escapes hostile strings handed to dashboard primitives (metric, empty state, table cell)", () => {
    const metric = renderToStaticMarkup(<MetricCard label={SCRIPT_PROBE} value={SCRIPT_PROBE} detail={MARKUP_PROBE} status="critical" />);
    expect(metric).toContain("&lt;script&gt;");
    expect(metric).not.toContain("<script>");

    const empty = renderToStaticMarkup(
      <EmptyState title={SCRIPT_PROBE} description={MARKUP_PROBE} suggestions={[SCRIPT_PROBE]} action={{ label: MARKUP_PROBE, onClick: () => {} }} />
    );
    expect(empty).toContain("&lt;script&gt;");
    expect(empty).not.toContain("<script>");
    expect(empty).not.toContain("<img ");
  });

  it("renders a poisoned domain bundle in GoalDetailPanel without emitting executable markup", () => {
    const markup = renderToStaticMarkup(<GoalDetailPanel bundle={buildPoisonedBundle()} onClose={() => {}} />);

    // The probe payloads must be present only in escaped form.
    expect(markup).toContain("&lt;img");
    expect(markup).toContain("&lt;script&gt;");
    // No live injected element may appear anywhere in the panel (leading `<` is escaped).
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("<img");
  });

  it("keeps a literal zero metric value visible instead of collapsing a falsy render", () => {
    // value is typed `string | number`; a `{value && ...}` refactor would drop 0.
    const markup = renderToStaticMarkup(<MetricCard label="Errors" value={0} detail="last 24h" status="healthy" />);

    expect(markup).toContain(">0<");
    expect(markup).toContain('aria-label="Errors: 0"');
    // The optional detail must still render alongside a falsy value.
    expect(markup).toContain("last 24h");
  });

  it("renders every row for hundreds of rows and a single-item list without silent truncation", () => {
    type Row = { name: string };
    const columns: DataTableColumn<Row>[] = [{ key: "name", header: "Name", render: (row) => row.name }];

    const many: Row[] = Array.from({ length: 300 }, (_, i) => ({ name: `row-${i}` }));
    const manyMarkup = renderToStaticMarkup(
      <DataTable caption="Many rows" columns={columns} rows={many} getRowKey={(row) => row.name} />
    );
    // Guards against accidental `.slice()`/windowing that would hide data from the operator.
    for (const marker of ["row-0", "row-149", "row-299"]) {
      expect(manyMarkup).toContain(marker);
    }
    // Exactly 300 data <tr> in tbody (the header row uses <th>).
    const bodyMarkup = manyMarkup.slice(manyMarkup.indexOf("<tbody>"));
    expect(bodyMarkup.split("<tr>").length - 1).toBe(300);

    const singleMarkup = renderToStaticMarkup(
      <DataTable caption="One row" columns={columns} rows={[{ name: "only-one" }]} getRowKey={(row) => row.name} />
    );
    expect(singleMarkup).toContain("only-one");
    expect(singleMarkup).not.toContain("No rows available.");
  });

  it("surfaces the empty-state message when a table has zero rows and degrades safely with zero columns", () => {
    const zeroRows = renderToStaticMarkup(
      <DataTable
        caption="Empty"
        columns={[{ key: "name", header: "Name", render: (row: { name: string }) => row.name }]}
        rows={[]}
        getRowKey={(row) => row.name}
        emptyLabel="Nothing to show yet."
      />
    );
    expect(zeroRows).toContain("Nothing to show yet.");

    // Hostile/degenerate config: no columns AND no rows must still render (not throw)
    // and keep the caption + message so a screen-reader user is not met with a blank region.
    const noColumns = renderToStaticMarkup(
      <DataTable caption="No schema" columns={[]} rows={[]} getRowKey={(row: { id: string }) => row.id} emptyLabel="No columns configured." />
    );
    expect(noColumns).toContain("<caption>No schema</caption>");
    expect(noColumns).toContain("No columns configured.");
  });

  it("distinguishes the accessible label when optional metadata fields are absent vs zero", () => {
    // MetricCard detail is optional; its absence must not be replaced by a stray
    // "0"/"" that a screen reader would announce as a real value.
    const withoutDetail = renderToStaticMarkup(<MetricCard label="Queued" value={5} />);
    expect(withoutDetail).toContain('aria-label="Queued: 5"');
    expect(withoutDetail).not.toContain("<small>");
  });
});
