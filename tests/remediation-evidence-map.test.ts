import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_REMEDIATION_EVIDENCE_MAP_PATH,
  renderRemediationEvidenceMapReport,
  validateRemediationEvidenceMap,
  type RemediationEvidenceMap
} from "../scripts/lib/remediation-evidence-map";

const repoRoot = path.resolve(import.meta.dirname, "..");

function readMap(): RemediationEvidenceMap {
  return JSON.parse(readFileSync(path.join(repoRoot, DEFAULT_REMEDIATION_EVIDENCE_MAP_PATH), "utf8")) as RemediationEvidenceMap;
}

function cloneMap(update?: (map: RemediationEvidenceMap) => void) {
  const map = structuredClone(readMap());
  update?.(map);
  return map;
}

describe("remediation evidence map", () => {
  it("validates the checked-in W7 issue evidence map", () => {
    const report = validateRemediationEvidenceMap(readMap(), { cwd: repoRoot });

    expect(report).toMatchObject({
      ok: true,
      summary: {
        entries: 6,
        blockedEntries: 1,
        entriesWithDeploymentProof: 0,
        residualRisks: 1
      },
      issues: []
    });
  });

  it("renders a concise reviewer report", () => {
    const report = validateRemediationEvidenceMap(readMap(), { cwd: repoRoot });
    const rendered = renderRemediationEvidenceMapReport(report);

    expect(rendered).toContain("Remediation evidence map passed.");
    expect(rendered).toContain("- Entries: 6");
    expect(rendered).toContain("- Blocked entries: 1");
  });

  it("requires every W7 issue to remain mapped", () => {
    const map = cloneMap(clonedMap => {
      clonedMap.entries = clonedMap.entries.filter(entry => entry.issue !== 186);
    });
    const report = validateRemediationEvidenceMap(map, { cwd: repoRoot });

    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        path: "entries",
        issue: 186,
        message: "Required W7 issue #186 is missing from the evidence map."
      })
    );
  });

  it("requires blocked deployment proof to link blockers", () => {
    const map = cloneMap(clonedMap => {
      delete clonedMap.entries.find(entry => entry.issue === 190)!.deploymentProof.blockers;
    });
    const report = validateRemediationEvidenceMap(map, { cwd: repoRoot });

    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        issue: 190,
        path: "entries[5].deploymentProof.blockers",
        message: "Blocked deployment proof must link blockers."
      })
    );
  });

  it("rejects unresolved repo evidence paths", () => {
    const map = cloneMap(clonedMap => {
      clonedMap.entries[0]!.implementationProof[0]!.ref = "docs/runbooks/missing-map.md";
    });
    const report = validateRemediationEvidenceMap(map, { cwd: repoRoot });

    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        issue: 184,
        path: "entries[0].implementationProof[0].ref",
        message:
          "Evidence reference 'docs/runbooks/missing-map.md' is not a safe config reference or does not resolve."
      })
    );
  });

  it("rejects GitHub references outside the repository", () => {
    const map = cloneMap(clonedMap => {
      clonedMap.entries.find(entry => entry.issue === 187)!.implementationProof[0]!.ref =
        "https://github.com/example/other/pull/136";
    });
    const report = validateRemediationEvidenceMap(map, { cwd: repoRoot });

    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        issue: 187,
        path: "entries[3].implementationProof[0].ref",
        message:
          "Evidence reference 'https://github.com/example/other/pull/136' is not a safe github_pr reference or does not resolve."
      })
    );
  });

  it("rejects secret-like values in evidence notes", () => {
    const map = cloneMap(clonedMap => {
      clonedMap.entries[0]!.implementationProof[0]!.note = "Validated with postgres://agentic:secret@db.example.com/agentic.";
    });
    const report = validateRemediationEvidenceMap(map, { cwd: repoRoot });

    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        path: "map.entries[0].implementationProof[0].note",
        message: "Evidence maps must not contain raw secrets, tokens, credentials, or URL credentials."
      })
    );
  });
});
