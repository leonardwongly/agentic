import path from "node:path";

export type ParallelWorktreeStreamId = "spine" | "secops" | "connectors" | "governance" | "intelligence";

export type ParallelWorktreeStreamDefinition = {
  id: ParallelWorktreeStreamId;
  title: string;
  issues: string[];
  writeScopes: string[];
  protectedFiles: string[];
  dependsOn: ParallelWorktreeStreamId[];
};

export type ParallelWorktreePlanOptions = {
  repoRoot: string;
  worktreeRoot?: string;
  repoName?: string;
  baseBranch?: string;
  branchPrefix?: string;
  includeSpine?: boolean;
};

export type ParallelWorktreeEntry = ParallelWorktreeStreamDefinition & {
  branch: string;
  path: string;
};

export type ParallelWorktreePlan = {
  repoRoot: string;
  repoName: string;
  worktreeRoot: string;
  baseBranch: string;
  branchPrefix: string;
  includeSpine: boolean;
  streams: ParallelWorktreeEntry[];
};

export type ParsedParallelWorktreeArgs = {
  worktreeRoot?: string;
  baseBranch?: string;
  branchPrefix?: string;
  includeSpine: boolean;
  printOnly: boolean;
  json: boolean;
};

export type ParsedParallelWorktreeCleanupArgs = ParsedParallelWorktreeArgs & {
  keepBranches: boolean;
};

export type ParallelWorktreeProtectionViolationReason =
  | "shared-spine-only"
  | "owned-by-other-stream"
  | "protected-requires-owned-stream";

export type ParallelWorktreeProtectionViolation = {
  file: string;
  ownerStreamIds: ParallelWorktreeStreamId[];
  reason: ParallelWorktreeProtectionViolationReason;
};

export type ParallelWorktreeProtectionEvaluation = {
  ok: boolean;
  branchName: string;
  branchStreamId?: ParallelWorktreeStreamId;
  baseBranch: string;
  changedFiles: string[];
  protectedFiles: string[];
  violations: ParallelWorktreeProtectionViolation[];
};

const DEFAULT_BRANCH_PREFIX = "feat/parallel";
const DEFAULT_BASE_BRANCH = "main";

const STREAM_DEFINITIONS: ParallelWorktreeStreamDefinition[] = [
  {
    id: "spine",
    title: "Shared spine and interface freeze",
    issues: [],
    writeScopes: [
      "shared contracts and exports",
      "integration points between streams",
      "final merge conflict resolution"
    ],
    protectedFiles: [
      "packages/contracts/src/index.ts",
      "packages/repository/src/index.ts",
      "apps/web/components/dashboard.tsx",
      "apps/web/app/globals.css",
      ".github/workflows/ci.yml"
    ],
    dependsOn: []
  },
  {
    id: "secops",
    title: "Security, compliance, and abuse controls",
    issues: ["LEO-87", "LEO-88", "LEO-89"],
    writeScopes: [
      "public and high-cost route protection",
      "security evidence automation",
      "incident and vulnerability operations"
    ],
    protectedFiles: [
      "apps/web/lib/abuse-rate-limit.ts",
      "scripts/collect-compliance-evidence.ts",
      "scripts/runtime-vulnerability-gate.ts"
    ],
    dependsOn: ["spine"]
  },
  {
    id: "connectors",
    title: "Connector readiness and certification",
    issues: ["LEO-72"],
    writeScopes: [
      "provider adapter hardening",
      "connector readiness and permission scope reporting",
      "failure semantics for external integrations"
    ],
    protectedFiles: [
      "packages/integrations/src/index.ts",
      "apps/web/lib/google-provider-adapters.ts",
      "apps/web/app/api/integrations/route.ts"
    ],
    dependsOn: ["spine"]
  },
  {
    id: "governance",
    title: "Governance and policy simulation",
    issues: ["LEO-76"],
    writeScopes: [
      "policy simulation and environment conformance",
      "governance API surfaces",
      "audit export explainability"
    ],
    protectedFiles: [
      "packages/policy/src/index.ts",
      "apps/web/app/api/governance/route.ts",
      "apps/web/app/api/governance/audit/route.ts"
    ],
    dependsOn: ["spine"]
  },
  {
    id: "intelligence",
    title: "Decision intelligence and self-improvement",
    issues: ["LEO-78", "LEO-81"],
    writeScopes: [
      "recommendation traces and outcome learning",
      "memory capture feedback loops",
      "next-best-action intelligence"
    ],
    protectedFiles: [
      "packages/orchestrator/src/memory-capture.ts",
      "packages/self-improvement-memory/src/index.ts"
    ],
    dependsOn: ["spine", "connectors", "governance"]
  }
];

