import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export type TextFormatIssueKind = "crlf" | "missing-final-newline" | "trailing-whitespace";

export type TextFormatIssue = {
  path: string;
  line?: number;
  kind: TextFormatIssueKind;
  message: string;
};

export type ReleaseContextIssueKind = "forbidden-path" | "forbidden-extension" | "secret-like-name";

export type ReleaseContextIssue = {
  path: string;
  kind: ReleaseContextIssueKind;
  message: string;
};

export type WorkspaceLintIssue = {
  path: string;
  message: string;
};

export type EvidenceKind = "ci" | "config" | "docs" | "script" | "test";

export type IssueEvidenceReference = {
  kind: EvidenceKind;
  path: string;
  note: string;
};

export type IssueEvidenceEntry = {
  issue: number;
  title: string;
  parent?: number;
  status: "implemented" | "deferred" | "blocked";
  evidence: IssueEvidenceReference[];
  blockers?: string[];
};

export type IssueEvidenceMap = {
  version: number;
  workstream: number;
  generatedFor: string;
  entries: IssueEvidenceEntry[];
};

export type IssueEvidenceMapIssue = {
  issue?: number;
  path: string;
  message: string;
};

export type FirstRunCheck = {
  id: string;
  status: "pass" | "warn" | "fail";
  message: string;
};

export type FirstRunReport = {
  ok: boolean;
  checks: FirstRunCheck[];
};

export type BranchSnapshot = {
  name: string;
  lastCommitAt: string;
  current?: boolean;
  protected?: boolean;
  merged?: boolean;
};

export type PullRequestSnapshot = {
  number: number;
  title: string;
  branch: string;
  updatedAt: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  draft?: boolean;
};

export type WorktreeSnapshot = {
  path: string;
  branch: string;
  head: string;
  dirtyFiles: number;
  exists: boolean;
};

export type RepoHygieneFinding = {
  kind: "stale-branch" | "stale-pr" | "dirty-worktree" | "missing-worktree";
  severity: "info" | "warning" | "blocker";
  subject: string;
  message: string;
};

export type RepoHygieneReport = {
  ok: boolean;
  generatedAt: string;
  maxAgeDays: number;
  findings: RepoHygieneFinding[];
};

const DEFAULT_RELEASE_FORBIDDEN_PREFIXES = [
  ".agentic/",
  ".next/",
  "apps/web/.next/",
  "apps/web/out/",
  "artifacts/",
  "coverage/",
  "dist/",
  "node_modules/",
  "playwright-report/",
  "test-results/"
];

const DEFAULT_RELEASE_FORBIDDEN_EXACT = new Set([
  ".DS_Store",
  ".env",
  ".env.local",
  "docs-preview.md"
]);

const DEFAULT_RELEASE_FORBIDDEN_EXTENSIONS = [
  ".key",
  ".pem",
  ".p12",
  ".pfx",
  ".tgz",
  ".tar",
  ".log"
];

const DEFAULT_SECRET_NAME_PATTERN = /(^|[/._-])(secret|token|credential|private-key)([/._-]|$)/iu;
const REVIEWED_SECRET_NAME_PATHS = new Set([
  "docs/runbooks/connector-credential-lifecycle.md",
  "packages/integrations/src/provider-credential-secrets.ts",
  "tests/provider-credential-secrets.test.ts"
]);
const TEXT_EXTENSION_PATTERN = /\.(cjs|css|html|js|json|jsx|mjs|md|mdx|sql|ts|tsx|txt|yml|yaml)$/iu;
const ALWAYS_TEXT_FILES = new Set([
  ".dockerignore",
  ".gitignore",
  ".node-version",
  ".nvmrc",
  "Dockerfile",
  "package-lock.json",
  "package.json",
  "tsconfig.base.json",
  "tsconfig.json"
]);
const PROTECTED_RELEASE_EXCEPTIONS = new Set([".env.example", ".env.sample"]);
const REQUIRED_ROOT_SCRIPTS = [
  "lint",
  "typecheck",
  "format:check",
  "release:check-context",
  "setup:check",
  "docs:validate",
  "ci:validate-provenance",
  "remediation:verify",
  "build"
];

