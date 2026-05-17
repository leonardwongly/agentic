import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  checkReleaseContext,
  checkTextFormatting,
  evaluateFirstRunReadiness,
  evaluateRepoHygieneSnapshot,
  lintWorkspaceContracts,
  validateIssueEvidenceMap,
  type IssueEvidenceMap
} from "../scripts/lib/engineering-hygiene";

function writeFixture(root: string, relativePath: string, contents = "fixture\n") {
  const resolvedPath = path.join(root, relativePath);
  mkdirSync(path.dirname(resolvedPath), { recursive: true });
  writeFileSync(resolvedPath, contents, "utf8");
}

function createEvidenceRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), "agentic-hygiene-"));
  for (const relativePath of [
    ".github/workflows/ci.yml",
    "package-lock.json",
    "package.json",
    "README.md",
    "config/engineering-hygiene/w10-evidence-map.json",
    "docs/runbooks/engineering-hygiene.md",
    "docs/runbooks/parallel-worktrees.md",
    "docs/specs/agentic.md",
    "docs/specs/api-route-inventory.md",
    "scripts/check-first-run.ts",
    "scripts/check-format.ts",
    "scripts/check-release-context.ts",
    "scripts/check-workspace-lint.ts",
    "scripts/lib/engineering-hygiene.ts",
    "scripts/repo-hygiene-report.ts",
    "tests/api-route-inventory.test.ts",
    "tests/engineering-hygiene.test.ts"
  ]) {
    writeFixture(root, relativePath);
  }

  return root;
}

function createEvidenceMap(overrides?: Partial<IssueEvidenceMap>): IssueEvidenceMap {
  return {
    version: 1,
    workstream: 199,
    generatedFor: "test",
    entries: [
      {
        issue: 199,
        title: "workstream",
        status: "implemented",
        evidence: [{ kind: "docs", path: "docs/runbooks/engineering-hygiene.md", note: "runbook" }]
      },
      {
        issue: 245,
        parent: 199,
        title: "quality gates",
        status: "implemented",
        evidence: [{ kind: "script", path: "scripts/check-workspace-lint.ts", note: "lint" }]
      },
      {
        issue: 246,
        parent: 199,
        title: "runtime docs truth",
        status: "implemented",
        evidence: [{ kind: "test", path: "tests/api-route-inventory.test.ts", note: "inventory" }]
      },
      {
        issue: 247,
        parent: 199,
        title: "evidence map",
        status: "implemented",
        evidence: [{ kind: "config", path: "config/engineering-hygiene/w10-evidence-map.json", note: "map" }]
      },
      {
        issue: 248,
        parent: 199,
        title: "repo hygiene",
        status: "implemented",
        evidence: [{ kind: "script", path: "scripts/repo-hygiene-report.ts", note: "report" }]
      },
      {
        issue: 249,
        parent: 199,
        title: "first run",
        status: "implemented",
        evidence: [{ kind: "script", path: "scripts/check-first-run.ts", note: "setup" }]
      }
    ],
    ...overrides
  };
}

