import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("GitHub Actions artifact cleanup", () => {
  it("runs scheduled cleanup with bounded inputs and least-privilege artifact deletion", () => {
    const workflow = readRepoFile(".github/workflows/artifact-cleanup.yml");

    expect(workflow).toContain("name: Artifact Cleanup");
    expect(workflow).toContain('cron: "17 2 * * *"');
    expect(workflow).toContain("actions: write");
    expect(workflow).toContain("contents: read");
    expect(workflow).not.toContain("actions/checkout");
    expect(workflow).toContain('DEFAULT_RETENTION_DAYS: "7"');
    expect(workflow).toContain("default: 7");
    expect(workflow).toContain("const rawRetentionDays = String");
    expect(workflow).toContain("/^[1-9]\\d*$/.test(rawRetentionDays)");
    expect(workflow).toContain("retention-days must be an integer from 1 to 90");
    expect(workflow).toContain("github.rest.actions.listArtifactsForRepo");
    expect(workflow).toContain("(response) => response.data.artifacts");
    expect(workflow).toContain("github.rest.actions.deleteArtifact");
    expect(workflow).toContain("dryRun");
  });

  it("sets explicit retention on each uploaded workflow artifact", () => {
    const ci = readRepoFile(".github/workflows/ci.yml");
    const staging = readRepoFile(".github/workflows/staging-manual-deploy.yml");

    expect((ci.match(/uses: actions\/upload-artifact@v\d+/g) || []).length).toBe(1);
    expect(ci).toContain("if: github.event_name != 'pull_request' && vars.ENABLE_SUPPLY_CHAIN_ARTIFACT_UPLOAD == 'true'");
    expect((ci.match(/retention-days:\s*7(?!\d)/g) || []).length).toBe(1);
    expect((staging.match(/uses: actions\/upload-artifact@v\d+/g) || []).length).toBe(2);
    expect((staging.match(/retention-days:\s*7(?!\d)/g) || []).length).toBe(2);
  });
});