export function normalizeRepoPath(value: string) {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\/+/u, "").trim();
  return path.posix.normalize(normalized);
}

export function isTextLikePath(relativePath: string) {
  const normalized = normalizeRepoPath(relativePath);
  return ALWAYS_TEXT_FILES.has(normalized) || TEXT_EXTENSION_PATTERN.test(normalized);
}

export function checkTextFormatting(files: Array<{ path: string; content: string }>) {
  const issues: TextFormatIssue[] = [];

  for (const file of files) {
    const relativePath = normalizeRepoPath(file.path);

    if (file.content.includes("\r\n")) {
      issues.push({
        path: relativePath,
        kind: "crlf",
        message: "File must use LF line endings."
      });
    }

    if (file.content.length > 0 && !file.content.endsWith("\n")) {
      issues.push({
        path: relativePath,
        kind: "missing-final-newline",
        message: "File must end with a newline."
      });
    }

    const lines = file.content.split(/\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (/[ \t]$/u.test(line.replace(/\r$/u, ""))) {
        issues.push({
          path: relativePath,
          line: index + 1,
          kind: "trailing-whitespace",
          message: "Line must not end with trailing whitespace."
        });
      }
    }
  }

  return issues;
}

export function checkReleaseContext(paths: string[]) {
  const issues: ReleaseContextIssue[] = [];

  for (const rawPath of paths) {
    const relativePath = normalizeRepoPath(rawPath);
    const lowerPath = relativePath.toLowerCase();

    if (PROTECTED_RELEASE_EXCEPTIONS.has(relativePath)) {
      continue;
    }

    if (
      DEFAULT_RELEASE_FORBIDDEN_EXACT.has(relativePath) ||
      DEFAULT_RELEASE_FORBIDDEN_PREFIXES.some(prefix => lowerPath.startsWith(prefix.toLowerCase()))
    ) {
      issues.push({
        path: relativePath,
        kind: "forbidden-path",
        message: "Local, generated, or environment-specific path must not be part of release context."
      });
      continue;
    }

    if (DEFAULT_RELEASE_FORBIDDEN_EXTENSIONS.some(extension => lowerPath.endsWith(extension))) {
      issues.push({
        path: relativePath,
        kind: "forbidden-extension",
        message: "Release context must not include packaged artifacts, logs, or key material."
      });
      continue;
    }

    if (DEFAULT_SECRET_NAME_PATTERN.test(relativePath) && !REVIEWED_SECRET_NAME_PATHS.has(relativePath)) {
      issues.push({
        path: relativePath,
        kind: "secret-like-name",
        message: "Secret-like filenames require explicit review before they can be release evidence."
      });
    }
  }

  return issues;
}