describe("engineering hygiene gates", () => {
  it("accepts clean tracked text formatting", () => {
    expect(
      checkTextFormatting([
        {
          path: "README.md",
          content: "# Agentic\n\nClean file.\n"
        }
      ])
    ).toEqual([]);
  });

  it("rejects CRLF, trailing whitespace, and missing final newline", () => {
    const issues = checkTextFormatting([
      {
        path: "docs/runbooks/bad.md",
        content: "# Bad\r\nline with space "
      }
    ]);

    expect(issues.map(issue => issue.kind)).toEqual([
      "crlf",
      "missing-final-newline",
      "trailing-whitespace"
    ]);
  });

  it("rejects local artifacts and secret-like release context", () => {
    const issues = checkReleaseContext([
      "apps/web/app/page.tsx",
      ".env.local",
      "artifacts/security/report.json",
      "tmp/private-key.pem",
      "docs/token-notes.md"
    ]);

    expect(issues).toEqual([
      expect.objectContaining({ path: ".env.local", kind: "forbidden-path" }),
      expect.objectContaining({ path: "artifacts/security/report.json", kind: "forbidden-path" }),
      expect.objectContaining({ path: "tmp/private-key.pem", kind: "forbidden-extension" }),
      expect.objectContaining({ path: "docs/token-notes.md", kind: "secret-like-name" })
    ]);
  });

  it("validates issue-to-evidence maps against concrete evidence paths", () => {
    const root = createEvidenceRoot();
    const issues = validateIssueEvidenceMap(createEvidenceMap(), { cwd: root });

    expect(issues).toEqual([]);
  });

  it("reports missing evidence and blocked entries without blockers", () => {
    const root = createEvidenceRoot();
    const map = createEvidenceMap({
      entries: [
        {
          issue: 199,
          title: "workstream",
          status: "implemented",
          evidence: [{ kind: "docs", path: "docs/missing.md", note: "missing" }]
        },
        {
          issue: 245,
          parent: 199,
          title: "blocked",
          status: "blocked",
          evidence: [{ kind: "script", path: "scripts/check-workspace-lint.ts", note: "lint" }]
        }
      ]
    });

    const issues = validateIssueEvidenceMap(map, { cwd: root });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ issue: 199, path: "docs/missing.md" }),
        expect.objectContaining({ issue: 245, message: expect.stringContaining("blocked") }),
        expect.objectContaining({ issue: 246, message: expect.stringContaining("missing") })
      ])
    );
  });

  it("lints required scripts, CI gate wiring, and evidence references", () => {
    const root = createEvidenceRoot();
    const issues = lintWorkspaceContracts({
      cwd: root,
      packageJson: {
        scripts: {
          build: "next build",
          "ci:validate-provenance": "tsx scripts/validate-github-actions-provenance.ts",
          "docs:validate": "node scripts/validate-docs.mjs",
          "format:check": "tsx scripts/check-format.ts",
          lint: "tsx scripts/check-workspace-lint.ts",
          "release:check-context": "tsx scripts/check-release-context.ts",
          "remediation:verify": "tsx scripts/aos-remediation-dashboard.ts --verify-issue-query",
          "setup:check": "tsx scripts/check-first-run.ts",
          typecheck: "tsc --noEmit"
        }
      },
      ciWorkflow: [
        "npm run lint",
        "npm run typecheck",
        "npm run format:check",
        "npm run release:check-context",
        "npm run docs:validate"
      ].join("\n"),
      evidenceMap: createEvidenceMap()
    });

    expect(issues).toEqual([]);
  });

  it("reports first-run failures for unsupported Node and warnings for local-only setup", () => {
    const root = createEvidenceRoot();
    const report = evaluateFirstRunReadiness({
      cwd: root,
      nodeVersion: "v18.19.0",
      env: {}
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "node-version", status: "fail" }),
        expect.objectContaining({ id: "dependencies", status: "warn" }),
        expect.objectContaining({ id: "access-key", status: "warn" }),
        expect.objectContaining({ id: "database-url", status: "warn" })
      ])
    );
  });

  it("accepts first-run readiness when required local inputs are present", () => {
    const root = createEvidenceRoot();
    mkdirSync(path.join(root, "node_modules"));
    const report = evaluateFirstRunReadiness({
      cwd: root,
      nodeVersion: "v22.11.0",
      env: {
        AGENTIC_ACCESS_KEY: "local-test-key",
        DATABASE_URL: "postgres://localhost/agentic"
      }
    });

    expect(report.ok).toBe(true);
    expect(report.checks.every(check => check.status !== "fail")).toBe(true);
  });

  it("flags stale branches, stale PRs, and dirty worktrees without blocking on stale warnings", () => {
    const report = evaluateRepoHygieneSnapshot({
      now: new Date("2026-05-17T00:00:00.000Z"),
      maxAgeDays: 21,
      branches: [
        {
          name: "main",
          lastCommitAt: "2026-05-16T00:00:00.000Z",
          protected: true
        },
        {
          name: "task/stale",
          lastCommitAt: "2026-04-01T00:00:00.000Z"
        }
      ],
      pullRequests: [
        {
          number: 136,
          title: "stale oss cleanup",
          branch: "task/stale-oss",
          updatedAt: "2026-04-05T00:00:00.000Z",
          state: "OPEN"
        }
      ],
      worktrees: [
        {
          path: "/tmp/agentic-clean",
          branch: "task/clean",
          head: "abc123",
          dirtyFiles: 0,
          exists: true
        }
      ]
    });

    expect(report.ok).toBe(true);
    expect(report.findings).toEqual([
      expect.objectContaining({ kind: "stale-branch", subject: "task/stale" }),
      expect.objectContaining({ kind: "stale-pr", subject: "#136" })
    ]);
  });

  it("treats dirty worktrees as blockers", () => {
    const report = evaluateRepoHygieneSnapshot({
      now: new Date("2026-05-17T00:00:00.000Z"),
      maxAgeDays: 21,
      branches: [],
      pullRequests: [],
      worktrees: [
        {
          path: "/tmp/agentic-dirty",
          branch: "task/dirty",
          head: "abc123",
          dirtyFiles: 2,
          exists: true
        }
      ]
    });

    expect(report.ok).toBe(false);
    expect(report.findings).toEqual([
      expect.objectContaining({ kind: "dirty-worktree", severity: "blocker" })
    ]);
  });
});
