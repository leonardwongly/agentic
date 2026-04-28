import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

type Priority = "critical" | "high" | "medium" | "low";

export interface AosSourceOfTruth {
  id: string;
  path: string;
  authority: string;
  rule: string;
}

export interface AosLane {
  id: string;
  label: string;
  owner: string;
  scope: string;
}

export interface AosBaselineCommand {
  id: string;
  command: string;
  purpose: string;
}

export interface AosTrackerItem {
  id: string;
  issue: number;
  title: string;
  lane: string;
  phase: string;
  priority: Priority;
  dependencies: string[];
  validationGates: string[];
}

export interface AosTracker {
  version: number;
  reviewedAt: string;
  repository: string;
  program: string;
  sourceOfTruth: AosSourceOfTruth[];
  lanes: AosLane[];
  baselineCommands: AosBaselineCommand[];
  items: AosTrackerItem[];
}

export interface AosTrackerSummary {
  totalItems: number;
  byLane: Record<string, number>;
  byPriority: Record<Priority, number>;
  blockedByBaseline: string[];
}

interface RenderOptions {
  includeGitSnapshot?: boolean;
  cwd?: string;
}

interface GitSnapshot {
  branch: string;
  head: string;
  originMainBehind: number | null;
  originMainAhead: number | null;
  originBranchBehind: number | null;
  originBranchAhead: number | null;
  status: "clean" | "dirty" | "unknown";
}

interface LiveIssue {
  number: number;
  title: string;
  labels?: Array<{ name: string }>;
  url?: string;
}

interface ParsedArgs {
  configPath: string;
  format: "markdown" | "json";
  outputPath: string | null;
  verifyIssueQuery: boolean;
  includeGitSnapshot: boolean;
}

const DEFAULT_CONFIG_PATH = "config/remediation/aos-tracker.json";
const EXPECTED_AOS_IDS = Array.from({ length: 19 }, (_, index) => `AOS-${String(index).padStart(2, "0")}`);
const REQUIRED_SOURCE_IDS = ["blueprint", "assessment", "tracker", "implementation"];
const REQUIRED_BASELINE_COMMAND_IDS = [
  "branch-divergence",
  "tracker-coverage",
  "capability-baseline",
  "npm-audit",
  "runtime-audit-gate",
  "unit-integration",
  "security-regression",
  "architecture-fitness",
  "performance-fitness",
  "build"
];

export function loadAosTracker(configPath = DEFAULT_CONFIG_PATH, cwd = process.cwd()): AosTracker {
  const resolvedPath = resolveRepoPath(cwd, configPath);
  return JSON.parse(readFileSync(resolvedPath, "utf8")) as AosTracker;
}

export function summarizeAosTracker(tracker: AosTracker): AosTrackerSummary {
  const byLane: Record<string, number> = {};
  const byPriority: Record<Priority, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0
  };

  for (const item of tracker.items) {
    byLane[item.lane] = (byLane[item.lane] ?? 0) + 1;
    byPriority[item.priority] += 1;
  }

  return {
    totalItems: tracker.items.length,
    byLane,
    byPriority,
    blockedByBaseline: tracker.items
      .filter((item) => item.dependencies.includes("AOS-00"))
      .map((item) => item.id)
      .sort()
  };
}