export function validateIssueEvidenceMap(map: IssueEvidenceMap, options: { cwd: string }) {
  const issues: IssueEvidenceMapIssue[] = [];
  const seenIssues = new Set<number>();

  if (map.version !== 1) {
    issues.push({
      path: "config/engineering-hygiene/w10-evidence-map.json",
      message: "Issue evidence map version must be 1."
    });
  }

  if (map.workstream !== 199) {
    issues.push({
      path: "config/engineering-hygiene/w10-evidence-map.json",
      message: "W10 evidence map must stay attached to issue #199."
    });
  }

  for (const entry of map.entries) {
    if (seenIssues.has(entry.issue)) {
      issues.push({
        issue: entry.issue,
        path: "config/engineering-hygiene/w10-evidence-map.json",
        message: `Issue #${entry.issue} appears more than once.`
      });
    }
    seenIssues.add(entry.issue);

    if (entry.issue !== 199 && entry.parent !== 199) {
      issues.push({
        issue: entry.issue,
        path: "config/engineering-hygiene/w10-evidence-map.json",
        message: `Issue #${entry.issue} must link back to parent #199.`
      });
    }

    if (entry.status === "blocked" && (entry.blockers ?? []).length === 0) {
      issues.push({
        issue: entry.issue,
        path: "config/engineering-hygiene/w10-evidence-map.json",
        message: `Issue #${entry.issue} is blocked but has no blocker note.`
      });
    }

    if (entry.evidence.length === 0) {
      issues.push({
        issue: entry.issue,
        path: "config/engineering-hygiene/w10-evidence-map.json",
        message: `Issue #${entry.issue} must include at least one evidence reference.`
      });
    }

    for (const evidence of entry.evidence) {
      const evidencePath = normalizeRepoPath(evidence.path);
      if (!existsSync(path.join(options.cwd, evidencePath))) {
        issues.push({
          issue: entry.issue,
          path: evidencePath,
          message: `Issue #${entry.issue} references missing evidence path ${evidencePath}.`
        });
      }
    }
  }

  for (const requiredIssue of [199, 245, 246, 247, 248, 249]) {
    if (!seenIssues.has(requiredIssue)) {
      issues.push({
        issue: requiredIssue,
        path: "config/engineering-hygiene/w10-evidence-map.json",
        message: `Issue #${requiredIssue} is missing from the evidence map.`
      });
    }
  }

  return issues;
}

export function lintWorkspaceContracts(options: {
  cwd: string;
  packageJson: { scripts?: Record<string, string> };
  ciWorkflow: string;
  evidenceMap: IssueEvidenceMap;
}) {
  const issues: WorkspaceLintIssue[] = [];
  const scripts = options.packageJson.scripts ?? {};

  for (const scriptName of REQUIRED_ROOT_SCRIPTS) {
    if (!scripts[scriptName]) {
      issues.push({
        path: "package.json",
        message: `Missing required root script '${scriptName}'.`
      });
    }
  }

  for (const command of [
    "npm run lint",
    "npm run typecheck",
    "npm run format:check",
    "npm run release:check-context",
    "npm run docs:validate"
  ]) {
    if (!options.ciWorkflow.includes(command)) {
      issues.push({
        path: ".github/workflows/ci.yml",
        message: `CI workflow must run '${command}'.`
      });
    }
  }

  for (const issue of validateIssueEvidenceMap(options.evidenceMap, { cwd: options.cwd })) {
    issues.push({
      path: issue.path,
      message: issue.message
    });
  }

  return issues;
}

export function evaluateFirstRunReadiness(options: {
  cwd: string;
  nodeVersion: string;
  npmUserAgent?: string;
  env: NodeJS.ProcessEnv;
}) {
  const checks: FirstRunCheck[] = [];
  const majorVersion = Number.parseInt(options.nodeVersion.replace(/^v/u, "").split(".")[0] ?? "", 10);

  checks.push(
    Number.isInteger(majorVersion) && majorVersion >= 20 && majorVersion < 26
      ? {
          id: "node-version",
          status: "pass",
          message: `Node ${options.nodeVersion} satisfies the repo engine range >=20 <26.`
        }
      : {
          id: "node-version",
          status: "fail",
          message: `Node ${options.nodeVersion} does not satisfy the repo engine range >=20 <26.`
        }
  );

  for (const requiredPath of ["package-lock.json", "package.json", "docs/specs/api-route-inventory.md"]) {
    checks.push(
      existsSync(path.join(options.cwd, requiredPath))
        ? {
            id: `path:${requiredPath}`,
            status: "pass",
            message: `${requiredPath} is present.`
          }
        : {
            id: `path:${requiredPath}`,
            status: "fail",
            message: `${requiredPath} is missing from the checkout.`
          }
    );
  }

  checks.push(
    existsSync(path.join(options.cwd, "node_modules"))
      ? {
          id: "dependencies",
          status: "pass",
          message: "node_modules is present."
        }
      : {
          id: "dependencies",
          status: "warn",
          message: "node_modules is missing; run npm install or npm ci before local validation."
        }
  );

  if (options.env.AGENTIC_ACCESS_KEY?.trim()) {
    checks.push({
      id: "access-key",
      status: "pass",
      message: "AGENTIC_ACCESS_KEY is set for dashboard/API authentication."
    });
  } else if (options.env.AGENTIC_ENABLE_LOCAL_DEV_KEY?.trim().toLowerCase() === "true") {
    checks.push({
      id: "access-key",
      status: "warn",
      message: "AGENTIC_ENABLE_LOCAL_DEV_KEY enables the disposable local fallback key; set AGENTIC_ACCESS_KEY before sharing the runtime."
    });
  } else {
    checks.push({
      id: "access-key",
      status: "warn",
      message: "AGENTIC_ACCESS_KEY is not set; set it or explicitly opt in to AGENTIC_ENABLE_LOCAL_DEV_KEY for disposable local-only use."
    });
  }

  if (options.env.DATABASE_URL?.trim()) {
    checks.push({
      id: "database-url",
      status: "pass",
      message: "DATABASE_URL is set; run npm run db:migrate and npm run db:status -- --require-ready for Postgres parity."
    });
  } else {
    checks.push({
      id: "database-url",
      status: "warn",
      message: "DATABASE_URL is not set; this checkout will use the file-backed development store."
    });
  }

  return {
    ok: checks.every(check => check.status !== "fail"),
    checks
  } satisfies FirstRunReport;
}

