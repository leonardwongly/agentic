import { readFileSync } from "node:fs";
import path from "node:path";

export type IssueThemeId =
  | "production-runtime"
  | "execution-spine"
  | "connector-readiness"
  | "governance-trust"
  | "operator-shell"
  | "intelligence-fabric"
  | "security-privacy"
  | "observability-performance"
  | "engineering-hygiene";

export type ValidationGateId =
  | "provenance"
  | "compliance-registry"
  | "security-regression"
  | "architecture-fitness"
  | "parallel-worktree-fitness"
  | "performance-fitness"
  | "capability-smoke"
  | "observability-smoke"
  | "docs-build"
  | "full-vitest"
  | "build";

export type IssueThemeDefinition = {
  id: IssueThemeId;
  title: string;
  labels: string[];
  titleKeywords: string[];
  pathPrefixes: string[];
  gateIds: ValidationGateId[];
  ciShard: string;
  risk: "critical" | "high" | "medium";
};

export type ValidationGateDefinition = {
  id: ValidationGateId;
  command: string;
  reason: string;
};

export type IssueThemeGateSelection = {
  explicitThemes?: string[];
  labels?: string[];
  titles?: string[];
  changedFiles?: string[];
};

export type IssueThemeGatePlan = {
  themes: IssueThemeDefinition[];
  gates: ValidationGateDefinition[];
  commands: string[];
  ciShards: string[];
  fallback: boolean;
};

export const VALIDATION_GATES: ValidationGateDefinition[] = [
  {
    id: "provenance",
    command: "npm run ci:validate-provenance",
    reason: "Keep GitHub Actions pinned and reviewable before trusting CI results."
  },
  {
    id: "compliance-registry",
    command: "npm run compliance:validate-registry",
    reason: "Ensure compliance evidence references still resolve after docs or route changes."
  },
  {
    id: "security-regression",
    command: "npm run test:security:regression",
    reason: "Exercise abuse, auth, and high-risk API boundary regressions."
  },
  {
    id: "architecture-fitness",
    command: "npm run test:architecture:fitness",
    reason: "Verify architectural invariants and route/runtime contract boundaries."
  },
  {
    id: "parallel-worktree-fitness",
    command: "npm run test:parallel-worktree:fitness",
    reason: "Guard shared files from unowned parallel workstream edits."
  },
  {
    id: "performance-fitness",
    command: "npm run test:performance:fitness",
    reason: "Catch unbounded collection, request-path, and worker-runtime regressions."
  },
  {
    id: "capability-smoke",
    command: "npm run test:smoke:capabilities",
    reason: "Confirm capability and route inventory contracts remain aligned."
  },
  {
    id: "observability-smoke",
    command: "npm run test:smoke:observability",
    reason: "Validate async execution telemetry and operational signal paths."
  },
  {
    id: "docs-build",
    command: "npm run docs:build",
    reason: "Keep generated operator docs and doc validation current."
  },
  {
    id: "full-vitest",
    command: "npm test",
    reason: "Run the full unit and integration suite for cross-cutting changes."
  },
  {
    id: "build",
    command: "npm run build",
    reason: "Verify the web and worker packages compile together."
  }
];