export function validateAosTracker(tracker: AosTracker): string[] {
  const errors: string[] = [];
  const laneIds = new Set(tracker.lanes.map((lane) => lane.id));
  const itemIds = tracker.items.map((item) => item.id).sort();
  const itemIdSet = new Set(itemIds);

  if (tracker.version !== 1) {
    errors.push("Tracker version must be 1.");
  }

  const sourceIds = tracker.sourceOfTruth.map((source) => source.id).sort();
  for (const requiredSourceId of REQUIRED_SOURCE_IDS) {
    if (!sourceIds.includes(requiredSourceId)) {
      errors.push(`Missing source-of-truth entry: ${requiredSourceId}.`);
    }
  }

  if (laneIds.size !== tracker.lanes.length) {
    errors.push("Lane ids must be unique.");
  }

  for (const lane of tracker.lanes) {
    if (!lane.label.trim()) {
      errors.push(`${lane.id} must have a GitHub lane label.`);
    }
    if (!lane.owner.trim()) {
      errors.push(`${lane.id} must have an owner.`);
    }
  }

  for (const requiredCommandId of REQUIRED_BASELINE_COMMAND_IDS) {
    if (!tracker.baselineCommands.some((command) => command.id === requiredCommandId)) {
      errors.push(`Missing baseline command: ${requiredCommandId}.`);
    }
  }

  if (JSON.stringify(itemIds) !== JSON.stringify(EXPECTED_AOS_IDS)) {
    errors.push(`Tracker must contain exactly ${EXPECTED_AOS_IDS.join(", ")}.`);
  }

  const issueNumbers = new Set<number>();
  for (const item of tracker.items) {
    if (issueNumbers.has(item.issue)) {
      errors.push(`Duplicate GitHub issue number: ${item.issue}.`);
    }
    issueNumbers.add(item.issue);

    if (!laneIds.has(item.lane)) {
      errors.push(`${item.id} uses unknown lane ${item.lane}.`);
    }

    if (!item.title.trim()) {
      errors.push(`${item.id} must have a title.`);
    }

    if (!item.phase.trim()) {
      errors.push(`${item.id} must have a phase.`);
    }

    if (item.validationGates.length === 0) {
      errors.push(`${item.id} must define at least one validation gate.`);
    }

    for (const dependency of item.dependencies) {
      if (!itemIdSet.has(dependency)) {
        errors.push(`${item.id} depends on unknown item ${dependency}.`);
      }
    }

  }

  for (const cycle of findDependencyCycles(tracker.items)) {
    errors.push(`Dependency cycle detected: ${cycle.join(" -> ")}.`);
  }

  return errors;
}

export function collectGitSnapshot(cwd = process.cwd()): GitSnapshot {
  const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd) ?? "unknown";
  const head = runGit(["rev-parse", "--short", "HEAD"], cwd) ?? "unknown";
  const originMainDivergence = parseDivergence(runGit(["rev-list", "--left-right", "--count", "origin/main...HEAD"], cwd));
  const originBranchDivergence =
    branch === "unknown"
      ? null
      : parseDivergence(runGit(["rev-list", "--left-right", "--count", `origin/${branch}...HEAD`], cwd));
  const statusOutput = runGit(["status", "--porcelain"], cwd);

  return {
    branch,
    head,
    originMainBehind: originMainDivergence?.left ?? null,
    originMainAhead: originMainDivergence?.right ?? null,
    originBranchBehind: originBranchDivergence?.left ?? null,
    originBranchAhead: originBranchDivergence?.right ?? null,
    status: statusOutput === null ? "unknown" : statusOutput.length === 0 ? "clean" : "dirty"
  };
}

