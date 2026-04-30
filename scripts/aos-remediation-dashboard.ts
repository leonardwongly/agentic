import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
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

interface GitHubIssueApiRecord extends LiveIssue {
  html_url?: string;
  pull_request?: unknown;
}

interface ParsedArgs {
  configPath: string;
  format: "markdown" | "json";
  outputPath: string | null;
  verifyIssueQuery: boolean;
  includeGitSnapshot: boolean;
}

interface FormatOutputOptions {
  format: "markdown" | "json";
  includeGitSnapshot?: boolean;
  cwd?: string;
}

const DEFAULT_CONFIG_PATH = "config/remediation/aos-tracker.json";
const EXPECTED_AOS_IDS = Array.from({ length: 19 }, (_, index) => `AOS-${String(index).padStart(2, "0")}`);
const GH_ISSUE_QUERY_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const VALID_PRIORITIES: Priority[] = ["critical", "high", "medium", "low"];
const VALID_PRIORITY_SET = new Set<string>(VALID_PRIORITIES);
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
  const items = Array.isArray(tracker.items) ? tracker.items : [];
  const byLane: Record<string, number> = {};
  const byPriority: Record<Priority, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0
  };

  for (const item of items) {
    if (isRecord(item) && typeof item.lane === "string") {
      byLane[item.lane] = (byLane[item.lane] ?? 0) + 1;
    }
    if (isRecord(item) && isPriority(item.priority)) {
      byPriority[item.priority] += 1;
    }
  }

  return {
    totalItems: items.length,
    byLane,
    byPriority,
    blockedByBaseline: items
      .filter((item) => isRecord(item) && Array.isArray(item.dependencies) && item.dependencies.includes("AOS-00"))
      .map((item) => item.id)
      .filter((id): id is string => typeof id === "string")
      .sort()
  };
}