export const ISSUE_THEME_TAXONOMY: IssueThemeDefinition[] = [
  {
    id: "production-runtime",
    title: "Production proof and runtime closeout",
    labels: ["priority-critical", "aos-remediation"],
    titleKeywords: ["production", "runtime", "postgres", "shared-auth", "ingress", "closeout"],
    pathPrefixes: ["deploy/", "Dockerfile", ".dockerignore", "scripts/staging", "docs/runbooks/deployment.md"],
    gateIds: [
      "provenance",
      "compliance-registry",
      "architecture-fitness",
      "performance-fitness",
      "capability-smoke",
      "build"
    ],
    ciShard: "runtime",
    risk: "critical"
  },
  {
    id: "execution-spine",
    title: "Durable execution, worker runtime, and side effects",
    labels: ["aos-execution-spine"],
    titleKeywords: ["worker", "workflow", "durable", "idempotency", "outbox", "replay", "side effect", "scheduler"],
    pathPrefixes: [
      "apps/worker/",
      "packages/worker-runtime/",
      "packages/execution/",
      "packages/agents/",
      "scripts/start-worker.ts",
      "tests/worker-runtime.test.ts",
      "tests/workflow-dag.test.ts"
    ],
    gateIds: [
      "provenance",
      "security-regression",
      "architecture-fitness",
      "performance-fitness",
      "observability-smoke",
      "full-vitest",
      "build"
    ],
    ciShard: "execution",
    risk: "high"
  },
  {
    id: "connector-readiness",
    title: "Connector setup, readiness, and recovery",
    labels: ["aos-execution-spine", "aos-trust-spine"],
    titleKeywords: ["connector", "credential", "gmail", "calendar", "provider", "webhook", "readiness"],
    pathPrefixes: [
      "packages/integrations/",
      "apps/web/lib/google-provider-adapters.ts",
      "apps/web/app/api/integrations/",
      "tests/google-provider",
      "tests/connector"
    ],
    gateIds: ["provenance", "security-regression", "architecture-fitness", "capability-smoke", "full-vitest"],
    ciShard: "connectors",
    risk: "high"
  },
  {
    id: "governance-trust",
    title: "Governance, autonomy, approvals, and policy calibration",
    labels: ["aos-trust-spine"],
    titleKeywords: ["governance", "approval", "policy", "autonomy", "calibration", "tenant", "identity"],
    pathPrefixes: [
      "packages/policy/",
      "apps/web/app/api/governance/",
      "apps/web/app/api/approvals/",
      "tests/policy.test.ts",
      "tests/governance"
    ],
    gateIds: [
      "provenance",
      "compliance-registry",
      "security-regression",
      "architecture-fitness",
      "parallel-worktree-fitness",
      "full-vitest"
    ],
    ciShard: "governance",
    risk: "high"
  },
  {
    id: "operator-shell",
    title: "Operator cockpit, dashboard, onboarding, and tracker scale",
    labels: ["aos-shell"],
    titleKeywords: ["dashboard", "cockpit", "operator", "tracker", "onboarding", "issue-theme", "bounded collection"],
    pathPrefixes: [
      "apps/web/components/",
      "apps/web/app/api/dashboard/",
      "apps/web/lib/dashboard",
      "scripts/aos-remediation-dashboard.ts",
      "tests/dashboard",
      "docs/runbooks/parallel-worktrees.md"
    ],
    gateIds: [
      "provenance",
      "architecture-fitness",
      "parallel-worktree-fitness",
      "performance-fitness",
      "capability-smoke",
      "full-vitest",
      "build"
    ],
    ciShard: "shell",
    risk: "medium"
  },
  {
    id: "intelligence-fabric",
    title: "Learning, memory, provenance, and recommendations",
    labels: ["aos-intelligence-fabric"],
    titleKeywords: ["memory", "provenance", "recommendation", "learning", "episode", "feedback"],
    pathPrefixes: [
      "packages/memory/",
      "packages/self-improvement-memory/",
      "packages/orchestrator/",
      "apps/web/app/api/memory/",
      "apps/web/app/api/recommendations/",
      "tests/memory",
      "tests/recommendations"
    ],
    gateIds: ["provenance", "security-regression", "architecture-fitness", "performance-fitness", "full-vitest"],
    ciShard: "intelligence",
    risk: "high"
  },
  {
    id: "security-privacy",
    title: "Security, privacy, compliance, and abuse hardening",
    labels: ["aos-trust-spine", "security"],
    titleKeywords: ["security", "privacy", "secret", "redaction", "abuse", "csrf", "xss", "compliance"],
    pathPrefixes: [
      "apps/web/lib/abuse-rate-limit.ts",
      "apps/web/lib/security",
      "scripts/security-regression-suite.ts",
      "scripts/runtime-vulnerability-gate.ts",
      "scripts/collect-compliance-evidence.ts",
      "docs/security/",
      "tests/security",
      "tests/api-security"
    ],
    gateIds: [
      "provenance",
      "compliance-registry",
      "security-regression",
      "architecture-fitness",
      "parallel-worktree-fitness",
      "full-vitest"
    ],
    ciShard: "security",
    risk: "critical"
  },
  {
    id: "observability-performance",
    title: "Observability, deployment confidence, and performance",
    labels: ["aos-intelligence-fabric"],
    titleKeywords: ["observability", "telemetry", "trace", "performance", "load", "canary", "smoke"],
    pathPrefixes: [
      "packages/observability/",
      "scripts/observability",
      "scripts/deployment-smoke.ts",
      "scripts/deployment-async-canary.ts",
      "tests/observability",
      "tests/performance-fitness.test.ts"
    ],
    gateIds: ["provenance", "architecture-fitness", "performance-fitness", "observability-smoke", "build"],
    ciShard: "observability",
    risk: "medium"
  },
  {
    id: "engineering-hygiene",
    title: "Engineering hygiene, docs, CI, and tracker discipline",
    labels: ["documentation"],
    titleKeywords: ["docs", "runbook", "ci", "quality gate", "evidence", "stale", "taxonomy", "sharding"],
    pathPrefixes: [".github/", "docs/", "scripts/", "tests/validate", "tests/parallel-worktrees.test.ts", "package.json"],
    gateIds: [
      "provenance",
      "compliance-registry",
      "architecture-fitness",
      "parallel-worktree-fitness",
      "docs-build",
      "build"
    ],
    ciShard: "hygiene",
    risk: "medium"
  }
];