function assertSafeSegment(value: string, label: string) {
  if (!value.trim()) {
    throw new Error(`${label} must not be empty.`);
  }

  if (value.includes("\u0000")) {
    throw new Error(`${label} must not contain null bytes.`);
  }

  if (/\s/.test(value)) {
    throw new Error(`${label} must not contain whitespace.`);
  }
}

function assertSafeBranchName(value: string, label: string) {
  assertSafeSegment(value, label);

  if (!/^[A-Za-z0-9._/-]+$/.test(value)) {
    throw new Error(`${label} must use only letters, numbers, '.', '_', '-', or '/'.`);
  }

  if (
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.startsWith("-") ||
    value.includes("..") ||
    value.includes("//") ||
    value.includes("@{")
  ) {
    throw new Error(`${label} is not a safe git branch segment.`);
  }
}

function resolveRoot(input: string | undefined, repoRoot: string) {
  if (!input) {
    return path.dirname(repoRoot);
  }

  return path.resolve(repoRoot, input);
}

function normalizeRepoRelativePath(relativePath: string) {
  const normalized = relativePath.replaceAll("\\", "/").trim();
  const stripped = normalized.replace(/^\.\/+/u, "");
  const posixPath = path.posix.normalize(stripped);

  if (!posixPath || posixPath === ".") {
    throw new Error("relativePath must not be empty.");
  }

  return posixPath;
}

export function getParallelWorktreeDefinitions(options?: { includeSpine?: boolean }) {
  const includeSpine = options?.includeSpine ?? true;
  return STREAM_DEFINITIONS.filter((definition) => includeSpine || definition.id !== "spine");
}

export function getParallelWorktreeDefinition(
  streamId: ParallelWorktreeStreamId,
  options?: { includeSpine?: boolean }
) {
  return getParallelWorktreeDefinitions(options).find(definition => definition.id === streamId);
}

export function resolveParallelWorktreeStreamFromBranch(
  branchName: string,
  options?: { includeSpine?: boolean; branchPrefix?: string }
): ParallelWorktreeStreamId | undefined {
  const trimmedBranchName = branchName.trim();
  const branchPrefix = options?.branchPrefix?.trim() || DEFAULT_BRANCH_PREFIX;
  const definitions = getParallelWorktreeDefinitions({ includeSpine: options?.includeSpine ?? true });

  for (const definition of definitions) {
    if (trimmedBranchName === `${branchPrefix}-${definition.id}`) {
      return definition.id;
    }
  }

  return undefined;
}

export function getProtectedFileOwners(
  relativePath: string,
  options?: { includeSpine?: boolean }
): ParallelWorktreeStreamId[] {
  const normalizedPath = normalizeRepoRelativePath(relativePath);
  return getParallelWorktreeDefinitions({ includeSpine: options?.includeSpine ?? true })
    .filter(definition => definition.protectedFiles.some(candidate => normalizeRepoRelativePath(candidate) === normalizedPath))
    .map(definition => definition.id);
}

export function evaluateParallelWorktreeProtection(options: {
  branchName: string;
  changedFiles: string[];
  baseBranch?: string;
  branchPrefix?: string;
  includeSpine?: boolean;
}): ParallelWorktreeProtectionEvaluation {
  const baseBranch = options.baseBranch?.trim() || DEFAULT_BASE_BRANCH;
  const branchPrefix = options.branchPrefix?.trim() || DEFAULT_BRANCH_PREFIX;
  const branchName = options.branchName.trim();
  const branchStreamId = resolveParallelWorktreeStreamFromBranch(branchName, {
    includeSpine: options.includeSpine ?? true,
    branchPrefix
  });
  const changedFiles = Array.from(new Set(options.changedFiles.map(normalizeRepoRelativePath)));
  const protectedFiles = changedFiles.filter(relativePath => getProtectedFileOwners(relativePath).length > 0);
  const violations: ParallelWorktreeProtectionViolation[] = [];

  if (branchName !== baseBranch) {
    for (const relativePath of protectedFiles) {
      const ownerStreamIds = getProtectedFileOwners(relativePath);

      if (!branchStreamId) {
        violations.push({
          file: relativePath,
          ownerStreamIds,
          reason: "protected-requires-owned-stream"
        });
        continue;
      }

      if (ownerStreamIds.includes("spine") && branchStreamId !== "spine") {
        violations.push({
          file: relativePath,
          ownerStreamIds,
          reason: "shared-spine-only"
        });
        continue;
      }

      if (!ownerStreamIds.includes(branchStreamId)) {
        violations.push({
          file: relativePath,
          ownerStreamIds,
          reason: "owned-by-other-stream"
        });
      }
    }
  }

  return {
    ok: violations.length === 0,
    branchName,
    branchStreamId,
    baseBranch,
    changedFiles,
    protectedFiles,
    violations
  };
}

