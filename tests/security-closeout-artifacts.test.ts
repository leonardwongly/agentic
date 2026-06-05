import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
const pinnedCheckoutV6Pattern = /actions\/checkout@[a-f0-9]{40} # v6(?:\.\d+\.\d+)?/u;
const pinnedCodeqlInitV4Pattern = /github\/codeql-action\/init@[a-f0-9]{40} # v4(?:\.\d+\.\d+)?/u;
const pinnedCodeqlAnalyzeV4Pattern = /github\/codeql-action\/analyze@[a-f0-9]{40} # v4(?:\.\d+\.\d+)?/u;

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function collectTextFiles(relativePath: string): string[] {
  const resolvedPath = path.join(repoRoot, relativePath);
  const stats = statSync(resolvedPath);

  if (stats.isFile()) {
    return [relativePath];
  }

  return readdirSync(resolvedPath, { withFileTypes: true }).flatMap(entry => {
    const childPath = path.posix.join(relativePath, entry.name);
    if (entry.isDirectory()) {
      return collectTextFiles(childPath);
    }

    return /\.(json|md|mdx|toml|ya?ml)$/iu.test(entry.name) ? [childPath] : [];
  });
}

describe("security closeout artifacts", () => {
  it("runs the production container as a non-root user with owned app files", () => {
    const dockerfile = readRepoFile("Dockerfile");

    expect(dockerfile).toContain("ENV NPM_CONFIG_CACHE=/home/node/.npm");
    expect(dockerfile).toMatch(/COPY --chown=node:node --from=deps \/app\/node_modules \.\/node_modules/u);
    expect(dockerfile).toMatch(/COPY --chown=node:node --from=build \/app\/apps \.\/apps/u);
    expect(dockerfile).toMatch(/COPY --chown=node:node --from=build \/app\/packages \.\/packages/u);
    expect(dockerfile).toMatch(/COPY --chown=node:node --from=build \/app\/scripts \.\/scripts/u);
    expect(dockerfile).toMatch(/\nUSER node\nEXPOSE 3000/u);
    expect(dockerfile).not.toMatch(/\nUSER root\n/u);
  });

  it("adds a pinned CodeQL workflow for JavaScript and TypeScript analysis", () => {
    const workflow = readRepoFile(".github/workflows/codeql.yml");

    expect(workflow).toContain("name: CodeQL");
    expect(workflow).toContain("security-events: write");
    expect(workflow).toContain("contents: read");
    expect(workflow).toMatch(pinnedCheckoutV6Pattern);
    expect(workflow).toMatch(pinnedCodeqlInitV4Pattern);
    expect(workflow).toMatch(pinnedCodeqlAnalyzeV4Pattern);
    expect(workflow).toContain("languages: javascript-typescript");
    expect(workflow).toContain("queries: security-extended,security-and-quality");
    expect(workflow).toContain('cron: "41 3 * * 2"');
  });

  it("documents the high-risk external side-effect threat model coverage", () => {
    const threatModel = readRepoFile("docs/security/high-risk-external-side-effects-threat-model.md");
    const requiredTerms = [
      "SSRF",
      "Webhook forgery",
      "Prompt injection",
      "Replay and duplicate delivery",
      "Confused deputy",
      "Irreversible external side effects",
      "Secrets or PII in logs",
      "Rollback And Disablement",
      "Evidence Gates"
    ];

    for (const term of requiredTerms) {
      expect(threatModel).toContain(term);
    }

    expect(threatModel).toContain("side-effect ledger");
    expect(threatModel).toContain("CodeQL");
    expect(threatModel).toContain("provenance validation");
  });

  it("keeps docs, README, and GitHub workflow text free of raw local paths", () => {
    const scannedFiles = ["README.md", ...collectTextFiles("docs"), ...collectTextFiles(".github")];
    const rawLocalPathPattern = /\/Users\/|\/private\/|\/tmp\//u;
    const violations = scannedFiles.filter(filePath => rawLocalPathPattern.test(readRepoFile(filePath)));

    expect(violations).toEqual([]);
  });
});
