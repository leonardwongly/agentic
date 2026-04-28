import { existsSync } from "node:fs";
import path from "node:path";

import {
  loadAosTracker,
  renderAosDashboard,
  summarizeAosTracker,
  validateAosTracker
} from "../scripts/aos-remediation-dashboard";

const repoRoot = process.cwd();

describe("AOS remediation tracker", () => {
  it("keeps AOS-00 through AOS-18 covered by a valid manifest", () => {
    const tracker = loadAosTracker();

    expect(validateAosTracker(tracker)).toEqual([]);
    expect(tracker.items.map((item) => item.id).sort()).toEqual(
      Array.from({ length: 19 }, (_, index) => `AOS-${String(index).padStart(2, "0")}`)
    );
    expect(new Set(tracker.items.map((item) => item.issue)).size).toBe(tracker.items.length);
  });

  it("keeps strategic artifacts separate from implementation proof", () => {
    const tracker = loadAosTracker();
    const sourceById = new Map(tracker.sourceOfTruth.map((source) => [source.id, source]));

    expect(sourceById.get("blueprint")).toEqual(
      expect.objectContaining({
        authority: "strategic-target",
        rule: expect.stringContaining("never count as shipped implementation proof")
      })
    );
    expect(sourceById.get("tracker")).toEqual(
      expect.objectContaining({
        authority: "engineering-backlog"
      })
    );
    expect(sourceById.get("implementation")).toEqual(
      expect.objectContaining({
        authority: "implementation-proof"
      })
    );
  });

  it("keeps lane ownership and baseline gates explicit", () => {
    const tracker = loadAosTracker();
    const summary = summarizeAosTracker(tracker);

    expect(summary.totalItems).toBe(19);
    expect(summary.byLane).toMatchObject({
      "trust-spine": 7,
      "execution-spine": 6,
      "intelligence-fabric": 4,
      shell: 2
    });
    expect(summary.blockedByBaseline).toEqual(["AOS-01", "AOS-02", "AOS-03", "AOS-05", "AOS-06"]);

    const commandIds = new Set(tracker.baselineCommands.map((command) => command.id));
    expect(commandIds.has("tracker-coverage")).toBe(true);
    expect(commandIds.has("capability-baseline")).toBe(true);
    expect(commandIds.has("npm-audit")).toBe(true);
  });

  it("renders a dashboard with live issue query guidance and branch baseline slots", () => {
    const tracker = loadAosTracker();
    const dashboard = renderAosDashboard(tracker);

    expect(dashboard).toContain("# Agentic OS remediation Dashboard");
    expect(dashboard).toContain("gh issue list --repo leonardwongly/agentic --search 'AOS- in:title'");
    expect(dashboard).toContain("git fetch origin --prune && git rev-list --left-right --count origin/main...HEAD");
    expect(dashboard).toContain("| AOS-00 | #11 | trust-spine | critical | none |");
    expect(dashboard).toContain("- Manifest validation: pass");
  });

  it("references repo files that exist for local baseline evidence", () => {
    const tracker = loadAosTracker();

    for (const source of tracker.sourceOfTruth) {
      if (source.path.startsWith("http") || source.id === "implementation") {
        continue;
      }
      expect(existsSync(path.resolve(repoRoot, source.path))).toBe(true);
    }
  });

  it("rejects tracker config paths outside the repository", () => {
    expect(() => loadAosTracker("../aos-tracker.json")).toThrow("Path must stay inside the repository");
  });
});