const THEME_BY_ID = new Map(ISSUE_THEME_TAXONOMY.map(theme => [theme.id, theme]));
const GATE_BY_ID = new Map(VALIDATION_GATES.map(gate => [gate.id, gate]));

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeChangedFile(input: string): string {
  const trimmed = input.trim().replaceAll("\\", "/");
  if (!trimmed) {
    throw new Error("changed file path must not be empty.");
  }

  if (trimmed.includes("\u0000")) {
    throw new Error("changed file path must not contain null bytes.");
  }

  if (path.posix.isAbsolute(trimmed)) {
    throw new Error(`changed file path must be repo-relative: ${input}`);
  }

  const normalized = path.posix.normalize(trimmed.replace(/^\.\/+/u, ""));
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`changed file path must stay inside the repository: ${input}`);
  }

  return normalized;
}

function themeMatchesChangedFile(theme: IssueThemeDefinition, changedFile: string): boolean {
  return theme.pathPrefixes.some(prefix => {
    const normalizedPrefix = normalizeChangedFile(prefix);
    return changedFile === normalizedPrefix || changedFile.startsWith(`${normalizedPrefix.replace(/\/$/u, "")}/`);
  });
}

function addTheme(themeIds: Set<IssueThemeId>, id: IssueThemeId) {
  if (!THEME_BY_ID.has(id)) {
    throw new Error(`Unknown issue theme: ${id}`);
  }
  themeIds.add(id);
}

export function resolveIssueThemes(selection: IssueThemeGateSelection): IssueThemeDefinition[] {
  const themeIds = new Set<IssueThemeId>();

  for (const explicitTheme of selection.explicitThemes ?? []) {
    const normalized = normalizeToken(explicitTheme) as IssueThemeId;
    addTheme(themeIds, normalized);
  }

  const normalizedLabels = (selection.labels ?? []).map(normalizeToken);
  for (const theme of ISSUE_THEME_TAXONOMY) {
    if (theme.labels.some(label => normalizedLabels.includes(normalizeToken(label)))) {
      addTheme(themeIds, theme.id);
    }
  }

  const normalizedTitles = (selection.titles ?? []).map(normalizeToken);
  for (const title of normalizedTitles) {
    for (const theme of ISSUE_THEME_TAXONOMY) {
      if (theme.titleKeywords.some(keyword => title.includes(normalizeToken(keyword)))) {
        addTheme(themeIds, theme.id);
      }
    }
  }

  for (const changedFile of selection.changedFiles ?? []) {
    const normalizedFile = normalizeChangedFile(changedFile);
    for (const theme of ISSUE_THEME_TAXONOMY) {
      if (themeMatchesChangedFile(theme, normalizedFile)) {
        addTheme(themeIds, theme.id);
      }
    }
  }

  return ISSUE_THEME_TAXONOMY.filter(theme => themeIds.has(theme.id));
}