export function validateAosTracker(tracker: AosTracker): string[] {
  const errors: string[] = [];
  if (!isRecord(tracker)) {
    return ["Tracker manifest must be an object."];
  }

  const sourceOfTruth = readArray<AosSourceOfTruth>(tracker.sourceOfTruth, "sourceOfTruth", errors);
  const lanes = readArray<AosLane>(tracker.lanes, "lanes", errors);
  const baselineCommands = readArray<AosBaselineCommand>(tracker.baselineCommands, "baselineCommands", errors);
  const items = readArray<AosTrackerItem>(tracker.items, "items", errors);
  const laneIds = new Set<string>();
  const itemIds: string[] = [];
  const itemIdSet = new Set(itemIds);

  if (tracker.version !== 1) {
    errors.push("Tracker version must be 1.");
  }
  for (const field of ["repository", "program", "reviewedAt"] as const) {
    const value = readString(tracker[field], field, errors);
    if (value !== null && !value.trim()) {
      errors.push(`${field} must not be empty.`);
    }
  }

  const sourceIds: string[] = [];
  for (let index = 0; index < sourceOfTruth.length; index += 1) {
    const source = readRecord(sourceOfTruth[index], `sourceOfTruth[${index}]`, errors);
    if (!source) {
      continue;
    }
    const id = readString(source.id, `sourceOfTruth[${index}].id`, errors);
    if (id) {
      sourceIds.push(id);
    }
    for (const field of ["path", "authority", "rule"] as const) {
      const value = readString(source[field], `sourceOfTruth[${index}].${field}`, errors);
      if (value !== null && !value.trim()) {
        errors.push(`sourceOfTruth[${index}].${field} must not be empty.`);
      }
    }
  }
  sourceIds.sort();
  for (const requiredSourceId of REQUIRED_SOURCE_IDS) {
    if (!sourceIds.includes(requiredSourceId)) {
      errors.push(`Missing source-of-truth entry: ${requiredSourceId}.`);
    }
  }

  for (let index = 0; index < lanes.length; index += 1) {
    const lane = readRecord(lanes[index], `lanes[${index}]`, errors);
    if (!lane) {
      continue;
    }
    const id = readString(lane.id, `lanes[${index}].id`, errors);
    if (id) {
      if (laneIds.has(id)) {
        errors.push(`Duplicate lane id: ${id}.`);
      }
      laneIds.add(id);
    }
    const laneName = id ?? `lanes[${index}]`;
    const label = readString(lane.label, `${laneName}.label`, errors);
    if (label !== null && !label.trim()) {
      errors.push(`${laneName} must have a GitHub lane label.`);
    }
    const owner = readString(lane.owner, `${laneName}.owner`, errors);
    if (owner !== null && !owner.trim()) {
      errors.push(`${laneName} must have an owner.`);
    }
  }

  const commandIds = new Set<string>();
  for (let index = 0; index < baselineCommands.length; index += 1) {
    const command = readRecord(baselineCommands[index], `baselineCommands[${index}]`, errors);
    if (!command) {
      continue;
    }
    const id = readString(command.id, `baselineCommands[${index}].id`, errors);
    if (id) {
      commandIds.add(id);
    }
    for (const field of ["command", "purpose"] as const) {
      const value = readString(command[field], `baselineCommands[${index}].${field}`, errors);
      if (value !== null && !value.trim()) {
        errors.push(`baselineCommands[${index}].${field} must not be empty.`);
      }
    }
  }
  for (const requiredCommandId of REQUIRED_BASELINE_COMMAND_IDS) {
    if (!commandIds.has(requiredCommandId)) {
      errors.push(`Missing baseline command: ${requiredCommandId}.`);
    }
  }

  for (let index = 0; index < items.length; index += 1) {
    const item = readRecord(items[index], `items[${index}]`, errors);
    if (!item) {
      continue;
    }
    const id = readString(item.id, `items[${index}].id`, errors);
    if (id) {
      itemIds.push(id);
    }
  }
  itemIds.sort();
  for (const itemId of itemIds) {
    itemIdSet.add(itemId);
  }

  if (JSON.stringify(itemIds) !== JSON.stringify(EXPECTED_AOS_IDS)) {
    errors.push(`Tracker must contain exactly ${EXPECTED_AOS_IDS.join(", ")}.`);
  }

  const issueNumbers = new Set<number>();
  const cycleCandidates: AosTrackerItem[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = readRecord(items[index], `items[${index}]`, errors);
    if (!item) {
      continue;
    }
    const id = readString(item.id, `items[${index}].id`, errors);
    const itemName = id ?? `items[${index}]`;
    const issue = readIssueNumber(item.issue, `${itemName}.issue`, errors);
    if (issue !== null && issueNumbers.has(issue)) {
      errors.push(`Duplicate GitHub issue number: ${issue}.`);
    }
    if (issue !== null) {
      issueNumbers.add(issue);
    }

    const lane = readString(item.lane, `${itemName}.lane`, errors);
    if (lane !== null && !laneIds.has(lane)) {
      errors.push(`${itemName} uses unknown lane ${lane}.`);
    }

    const priority = readString(item.priority, `${itemName}.priority`, errors);
    if (priority !== null && !isPriority(priority)) {
      errors.push(`${itemName} uses unknown priority ${priority}.`);
    }

    const title = readString(item.title, `${itemName}.title`, errors);
    if (title !== null && !title.trim()) {
      errors.push(`${itemName} must have a title.`);
    }

    const phase = readString(item.phase, `${itemName}.phase`, errors);
    if (phase !== null && !phase.trim()) {
      errors.push(`${itemName} must have a phase.`);
    }

    const validationGates = readArray<string>(item.validationGates, `${itemName}.validationGates`, errors);
    if (validationGates.length === 0) {
      errors.push(`${itemName} must define at least one validation gate.`);
    }

    for (let gateIndex = 0; gateIndex < validationGates.length; gateIndex += 1) {
      const gate = readString(validationGates[gateIndex], `${itemName}.validationGates[${gateIndex}]`, errors);
      if (gate !== null && !gate.trim()) {
        errors.push(`${itemName}.validationGates[${gateIndex}] must not be empty.`);
      }
    }

    const dependencies = readArray<string>(item.dependencies, `${itemName}.dependencies`, errors);
    const validDependencies: string[] = [];
    for (let dependencyIndex = 0; dependencyIndex < dependencies.length; dependencyIndex += 1) {
      const dependency = readString(dependencies[dependencyIndex], `${itemName}.dependencies[${dependencyIndex}]`, errors);
      if (dependency === null) {
        continue;
      }
      validDependencies.push(dependency);
      if (!itemIdSet.has(dependency)) {
        errors.push(`${itemName} depends on unknown item ${dependency}.`);
      }
    }

    if (id && issue !== null && lane !== null && phase !== null && isPriority(priority) && title !== null) {
      cycleCandidates.push({
        id,
        issue,
        title,
        lane,
        phase,
        priority,
        dependencies: validDependencies,
        validationGates
      });
    }
  }

  for (const cycle of findDependencyCycles(cycleCandidates)) {
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
  const validationErrors = validateAosTracker(tracker);
  const summary = summarizeAosTracker(tracker);
  const sourceOfTruth = Array.isArray(tracker.sourceOfTruth) ? tracker.sourceOfTruth : [];
  const lanes = Array.isArray(tracker.lanes) ? tracker.lanes : [];
  const baselineCommands = Array.isArray(tracker.baselineCommands) ? tracker.baselineCommands : [];
  const items = Array.isArray(tracker.items) ? tracker.items : [];
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
  for (const source of sourceOfTruth) {
    if (!isRecord(source)) {
      continue;
    }
    lines.push(`| ${source.id} | ${source.authority} | ${source.rule} |`);
  }

  lines.push("");
  lines.push("## Ownership Lanes");
  lines.push("");
  lines.push("| Lane | Label | Owner | Items | Scope |");
  lines.push("| --- | --- | --- | ---: | --- |");
  for (const lane of lanes) {
    if (!isRecord(lane)) {
      continue;
    }
    const laneId = String(lane.id);
    lines.push(`| ${laneId} | ${lane.label} | ${lane.owner} | ${summary.byLane[laneId] ?? 0} | ${lane.scope} |`);
  }

  lines.push("");
  lines.push("## Baseline Commands");
  lines.push("");
  lines.push("| Gate | Command | Purpose |");
  lines.push("| --- | --- | --- |");
  for (const command of baselineCommands) {
    if (!isRecord(command)) {
      continue;
    }
    lines.push(`| ${command.id} | \`${command.command}\` | ${command.purpose} |`);
  }

  lines.push("");
  lines.push("## AOS Tracker");
  lines.push("");
  lines.push("| ID | Issue | Lane | Priority | Dependencies | First validation gate |");
  lines.push("| --- | ---: | --- | --- | --- | --- |");
  for (const item of items
    .filter(isRecord)
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))) {
    const dependencies = Array.isArray(item.dependencies) ? item.dependencies.join(", ") : "invalid";
    const firstValidationGate = Array.isArray(item.validationGates) ? item.validationGates[0] ?? "none" : "invalid";
    lines.push(
      `| ${item.id} | #${item.issue} | ${item.lane} | ${item.priority} | ${dependencies || "none"} | ${firstValidationGate} |`
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
    `- Live coverage query: \`gh api --paginate --slurp repos/${tracker.repository}/issues?state=all&per_page=100\``
  );

  return `${lines.join("\n")}\n`;
}

