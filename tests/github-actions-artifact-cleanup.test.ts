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
    expect(workflow).toContain("(response) => response.data.artifacts ?? []");
    expect(workflow).toContain(".filter(Boolean)");
    expect(workflow).toContain("skippedMalformedArtifacts");
    expect(workflow).toContain("Skipping malformed artifact payload");
    expect(workflow).toContain("Malformed artifacts skipped");
    expect(workflow).toContain("github.rest.actions.deleteArtifact");
    expect(workflow).toContain("dryRun");
  });

  it("sets explicit retention on each uploaded workflow artifact", () => {
    const ci = readRepoFile(".github/workflows/ci.yml");
    const staging = readRepoFile(".github/workflows/staging-manual-deploy.yml");

    expect((ci.match(/uses: actions\/upload-artifact@[a-f0-9]{40} # v\d+/g) || []).length).toBe(1);
    expect(ci).toMatch(
      /if:\s*github\.event_name\s*!=\s*['"]pull_request['"]\s*&&\s*vars\.ENABLE_SUPPLY_CHAIN_ARTIFACT_UPLOAD\s*==\s*['"]true['"]/
    );
    expect((ci.match(/retention-days:\s*7(?!\d)/g) || []).length).toBe(1);
    expect((staging.match(/uses: actions\/upload-artifact@[a-f0-9]{40} # v\d+/g) || []).length).toBe(2);
    expect(staging).toMatch(
      /if:\s*always\(\)\s*&&\s*\(steps\.inspect\.outputs\.mode\s*==\s*['"]external['"]\s*\|\|\s*steps\.inspect\.outputs\.mode\s*==\s*['"]self-test['"]\)\s*&&\s*vars\.ENABLE_SUPPLY_CHAIN_ARTIFACT_UPLOAD\s*==\s*['"]true['"]/
    );
    expect((staging.match(/retention-days:\s*7(?!\d)/g) || []).length).toBe(2);
  });

  it("attests each supply-chain evidence set with a single OIDC-backed action call", () => {
    const ci = readRepoFile(".github/workflows/ci.yml");
    const staging = readRepoFile(".github/workflows/staging-manual-deploy.yml");

    expect(ci).toContain("name: Attest supply-chain evidence");
    expect(ci).not.toContain("name: Attest security evidence");
    expect(ci).not.toContain("name: Attest deployable build artifacts");
    expect((ci.match(/uses: actions\/attest-build-provenance@[a-f0-9]{40} # v\d+/g) || []).length).toBe(1);
    expect(ci).toMatch(
      /subject-path:\s*\|\s*artifacts\/security\/agentic-sbom\.spdx\.json\s*artifacts\/build\/agentic-runtime-bundle\.tgz\s*artifacts\/build\/agentic-image\.tar/u
    );

    expect(staging).toContain("name: Attest staging supply-chain evidence");
    expect(staging).not.toContain("name: Attest staging security evidence");
    expect(staging).not.toContain("name: Attest staging deployable build artifacts");
    expect((staging.match(/uses: actions\/attest-build-provenance@[a-f0-9]{40} # v\d+/g) || []).length).toBe(1);
    expect(staging).toMatch(
      /subject-path:\s*\|\s*artifacts\/security\/agentic-sbom\.spdx\.json\s*artifacts\/build\/agentic-runtime-bundle\.tgz\s*artifacts\/build\/agentic-image\.tar/u
    );
  });
});