export function buildIssueThemeGatePlan(selection: IssueThemeGateSelection): IssueThemeGatePlan {
  let themes = resolveIssueThemes(selection);
  const hasSelectionInput =
    (selection.explicitThemes?.length ?? 0) > 0 ||
    (selection.labels?.length ?? 0) > 0 ||
    (selection.titles?.length ?? 0) > 0 ||
    (selection.changedFiles?.length ?? 0) > 0;
  const fallback = hasSelectionInput && themes.length === 0;

  if (fallback) {
    themes = [...ISSUE_THEME_TAXONOMY];
  }

  const gateIds = new Set<ValidationGateId>();

  for (const theme of themes) {
    for (const gateId of theme.gateIds) {
      gateIds.add(gateId);
    }
  }

  const gates = VALIDATION_GATES.filter(gate => gateIds.has(gate.id));

  return {
    themes,
    gates,
    commands: gates.map(gate => gate.command),
    ciShards: Array.from(new Set(themes.map(theme => theme.ciShard))).sort(),
    fallback
  };
}

export function getPackageScriptName(command: string): string | undefined {
  const match = /^npm run ([\w:.-]+)(?:\s|$)/u.exec(command.trim());
  return match?.[1];
}

export function validateIssueThemeTaxonomy(options: { packageJsonPath?: string } = {}): string[] {
  const errors: string[] = [];
  const themeIds = new Set<IssueThemeId>();
  const shardIds = new Set<string>();
  const gateIds = new Set<ValidationGateId>();

  for (const gate of VALIDATION_GATES) {
    if (gateIds.has(gate.id)) {
      errors.push(`Duplicate validation gate id: ${gate.id}`);
    }
    gateIds.add(gate.id);
  }

  for (const theme of ISSUE_THEME_TAXONOMY) {
    if (themeIds.has(theme.id)) {
      errors.push(`Duplicate issue theme id: ${theme.id}`);
    }
    themeIds.add(theme.id);

    if (shardIds.has(theme.ciShard)) {
      errors.push(`Duplicate CI shard id: ${theme.ciShard}`);
    }
    shardIds.add(theme.ciShard);

    if (theme.gateIds.length === 0) {
      errors.push(`${theme.id} must define at least one validation gate.`);
    }

    for (const gateId of theme.gateIds) {
      if (!GATE_BY_ID.has(gateId)) {
        errors.push(`${theme.id} references unknown validation gate ${gateId}.`);
      }
    }
  }

  const packageJsonPath = options.packageJsonPath ?? path.resolve(process.cwd(), "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { scripts?: Record<string, string> };
  const scripts = packageJson.scripts ?? {};

  for (const gate of VALIDATION_GATES) {
    const scriptName = getPackageScriptName(gate.command);
    if (scriptName && !scripts[scriptName]) {
      errors.push(`${gate.id} references missing package script ${scriptName}.`);
    }
  }

  return errors;
}

export function renderIssueThemeGatePlan(plan: IssueThemeGatePlan): string {
  if (plan.themes.length === 0) {
    return [
      "No specific issue theme selected.",
      "Pass --theme, --label, --title, --changed-file, or --from-git to resolve targeted validation gates."
    ].join("\n");
  }

  const lines = [
    `Themes: ${plan.themes.map(theme => theme.id).join(", ")}`,
    `CI shards: ${plan.ciShards.join(", ")}`,
    "Validation gates:"
  ];

  if (plan.fallback) {
    lines.unshift("No exact theme matched; using the conservative all-theme fallback.");
  }

  for (const gate of plan.gates) {
    lines.push(`- ${gate.id}: ${gate.command}`);
  }

  return lines.join("\n");
}