export function formatAosTrackerOutput(tracker: unknown, errors: string[], options: FormatOutputOptions): string {
  if (options.format === "json") {
    return `${JSON.stringify(
      {
        tracker,
        summary: isRecord(tracker) ? summarizeAosTracker(tracker as AosTracker) : null,
        errors
      },
      null,
      2
    )}\n`;
  }

  if (!isRecord(tracker)) {
    return ["# Agentic OS remediation Dashboard", "", "- Manifest validation: fail", ...errors.map((error) => `  - ${error}`), ""].join(
      "\n"
    );
  }

  const rendered = renderAosDashboard(tracker as AosTracker, {
    includeGitSnapshot: options.includeGitSnapshot,
    cwd: options.cwd
  });
  const missingErrors = errors.filter((error) => !rendered.includes(error));

  if (missingErrors.length === 0) {
    return rendered;
  }

  return `${rendered}\n## Verification Errors\n\n${missingErrors.map((error) => `- ${error}`).join("\n")}\n`;
}

export function verifyLiveIssueCoverage(tracker: AosTracker, repo = tracker.repository): string[] {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repo)) {
    return [`Invalid GitHub repository identifier: ${repo}`];
  }
  const expectedIssueNumbers = new Set(tracker.items.map((item) => item.issue));

  const result = spawnSync(
    "gh",
    ["api", "--paginate", "--slurp", `repos/${repo}/issues?state=all&per_page=100`],
    {
      encoding: "utf8",
      maxBuffer: GH_ISSUE_QUERY_MAX_BUFFER_BYTES
    }
  );

  if (result.error) {
    return [`Failed to execute gh: ${result.error.message}`];
  }

  if (result.status !== 0) {
    return [`gh issue pagination failed: ${result.stderr.trim() || "unknown error"}`];
  }

  let liveIssues: LiveIssue[];
  try {
    const pages = JSON.parse(result.stdout) as GitHubIssueApiRecord[][];
    liveIssues = pages
      .flat()
      .filter(
        (issue) =>
          !issue.pull_request &&
          issue.title.includes("AOS-") &&
          (expectedIssueNumbers.has(issue.number) || issue.labels?.some((label) => label.name === "aos-remediation"))
      )
      .map((issue) => ({
        number: issue.number,
        title: issue.title,
        labels: issue.labels,
        url: issue.html_url ?? issue.url
      }));
  } catch (error) {
    return [`Failed to parse gh issue pagination JSON: ${error instanceof Error ? error.message : String(error)}`];
  }

  const expected = new Map(tracker.items.map((item) => [item.issue, item]));
  const expectedById = new Map(tracker.items.map((item) => [item.id, item]));
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
    if (!id) {
      continue;
    }
    const expectedIssue = expectedById.get(id);
    if (!expectedIssue) {
      errors.push(`Unexpected live AOS issue id ${id} on #${issue.number}.`);
    } else if (expectedIssue.issue !== issue.number) {
      errors.push(`Live issue #${issue.number} claims to be ${id}, but manifest says ${id} is #${expectedIssue.issue}.`);
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
  return title.match(/\bAOS-\d+\b/u)?.[0] ?? null;
}