export function renderAosDashboard(tracker: AosTracker, options: RenderOptions = {}): string {
  const summary = summarizeAosTracker(tracker);
  const validationErrors = validateAosTracker(tracker);
  const lines: string[] = [];

  lines.push(`# ${tracker.program} Dashboard`);
  lines.push("");
  lines.push(`- Reviewed at: ${tracker.reviewedAt}`);
  lines.push(`- Repository: ${tracker.repository}`);
  lines.push(`- Tracker items: ${summary.totalItems}`);
  lines.push(`- Critical items: ${summary.byPriority.critical}`);
  lines.push(`- Items blocked by AOS-00 baseline: ${summary.blockedByBaseline.join(", ") || "none"}`);

  if (options.includeGitSnapshot) {
    const snapshot = collectGitSnapshot(options.cwd);
    lines.push(`- Branch: ${snapshot.branch} @ ${snapshot.head}`);
    lines.push(`- Divergence from origin/main: behind ${snapshot.originMainBehind ?? "unknown"}, ahead ${snapshot.originMainAhead ?? "unknown"}`);
    lines.push(`- Divergence from origin/${snapshot.branch}: behind ${snapshot.originBranchBehind ?? "unknown"}, ahead ${snapshot.originBranchAhead ?? "unknown"}`);
    lines.push(`- Working tree: ${snapshot.status}`);
  }

  lines.push("");
  lines.push("## Source Of Truth");
  lines.push("");
  lines.push("| Source | Authority | Rule |");
  lines.push("| --- | --- | --- |");
  for (const source of tracker.sourceOfTruth) {
    lines.push(`| ${source.id} | ${source.authority} | ${source.rule} |`);
  }

  lines.push("");
  lines.push("## Ownership Lanes");
  lines.push("");
  lines.push("| Lane | Label | Owner | Items | Scope |");
  lines.push("| --- | --- | --- | ---: | --- |");
  for (const lane of tracker.lanes) {
    lines.push(`| ${lane.id} | ${lane.label} | ${lane.owner} | ${summary.byLane[lane.id] ?? 0} | ${lane.scope} |`);
  }

  lines.push("");
  lines.push("## Baseline Commands");
  lines.push("");
  lines.push("| Gate | Command | Purpose |");
  lines.push("| --- | --- | --- |");
  for (const command of tracker.baselineCommands) {
    lines.push(`| ${command.id} | \`${command.command}\` | ${command.purpose} |`);
  }

  lines.push("");
  lines.push("## AOS Tracker");
  lines.push("");
  lines.push("| ID | Issue | Lane | Priority | Dependencies | First validation gate |");
  lines.push("| --- | ---: | --- | --- | --- | --- |");
  for (const item of [...tracker.items].sort((left, right) => left.id.localeCompare(right.id))) {
    lines.push(
      `| ${item.id} | #${item.issue} | ${item.lane} | ${item.priority} | ${item.dependencies.join(", ") || "none"} | ${
        item.validationGates[0]
      } |`
    );
  }

  lines.push("");
  lines.push("## Tracker Health");
  lines.push("");
  if (validationErrors.length === 0) {
    lines.push("- Manifest validation: pass");
  } else {
    lines.push("- Manifest validation: fail");
    for (const error of validationErrors) {
      lines.push(`  - ${error}`);
    }
  }
  lines.push(
    "- Live coverage query: `gh issue list --repo leonardwongly/agentic --search 'AOS- in:title' --state open --limit 100`"
  );

  return `${lines.join("\n")}\n`;
}

export function verifyLiveIssueCoverage(tracker: AosTracker, repo = tracker.repository): string[] {
  const result = spawnSync(
    "gh",
    ["issue", "list", "--repo", repo, "--search", "AOS- in:title", "--state", "open", "--limit", "100", "--json", "number,title,labels,url"],
    {
      encoding: "utf8"
    }
  );

  if (result.error) {
    return [`Failed to execute gh: ${result.error.message}`];
  }

  if (result.status !== 0) {
    return [`gh issue list failed: ${result.stderr.trim() || "unknown error"}`];
  }

  let liveIssues: LiveIssue[];
  try {
    liveIssues = JSON.parse(result.stdout) as LiveIssue[];
  } catch (error) {
    return [`Failed to parse gh issue JSON: ${error instanceof Error ? error.message : String(error)}`];
  }

  const expected = new Map(tracker.items.map((item) => [item.issue, item]));
  const live = new Map(liveIssues.map((issue) => [issue.number, issue]));
  const laneLabels = new Map(tracker.lanes.map((lane) => [lane.id, lane.label]));
  const errors: string[] = [];

  for (const item of expected.values()) {
    const liveIssue = live.get(item.issue);
    if (!liveIssue) {
      errors.push(`${item.id} is missing from live GitHub issue query (#${item.issue}).`);
      continue;
    }
    if (!liveIssue.title.includes(item.id)) {
      errors.push(`#${item.issue} title does not include ${item.id}: ${liveIssue.title}`);
    }
    const labels = new Set((liveIssue.labels ?? []).map((label) => label.name));
    const laneLabel = laneLabels.get(item.lane);
    if (!labels.has("aos-remediation")) {
      errors.push(`#${item.issue} is missing aos-remediation label.`);
    }
    if (laneLabel && !labels.has(laneLabel)) {
      errors.push(`#${item.issue} is missing lane label ${laneLabel}.`);
    }
  }

  for (const issue of live.values()) {
    const id = extractAosId(issue.title);
    if (id && !EXPECTED_AOS_IDS.includes(id)) {
      errors.push(`Unexpected live AOS issue id ${id} on #${issue.number}.`);
    }
  }

  return errors;
}

