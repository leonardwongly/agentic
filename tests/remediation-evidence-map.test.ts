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
        blockedEntries: 0,
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
    expect(rendered).toContain("- Blocked entries: 0");
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

  it("keeps W01 production proof aligned to GitHub sync preflight and release closeout gates", () => {
    const entry = readMap().entries.find(mapEntry => mapEntry.issue === 190);

    expect(entry?.status).toBe("implemented");
    expect(entry?.deploymentProof.status).toBe("blocked");
    expect(entry?.deploymentProof.blockers).toEqual([141, 142, 143, 144, 145]);
    expect(entry?.implementationProof).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "script",
          ref: "scripts/github-app-sync-live-preflight.ts"
        }),
        expect.objectContaining({
          kind: "config",
          ref: "config/release/production-runtime-closeout.json"
        }),
        expect.objectContaining({
          kind: "github_pr",
          ref: "https://github.com/leonardwongly/agentic/pull/902"
        }),
        expect.objectContaining({
          kind: "github_pr",
          ref: "https://github.com/leonardwongly/agentic/pull/877"
        }),
        expect.objectContaining({
          kind: "github_pr",
          ref: "https://github.com/leonardwongly/agentic/pull/903"
        })
      ])
    );
    expect(entry?.validationGates).toEqual(
      expect.arrayContaining(["npm run github:app-sync:preflight", "npm run release:closeout:evidence"])
    );
    expect(entry?.deploymentProof.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "github_issue",
          ref: "#141"
        }),
        expect.objectContaining({
          kind: "github_issue",
          ref: "#142"
        }),
        expect.objectContaining({
          kind: "github_issue",
          ref: "#143"
        }),
        expect.objectContaining({
          kind: "github_issue",
          ref: "#144"
        }),
        expect.objectContaining({
          kind: "github_issue",
          ref: "#145"
        }),
        expect.objectContaining({
          kind: "github_issue",
          ref: "#152"
        }),
        expect.objectContaining({
          kind: "ci",
          ref: "https://github.com/leonardwongly/agentic/actions/runs/26201318000"
        }),
        expect.objectContaining({
          kind: "ci",
          ref: "https://github.com/leonardwongly/agentic/actions/runs/26202597305"
        }),
        expect.objectContaining({
          kind: "ci",
          ref: "github:app-sync:preflight:collect 2026-05-21T02:29Z"
        }),
        expect.objectContaining({
          kind: "ci",
          ref: "github:app-sync:preflight:collect 2026-05-21T03:10Z"
        }),
        expect.objectContaining({
          kind: "github_issue",
          ref: "#141",
          note: expect.stringContaining("reopened")
        })
      ])
    );
  });

  it("rejects W01 production proof when the GitHub sync preflight gate is removed", () => {
    const map = cloneMap(clonedMap => {
      const entry = clonedMap.entries.find(mapEntry => mapEntry.issue === 190)!;
      entry.validationGates = entry.validationGates.filter(gate => gate !== "npm run github:app-sync:preflight");
    });
    const report = validateRemediationEvidenceMap(map, { cwd: repoRoot });

    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        issue: 190,
        path: "entries[5].validationGates",
        message: "Production proof evidence must include validation gate 'npm run github:app-sync:preflight'."
      })
    );
  });

  it("rejects W01 production proof when release closeout evidence is removed", () => {
    const map = cloneMap(clonedMap => {
      const entry = clonedMap.entries.find(mapEntry => mapEntry.issue === 190)!;
      entry.implementationProof = entry.implementationProof.filter(
        proof => proof.ref !== "config/release/production-runtime-closeout.json"
      );
    });
    const report = validateRemediationEvidenceMap(map, { cwd: repoRoot });

    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        issue: 190,
        path: "entries[5].implementationProof",
        message: "Production proof evidence must include 'config/release/production-runtime-closeout.json'."
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
