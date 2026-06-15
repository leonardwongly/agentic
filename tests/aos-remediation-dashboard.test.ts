import { existsSync, mkdtempSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawnSync: spawnSyncMock
}));

import {
  formatAosTrackerOutput,
  loadAosTracker,
  renderAosDashboard,
  summarizeAosTracker,
  validateAosTracker,
  verifyLiveIssueCoverage
} from "../scripts/aos-remediation-dashboard";

const repoRoot = process.cwd();

describe("AOS remediation tracker", () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
  });

  it("keeps required AOS baseline items covered by a valid manifest", () => {
    const tracker = loadAosTracker();
    const requiredIds = Array.from({ length: 19 }, (_, index) => `AOS-${String(index).padStart(2, "0")}`);

    expect(validateAosTracker(tracker)).toEqual([]);
    expect(tracker.itemIdPolicy.requiredIds).toEqual(requiredIds);
    // The manifest scales beyond the original 19-item baseline (see #721): the
    // required baseline must stay fully covered, while later canonical AOS items
    // (AOS-19+) may extend the tracker.
    const itemIds = new Set(tracker.items.map((item) => item.id));
    for (const requiredId of requiredIds) {
      expect(itemIds.has(requiredId)).toBe(true);
    }
    expect(new Set(tracker.items.map((item) => item.issue)).size).toBe(tracker.items.length);
  });

  it("accepts future canonical AOS tracker items without changing dashboard code", () => {
    const tracker = loadAosTracker();
    const expandedTracker = structuredClone(tracker);

    expandedTracker.items.push({
      id: "AOS-90",
      issue: 721,
      title: "Scale remediation tracker beyond the AOS baseline",
      lane: "shell",
      phase: "Phase 4 - Shell and maintainability",
      priority: "critical",
      dependencies: ["AOS-18"],
      validationGates: ["npm run remediation:verify"]
    });
    expandedTracker.items.push({
      id: "AOS-100",
      issue: 722,
      title: "Track future generated AOS plan item",
      lane: "shell",
      phase: "Phase 4 - Shell and maintainability",
      priority: "medium",
      dependencies: ["AOS-90"],
      validationGates: ["npx vitest run tests/aos-remediation-dashboard.test.ts"]
    });

    expect(validateAosTracker(expandedTracker)).toEqual([]);
    expect(summarizeAosTracker(expandedTracker).totalItems).toBe(tracker.items.length + 2);
    const dashboard = renderAosDashboard(expandedTracker);
    expect(dashboard).toContain("| AOS-90 | #721 | shell | critical | AOS-18 |");
    expect(dashboard.indexOf("| AOS-90 |")).toBeLessThan(dashboard.indexOf("| AOS-100 |"));
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

    expect(summary.totalItems).toBe(28);
    expect(summary.byLane).toMatchObject({
      "trust-spine": 7,
      "execution-spine": 9,
      "intelligence-fabric": 10,
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
    expect(dashboard).toContain("gh api --paginate --slurp repos/leonardwongly/agentic/issues?state=all&per_page=100");
    expect(dashboard).toContain("--state all");
    expect(dashboard).not.toContain("--state open");
    expect(dashboard).toContain("git fetch origin --prune && git rev-list --left-right --count origin/main...HEAD");
    expect(dashboard).toContain("| AOS-00 | #11 | trust-spine | critical | none |");
    expect(dashboard).toContain("- Manifest validation: pass");
  });

  it("rejects malformed tracker fields before they corrupt summaries", () => {
    const tracker = loadAosTracker();
    const malformedTracker = structuredClone(tracker);
    malformedTracker.repository = null as unknown as string;
    malformedTracker.program = "";
    malformedTracker.reviewedAt = 42 as unknown as string;
    malformedTracker.sourceOfTruth[0].path = null as unknown as string;
    malformedTracker.sourceOfTruth[0].authority = "   ";
    malformedTracker.itemIdPolicy.rule = "";
    malformedTracker.itemIdPolicy.requiredIds = ["AOS-00", "AOS-010"];
    malformedTracker.itemIdPolicy.acceptedPrefixes = ["aos"];
    malformedTracker.baselineCommands[0].command = 42 as unknown as string;
    malformedTracker.baselineCommands[0].purpose = "";
    malformedTracker.lanes[0].label = null as unknown as string;
    malformedTracker.lanes[0].owner = 42 as unknown as string;
    malformedTracker.items[0].priority = "critcal" as unknown as (typeof malformedTracker.items)[number]["priority"];
    malformedTracker.items[0].validationGates = [""];

    expect(validateAosTracker(malformedTracker)).toEqual(
      expect.arrayContaining([
        "repository must be a string.",
        "program must not be empty.",
        "reviewedAt must be a string.",
        "sourceOfTruth[0].path must be a string.",
        "sourceOfTruth[0].authority must not be empty.",
        "itemIdPolicy.rule must not be empty.",
        "itemIdPolicy.acceptedPrefixes[0] must be an uppercase alphanumeric prefix.",
        "itemIdPolicy.requiredIds contains unsupported item id AOS-00.",
        "itemIdPolicy.requiredIds contains unsupported item id AOS-010.",
        "AOS-00 does not match accepted item ID policy.",
        "baselineCommands[0].command must be a string.",
        "baselineCommands[0].purpose must not be empty.",
        "trust-spine.label must be a string.",
        "trust-spine.owner must be a string.",
        "AOS-00 uses unknown priority critcal.",
        "AOS-00.validationGates[0] must not be empty."
      ])
    );
    expect(summarizeAosTracker(malformedTracker).byPriority).toEqual({
      critical: summarizeAosTracker(tracker).byPriority.critical - 1,
      high: summarizeAosTracker(tracker).byPriority.high,
      medium: summarizeAosTracker(tracker).byPriority.medium,
      low: summarizeAosTracker(tracker).byPriority.low
    });
    expect(renderAosDashboard(malformedTracker)).toContain("- Manifest validation: fail");
  });

  it("reports malformed manifest array entries instead of dereferencing them", () => {
    const tracker = loadAosTracker();
    const malformedTracker = structuredClone(tracker);
    malformedTracker.sourceOfTruth.splice(1, 0, null as unknown as (typeof malformedTracker.sourceOfTruth)[number]);
    malformedTracker.lanes.splice(1, 0, null as unknown as (typeof malformedTracker.lanes)[number]);
    malformedTracker.baselineCommands.splice(1, 0, null as unknown as (typeof malformedTracker.baselineCommands)[number]);
    malformedTracker.items.splice(1, 0, null as unknown as (typeof malformedTracker.items)[number]);

    expect(validateAosTracker(malformedTracker)).toEqual(
      expect.arrayContaining([
        "sourceOfTruth[1] must be an object.",
        "lanes[1] must be an object.",
        "baselineCommands[1] must be an object.",
        "items[1] must be an object."
      ])
    );
    expect(() => renderAosDashboard(malformedTracker)).not.toThrow();
  });

  it("formats invalid non-object manifests without dereferencing dashboard fields", () => {
    const errors = validateAosTracker(null as never);

    expect(formatAosTrackerOutput(null, errors, { format: "markdown" })).toContain("Tracker manifest must be an object.");
    expect(JSON.parse(formatAosTrackerOutput(null, errors, { format: "json" }))).toEqual({
      tracker: null,
      summary: null,
      errors: ["Tracker manifest must be an object."]
    });
  });

  it("surfaces live verification failures in markdown output for valid manifests", () => {
    const tracker = loadAosTracker();
    const output = formatAosTrackerOutput(tracker, ["Live issue #12 is missing."], { format: "markdown" });

    expect(output).toContain("- Manifest validation: pass");
    expect(output).toContain("## Verification Errors");
    expect(output).toContain("- Live issue #12 is missing.");
  });

  it("verifies live issue coverage across open and closed tracker issues", () => {
    const tracker = loadAosTracker();
    spawnSyncMock.mockReturnValue({
      error: undefined,
      status: 0,
      stdout: JSON.stringify([
        tracker.items.map((item) => ({
          number: item.issue,
          title: `[${item.id}] ${item.title}`,
          labels: [{ name: "aos-remediation" }, { name: tracker.lanes.find((lane) => lane.id === item.lane)?.label }],
          url: `https://github.com/leonardwongly/agentic/issues/${item.issue}`
        }))
      ]),
      stderr: ""
    });

    expect(verifyLiveIssueCoverage(tracker)).toEqual([]);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["api", "--paginate", "--slurp", "repos/leonardwongly/agentic/issues?state=all&per_page=100"]),
      expect.objectContaining({ encoding: "utf8", maxBuffer: expect.any(Number) })
    );
    expect(spawnSyncMock.mock.calls[0][2].maxBuffer).toBeGreaterThan(1024 * 1024);
  });

  it("paginates live issue coverage instead of truncating AOS issue history", () => {
    const tracker = loadAosTracker();
    const liveIssue = (item: (typeof tracker.items)[number]) => ({
      number: item.issue,
      title: `[${item.id}] ${item.title}`,
      labels: [{ name: "aos-remediation" }, { name: tracker.lanes.find((lane) => lane.id === item.lane)?.label }],
      html_url: `https://github.com/leonardwongly/agentic/issues/${item.issue}`
    });
    const nonIssuePullRequest = {
      number: 1000,
      title: "[AOS-99] Pull request should not count as a live remediation issue",
      labels: [{ name: "aos-remediation" }],
      pull_request: {}
    };
    const unrelatedIssue = {
      number: 1001,
      title: "Postmortem for AOS-05 rollout",
      labels: []
    };

    spawnSyncMock.mockReturnValue({
      error: undefined,
      status: 0,
      stdout: JSON.stringify([
        [nonIssuePullRequest, unrelatedIssue, ...tracker.items.slice(0, 10).map(liveIssue)],
        tracker.items.slice(10).map(liveIssue)
      ]),
      stderr: ""
    });

    expect(verifyLiveIssueCoverage(tracker)).toEqual([]);
  });

  it("rejects live issues that claim the wrong AOS identifier", () => {
    const tracker = loadAosTracker();
    spawnSyncMock.mockReturnValue({
      error: undefined,
      status: 0,
      stdout: JSON.stringify([
        tracker.items.map((item) => ({
          number: item.issue,
          title: `[${item.id === "AOS-01" ? "AOS-02" : item.id}] ${item.title}`,
          labels: [{ name: "aos-remediation" }, { name: tracker.lanes.find((lane) => lane.id === item.lane)?.label }],
          url: `https://github.com/leonardwongly/agentic/issues/${item.issue}`
        }))
      ]),
      stderr: ""
    });

    expect(verifyLiveIssueCoverage(tracker)).toContain("Live issue #12 claims to be AOS-02, but manifest says AOS-02 is #13.");
  });

  it("accepts future live AOS identifiers while rejecting ambiguous padded identifiers", () => {
    const tracker = loadAosTracker();
    spawnSyncMock.mockReturnValue({
      error: undefined,
      status: 0,
      stdout: JSON.stringify([
        [
          ...tracker.items.map((item) => ({
            number: item.issue,
            title: `[${item.id}] ${item.title}`,
            labels: [{ name: "aos-remediation" }, { name: tracker.lanes.find((lane) => lane.id === item.lane)?.label }],
            url: `https://github.com/leonardwongly/agentic/issues/${item.issue}`
          })),
          {
            number: 9991,
            title: "[AOS-010] Duplicate padded remediation issue",
            labels: [{ name: "aos-remediation" }],
            url: "https://github.com/leonardwongly/agentic/issues/9991"
          },
          {
            number: 9992,
            title: "[AOS-100] Future remediation issue",
            labels: [{ name: "aos-remediation" }],
            url: "https://github.com/leonardwongly/agentic/issues/9992"
          }
        ]
      ]),
      stderr: ""
    });

    expect(verifyLiveIssueCoverage(tracker)).toEqual(["Unexpected live AOS issue id AOS-010 on #9991."]);
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

  it("rejects repo-local symlinks that resolve outside the repository", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "agentic-aos-tracker-"));
    const outsideManifest = path.join(tempDir, "outside-tracker.json");
    const symlinkPath = path.join(repoRoot, "config", "remediation", "outside-tracker-link.json");
    writeFileSync(outsideManifest, "{}", "utf8");
    symlinkSync(outsideManifest, symlinkPath);

    try {
      expect(() => loadAosTracker("config/remediation/outside-tracker-link.json")).toThrow(
        "Path must stay inside the repository"
      );
    } finally {
      try {
        unlinkSync(symlinkPath);
      } catch {
        // Best effort cleanup for platforms that restrict symlink writes in tests.
      }
    }
  });
});