export function evaluateRepoHygieneSnapshot(options: {
  branches: BranchSnapshot[];
  pullRequests: PullRequestSnapshot[];
  worktrees: WorktreeSnapshot[];
  now: Date;
  maxAgeDays: number;
}) {
  const staleBefore = options.now.getTime() - options.maxAgeDays * 24 * 60 * 60 * 1000;
  const findings: RepoHygieneFinding[] = [];

  for (const branch of options.branches) {
    const lastCommitAt = Date.parse(branch.lastCommitAt);
    if (
      Number.isFinite(lastCommitAt) &&
      lastCommitAt < staleBefore &&
      !branch.current &&
      !branch.protected &&
      !branch.merged
    ) {
      findings.push({
        kind: "stale-branch",
        severity: "warning",
        subject: branch.name,
        message: `${branch.name} has not moved since ${branch.lastCommitAt}; rebase, close, or document the owner.`
      });
    }
  }

  for (const pullRequest of options.pullRequests) {
    const updatedAt = Date.parse(pullRequest.updatedAt);
    if (pullRequest.state === "OPEN" && Number.isFinite(updatedAt) && updatedAt < staleBefore) {
      findings.push({
        kind: "stale-pr",
        severity: "warning",
        subject: `#${pullRequest.number}`,
        message: `PR #${pullRequest.number} (${pullRequest.branch}) has not updated since ${pullRequest.updatedAt}.`
      });
    }
  }

  for (const worktree of options.worktrees) {
    if (!worktree.exists) {
      findings.push({
        kind: "missing-worktree",
        severity: "info",
        subject: worktree.path,
        message: `Planned worktree ${worktree.path} is missing.`
      });
      continue;
    }

    if (worktree.dirtyFiles > 0) {
      findings.push({
        kind: "dirty-worktree",
        severity: "blocker",
        subject: worktree.path,
        message: `${worktree.path} has ${worktree.dirtyFiles} dirty file(s); do not clean or merge it blindly.`
      });
    }
  }

  return {
    ok: findings.every(finding => finding.severity !== "blocker"),
    generatedAt: options.now.toISOString(),
    maxAgeDays: options.maxAgeDays,
    findings
  } satisfies RepoHygieneReport;
}

export function readTrackedTextFiles(cwd: string, relativePaths: string[]) {
  return relativePaths
    .map(normalizeRepoPath)
    .filter(relativePath => isTextLikePath(relativePath))
    .filter(relativePath => {
      const absolutePath = path.join(cwd, relativePath);
      return existsSync(absolutePath) && statSync(absolutePath).isFile();
    })
    .map(relativePath => ({
      path: relativePath,
      content: readFileSync(path.join(cwd, relativePath), "utf8")
    }));
}