function runGit(args: string[], cwd: string): string | null {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    return null;
  }
  return result.stdout.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown, field: string, errors: string[]): Record<string, unknown> | null {
  if (!isRecord(value)) {
    errors.push(`${field} must be an object.`);
    return null;
  }

  return value;
}

function readArray<T>(value: unknown, field: string, errors: string[]): T[] {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array.`);
    return [];
  }
  return value as T[];
}

function readString(value: unknown, field: string, errors: string[]): string | null {
  if (typeof value !== "string") {
    errors.push(`${field} must be a string.`);
    return null;
  }
  return value;
}

function readIssueNumber(value: unknown, field: string, errors: string[]): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    errors.push(`${field} must be a positive integer.`);
    return null;
  }
  return value;
}

function isPriority(value: unknown): value is Priority {
  return typeof value === "string" && VALID_PRIORITY_SET.has(value);
}

function resolveRepoPath(cwd: string, targetPath: string): string {
  const repoRoot = realpathSync(path.resolve(cwd));
  const resolvedPath = path.resolve(repoRoot, targetPath);
  const canonicalPath = existsSync(resolvedPath)
    ? realpathSync(resolvedPath)
    : path.join(realpathSync(path.dirname(resolvedPath)), path.basename(resolvedPath));
  const relativePath = path.relative(repoRoot, canonicalPath);

  if (relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))) {
    return canonicalPath;
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
  const liveErrors = args.verifyIssueQuery && manifestErrors.length === 0 ? verifyLiveIssueCoverage(tracker) : [];
  const errors = [...manifestErrors, ...liveErrors];
  const output = formatAosTrackerOutput(tracker, errors, {
    format: args.format,
    includeGitSnapshot: args.includeGitSnapshot,
    cwd: process.cwd()
  });

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
