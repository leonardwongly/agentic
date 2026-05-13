import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readWorkflow(filePath: string): string {
  return readFileSync(path.join(".github/workflows", filePath), "utf8");
}

function topLevelPermissionsBlock(workflow: string): string {
  const match = workflow.match(/^permissions:\n(?<block>(?:  .+\n)+)/mu);
  return match?.groups?.block ?? "";
}

function jobBlock(workflow: string, jobName: string): string {
  const pattern = new RegExp(`^  ${jobName}:\\n(?<block>(?:    .+\\n|\\s*\\n|      .+\\n|        .+\\n|          .+\\n|            .+\\n|              .+\\n|                .+\\n|                  .+\\n|                    .+\\n|                      .+\\n|                        .+\\n)*)`, "mu");
  return workflow.match(pattern)?.groups?.block ?? "";
}

describe("GitHub Actions permissions", () => {
  it("keeps CI workflow permissions read-only at the workflow and validation job scopes", () => {
    const workflow = readWorkflow("ci.yml");
    const topPermissions = topLevelPermissionsBlock(workflow);
    const validateJob = jobBlock(workflow, "validate");

    expect(topPermissions).toContain("contents: read");
    expect(topPermissions).not.toContain("id-token:");
    expect(topPermissions).not.toContain("attestations:");
    expect(topPermissions).not.toContain("contents: write");

    expect(validateJob).toContain("permissions:");
    expect(validateJob).toContain("contents: read");
    expect(validateJob).not.toContain("id-token:");
    expect(validateJob).not.toContain("attestations:");
  });

  it("isolates CI attestations to a non-PR job with explicit elevated permissions", () => {
    const workflow = readWorkflow("ci.yml");
    const validateJob = jobBlock(workflow, "validate");
    const attestJob = jobBlock(workflow, "attest-supply-chain");

    expect(validateJob).not.toContain("actions/attest-build-provenance");
    expect(attestJob).toContain("github.event_name != 'pull_request'");
    expect(attestJob).toContain("vars.ENABLE_SUPPLY_CHAIN_ARTIFACT_UPLOAD == 'true'");
    expect(attestJob).toContain("actions/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131");
    expect(attestJob).toContain("attestations: write");
    expect(attestJob).toContain("id-token: write");
    expect(attestJob).toContain("actions/attest-build-provenance@96b4a1ef7235a096b17240c259729fdd70c83d45");
  });

  it("does not grant staging attestation permissions at workflow scope", () => {
    const workflow = readWorkflow("staging-manual-deploy.yml");
    const topPermissions = topLevelPermissionsBlock(workflow);
    const stageJob = jobBlock(workflow, "stage");

    expect(topPermissions).toContain("contents: read");
    expect(topPermissions).not.toContain("id-token:");
    expect(topPermissions).not.toContain("attestations:");
    expect(stageJob).toContain("permissions:");
    expect(stageJob).toContain("attestations: write");
    expect(stageJob).toContain("id-token: write");
  });
});