export function buildParallelWorktreePlan(options: ParallelWorktreePlanOptions): ParallelWorktreePlan {
  const repoRoot = path.resolve(options.repoRoot);
  const repoName = options.repoName?.trim() || path.basename(repoRoot);
  const worktreeRoot = resolveRoot(options.worktreeRoot, repoRoot);
  const baseBranch = options.baseBranch?.trim() || DEFAULT_BASE_BRANCH;
  const branchPrefix = options.branchPrefix?.trim() || DEFAULT_BRANCH_PREFIX;
  const includeSpine = options.includeSpine ?? true;

  assertSafeSegment(repoName, "repoName");
  assertSafeBranchName(baseBranch, "baseBranch");
  assertSafeBranchName(branchPrefix, "branchPrefix");

  const streams = getParallelWorktreeDefinitions({ includeSpine }).map((definition) => ({
    ...definition,
    branch: `${branchPrefix}-${definition.id}`,
    path: path.join(worktreeRoot, `${repoName}-${definition.id}`)
  }));

  return {
    repoRoot,
    repoName,
    worktreeRoot,
    baseBranch,
    branchPrefix,
    includeSpine,
    streams
  };
}

export function parseParallelWorktreeArgs(argv: string[], options: { cwd: string }): ParsedParallelWorktreeArgs {
  const parsed: ParsedParallelWorktreeArgs = {
    includeSpine: true,
    printOnly: false,
    json: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    switch (argument) {
      case "--root": {
        const next = argv[index + 1];
        if (!next) {
          throw new Error("--root requires a value.");
        }

        parsed.worktreeRoot = path.resolve(options.cwd, next);
        index += 1;
        break;
      }
      case "--base-branch": {
        const next = argv[index + 1];
        if (!next) {
          throw new Error("--base-branch requires a value.");
        }

        parsed.baseBranch = next;
        index += 1;
        break;
      }
      case "--branch-prefix": {
        const next = argv[index + 1];
        if (!next) {
          throw new Error("--branch-prefix requires a value.");
        }

        parsed.branchPrefix = next;
        index += 1;
        break;
      }
      case "--no-spine":
        parsed.includeSpine = false;
        break;
      case "--print-only":
        parsed.printOnly = true;
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return parsed;
}

export function parseParallelWorktreeCleanupArgs(
  argv: string[],
  options: { cwd: string }
): ParsedParallelWorktreeCleanupArgs {
  const filteredArgv = argv.filter(argument => argument !== "--keep-branches");
  const parsed = parseParallelWorktreeArgs(filteredArgv, options);
  const cleanup: ParsedParallelWorktreeCleanupArgs = {
    ...parsed,
    keepBranches: false
  };

  for (const argument of argv) {
    if (argument === "--keep-branches") {
      cleanup.keepBranches = true;
    }
  }

  return cleanup;
}

export function renderParallelWorktreePlan(plan: ParallelWorktreePlan): string {
  const lines = [
    `Repo root: ${plan.repoRoot}`,
    `Worktree root: ${plan.worktreeRoot}`,
    `Base branch: ${plan.baseBranch}`,
    `Branch prefix: ${plan.branchPrefix}`,
    `Streams: ${plan.streams.length}`,
    ""
  ];

  for (const stream of plan.streams) {
    lines.push(`${stream.id.toUpperCase()} :: ${stream.title}`);
    lines.push(`  path: ${stream.path}`);
    lines.push(`  branch: ${stream.branch}`);
    lines.push(`  issues: ${stream.issues.length > 0 ? stream.issues.join(", ") : "shared"}`);
    lines.push(`  dependsOn: ${stream.dependsOn.length > 0 ? stream.dependsOn.join(", ") : "none"}`);
    lines.push(`  writeScopes: ${stream.writeScopes.join("; ")}`);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export function renderParallelWorktreeStatus(
  plan: ParallelWorktreePlan,
  statuses: Array<{
    id: ParallelWorktreeStreamId;
    exists: boolean;
    branch?: string;
    head?: string;
    dirtyFiles?: number;
  }>
): string {
  const lines = [
    `Repo root: ${plan.repoRoot}`,
    `Base branch: ${plan.baseBranch}`,
    ""
  ];

  for (const stream of plan.streams) {
    const status = statuses.find(candidate => candidate.id === stream.id);
    const dirtySuffix =
      status?.exists && typeof status.dirtyFiles === "number" ? ` dirty=${status.dirtyFiles}` : "";
    const headSuffix = status?.head ? ` head=${status.head}` : "";
    const branch = status?.branch ?? stream.branch;
    lines.push(
      `${stream.id.padEnd(12)} ${status?.exists ? "present" : "missing"} branch=${branch}${headSuffix}${dirtySuffix}`
    );
  }

  return lines.join("\n");
}
