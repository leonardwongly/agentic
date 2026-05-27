import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");

function readRepoFile(filePath: string): string {
  return readFileSync(path.join(repoRoot, filePath), "utf8");
}

describe("open-source readiness files", () => {
  it("keeps required public contributor and maintainer documents in place", () => {
    const requiredFiles = [
      "LICENSE",
      "CONTRIBUTING.md",
      "CODE_OF_CONDUCT.md",
      "SECURITY.md",
      "SUPPORT.md",
      "GOVERNANCE.md",
      ".github/PULL_REQUEST_TEMPLATE.md",
      ".github/ISSUE_TEMPLATE/config.yml",
      ".github/ISSUE_TEMPLATE/bug_report.yml",
      ".github/ISSUE_TEMPLATE/feature_request.yml",
      ".github/ISSUE_TEMPLATE/documentation.yml"
    ];

    for (const filePath of requiredFiles) {
      expect(existsSync(path.join(repoRoot, filePath)), `${filePath} should exist`).toBe(true);
    }
  });

  it("publishes clear root package metadata without making workspace packages publishable", () => {
    const packageJson = JSON.parse(readRepoFile("package.json")) as {
      private?: boolean;
      version?: string;
      license?: string;
      repository?: { url?: string };
      bugs?: { url?: string };
      description?: string;
      keywords?: string[];
    };

    expect(packageJson.private).toBe(true);
    expect(packageJson.version).toBe("1.0.0");
    expect(packageJson.license).toBe("MIT");
    expect(packageJson.description).toContain("Trusted execution control plane");
    expect(packageJson.repository?.url).toBe("git+https://github.com/leonardwongly/agentic.git");
    expect(packageJson.bugs?.url).toBe("https://github.com/leonardwongly/agentic/issues");
    expect(packageJson.keywords).toEqual(expect.arrayContaining(["agentic", "governance", "workflow"]));
  });

  it("does not expose a public vulnerability issue template", () => {
    const securityPolicy = readRepoFile("SECURITY.md");
    const issueTemplateConfig = readRepoFile(".github/ISSUE_TEMPLATE/config.yml");

    expect(existsSync(path.join(repoRoot, ".github/ISSUE_TEMPLATE/security-vulnerability-report.yml"))).toBe(false);
    expect(securityPolicy).toContain("Do not open a public GitHub issue");
    expect(issueTemplateConfig).toContain("security/advisories/new");
  });
});
