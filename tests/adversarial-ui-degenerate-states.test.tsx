import { renderToStaticMarkup } from "react-dom/server";
import { GoalBundleSchema } from "@agentic/contracts";
import { GoalDetailPanel } from "../apps/web/components/panels/goal-detail-panel";
import { DataTable, EmptyState, MetricCard, NoResultsEmpty, type DataTableColumn } from "../apps/web/components/ui";
import { UnifiedFeed } from "../apps/web/components/ui/unified-feed";
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

  it("Regression: DataTable empty-state cell uses colSpan >= 1 even with zero columns", () => {
    // When columns.length === 0, colSpan={columns.length} produced colSpan="0" which is
    // invalid HTML (colSpan must be >= 1). Screen readers and browsers handle this
    // inconsistently. The fix clamps to Math.max(1, columns.length).
    const markup = renderToStaticMarkup(
      <DataTable caption="No schema" columns={[]} rows={[]} getRowKey={(row: { id: string }) => row.id} emptyLabel="No columns configured." />
    );
    expect(markup).toContain('colSpan="1"');
    expect(markup).not.toContain('colSpan="0"');
  });

  it("UnifiedFeed renders an accessible empty state with role=status", () => {
    const markup = renderToStaticMarkup(<UnifiedFeed items={[]} />);
    expect(markup).toContain('role="status"');
    expect(markup).toContain("Nothing needs your attention right now.");
    // The decorative icon must be hidden from assistive tech.
    expect(markup).toContain('aria-hidden="true"');
  });

  it("UnifiedFeed renders an accessible feed region with role=feed", () => {
    const markup = renderToStaticMarkup(
      <UnifiedFeed
        items={[
          {
            id: "item-1",
            type: "approval",
            priority: 8,
            title: "Approve outbound reply",
            subtitle: "External send needs confirmation.",
            timestamp: "2026-04-23T04:00:00.000Z",
            riskClass: "R3",
            data: { id: "approval-1" }
          }
        ]}
      />
    );
    expect(markup).toContain('role="feed"');
    expect(markup).toContain('aria-label="Activity feed"');
  });

  it("UnifiedFeed sorts items with invalid timestamps below valid ones instead of floating them to top", () => {
    // NaN comparison in sort produces unstable ordering. Items with unparseable
    // timestamps should sink below valid entries, not float above them.
    const items = [
      {
        id: "invalid-ts",
        type: "goal" as const,
        priority: 5,
        title: "Invalid timestamp item",
        subtitle: "Should sort below valid items at same priority.",
        timestamp: "not-a-real-date",
        data: {}
      },
      {
        id: "valid-ts",
        type: "goal" as const,
        priority: 5,
        title: "Valid timestamp item",
        subtitle: "Should sort above invalid items at same priority.",
        timestamp: "2026-04-23T04:00:00.000Z",
        data: {}
      }
    ];

    const markup = renderToStaticMarkup(<UnifiedFeed items={items} maxItems={10} />);
    // The valid-timestamp item should appear before the invalid one in DOM order.
    const validPos = markup.indexOf("Valid timestamp item");
    const invalidPos = markup.indexOf("Invalid timestamp item");
    expect(validPos).toBeGreaterThan(-1);
    expect(invalidPos).toBeGreaterThan(-1);
    expect(validPos).toBeLessThan(invalidPos);
  });

  it("UnifiedFeed handles extremely long titles and subtitles without breaking layout", () => {
    const longString = "A".repeat(5000);
    const markup = renderToStaticMarkup(
      <UnifiedFeed
        items={[
          {
            id: "long-item",
            type: "alert" as const,
            priority: 10,
            title: longString,
            subtitle: longString,
            timestamp: "2026-04-23T04:00:00.000Z",
            data: {}
          }
        ]}
      />
    );
    // The content should be present (escaped) and the component should not throw.
    expect(markup).toContain(longString);
  });

  it("UnifiedFeed handles emoji, RTL, and zero-width characters in item text", () => {
    const edgeCases = [
      { id: "emoji", title: "🚨 Alert: 🎯 Goal completed ✅", subtitle: "Emoji test" },
      { id: "rtl", title: "تنبيه: تم إكمال الهدف", subtitle: "RTL text test" },
      { id: "zwc", title: "\u200B\u200C\u200DZero-width chars\uFEFF", subtitle: "Zero-width test" }
    ];

    for (const edge of edgeCases) {
      const markup = renderToStaticMarkup(
        <UnifiedFeed
          items={[
            {
              id: edge.id,
              type: "alert" as const,
              priority: 5,
              title: edge.title,
              subtitle: edge.subtitle,
              timestamp: "2026-04-23T04:00:00.000Z",
              data: {}
            }
          ]}
        />
      );
      expect(markup).toContain(edge.title);
      expect(markup).toContain(edge.subtitle);
    }
  });

  it("GoalDetailPanel renders safely with empty tasks, artifacts, approvals, watchers, and actionLogs", () => {
    // A bundle with only the required goal/workflow and nothing else must still
    // render without throwing and show the empty section headers.
    const emptyBundle = buildPoisonedBundle();
    emptyBundle.tasks = [];
    emptyBundle.artifacts = [];
    emptyBundle.approvals = [];
    emptyBundle.watchers = [];
    emptyBundle.actionLogs = [];

    // Replace poisoned fields with clean ones for this specific test.
    const cleanBundle = GoalBundleSchema.parse({
      ...emptyBundle,
      goal: {
        ...emptyBundle.goal,
        title: "Empty bundle test",
        request: "Test empty sections.",
        explanation: "All sub-collections are empty."
      }
    });

    const markup = renderToStaticMarkup(<GoalDetailPanel bundle={cleanBundle} onClose={() => {}} />);
    expect(markup).toContain("Tasks (0)");
    expect(markup).toContain("Activity Log (0)");
    // Artifacts and Approvals sections should not render when empty.
    expect(markup).not.toContain("Artifacts (");
    expect(markup).not.toContain("Approvals (");
  });
});