function findDependencyCycles(items: AosTrackerItem[]): string[][] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycles: string[][] = [];

  function visit(id: string, stack: string[]) {
    if (visiting.has(id)) {
      const cycleStart = stack.indexOf(id);
      cycles.push([...stack.slice(cycleStart), id]);
      return;
    }

    if (visited.has(id)) {
      return;
    }

    const item = byId.get(id);
    if (!item) {
      return;
    }

    visiting.add(id);
    for (const dependency of item.dependencies) {
      visit(dependency, [...stack, id]);
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const item of items) {
    visit(item.id, []);
  }

  return cycles;
}

function extractAosId(title: string): string | null {
  return title.match(/AOS-\d{2}/u)?.[0] ?? null;
}

function runGit(args: string[], cwd: string): string | null {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim();
}

function resolveRepoPath(cwd: string, targetPath: string): string {
  const repoRoot = path.resolve(cwd);
  const resolvedPath = path.resolve(repoRoot, targetPath);
  const relativePath = path.relative(repoRoot, resolvedPath);

  if (relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))) {
    return resolvedPath;
  }

  throw new Error(`Path must stay inside the repository: ${targetPath}`);
}

function parseDivergence(output: string | null): { left: number; right: number } | null {
  if (!output) {
    return null;
  }
  const [left, right] = output.split(/\s+/u).map((value) => Number.parseInt(value, 10));
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return null;
  }
  return { left, right };
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    configPath: DEFAULT_CONFIG_PATH,
    format: "markdown",
    outputPath: null,
    verifyIssueQuery: false,
    includeGitSnapshot: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case "--config":
        if (!next) {
          throw new Error("Missing value for --config.");
        }
        parsed.configPath = next;
        index += 1;
        break;
      case "--format":
        if (next !== "markdown" && next !== "json") {
          throw new Error("Missing or invalid value for --format.");
        }
        parsed.format = next;
        index += 1;
        break;
      case "--output":
        if (!next) {
          throw new Error("Missing value for --output.");
        }
        parsed.outputPath = next;
        index += 1;
        break;
      case "--verify-issue-query":
        parsed.verifyIssueQuery = true;
        break;
      case "--include-git-snapshot":
        parsed.includeGitSnapshot = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const tracker = loadAosTracker(args.configPath);
  const manifestErrors = validateAosTracker(tracker);
  const liveErrors = args.verifyIssueQuery ? verifyLiveIssueCoverage(tracker) : [];
  const errors = [...manifestErrors, ...liveErrors];
  const output =
    args.format === "json"
      ? `${JSON.stringify({ tracker, summary: summarizeAosTracker(tracker), errors }, null, 2)}\n`
      : renderAosDashboard(tracker, { includeGitSnapshot: args.includeGitSnapshot, cwd: process.cwd() });

  if (args.outputPath) {
    writeFileSync(resolveRepoPath(process.cwd(), args.outputPath), output, "utf8");
  } else {
    process.stdout.write(output);
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(error);
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
