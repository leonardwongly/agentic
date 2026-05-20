import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RELEASE_CLOSEOUT_EVIDENCE_PATH,
  renderReleaseCloseoutEvidenceReport,
  validateReleaseCloseoutEvidenceManifest,
  type ReleaseCloseoutEvidenceManifest
} from "../scripts/lib/release-closeout-evidence";

const repoRoot = path.resolve(import.meta.dirname, "..");

function readCheckedInManifest(): ReleaseCloseoutEvidenceManifest {
  return JSON.parse(readFileSync(path.join(repoRoot, DEFAULT_RELEASE_CLOSEOUT_EVIDENCE_PATH), "utf8")) as ReleaseCloseoutEvidenceManifest;
}

function cloneManifest(overrides?: (manifest: ReleaseCloseoutEvidenceManifest) => void) {
  const manifest = structuredClone(readCheckedInManifest());
  overrides?.(manifest);
  return manifest;
}

describe("release closeout evidence", () => {
  it("validates the checked-in production runtime closeout manifest", () => {
    const report = validateReleaseCloseoutEvidenceManifest(readCheckedInManifest(), { cwd: repoRoot });

    expect(report).toMatchObject({
      ok: true,
      summary: {
        pullRequests: 15,
        blockedValidationGates: 6,
        residualRisks: 4
      },
      issues: []
    });
  });

  it("renders a reviewer summary for valid manifests", () => {
    const report = validateReleaseCloseoutEvidenceManifest(readCheckedInManifest(), { cwd: repoRoot });
    const rendered = renderReleaseCloseoutEvidenceReport(report);

    expect(rendered).toContain("Release closeout evidence passed.");
    expect(rendered).toContain("- Pull requests: 15");
    expect(rendered).toContain("- Blocked validation gates: 6");
  });

  it("keeps the GitHub sync preflight and evidence-gate PRs in the closeout package", () => {
    const manifest = readCheckedInManifest();

    expect(manifest.pullRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          number: 879,
          status: "merged",
          url: "https://github.com/leonardwongly/agentic/pull/879"
        }),
        expect.objectContaining({
          number: 880,
          status: "merged",
          url: "https://github.com/leonardwongly/agentic/pull/880"
        }),
        expect.objectContaining({
          number: 881,
          status: "merged",
          url: "https://github.com/leonardwongly/agentic/pull/881"
        }),
        expect.objectContaining({
          number: 882,
          status: "merged",
          url: "https://github.com/leonardwongly/agentic/pull/882"
        }),
        expect.objectContaining({
          number: 883,
          status: "merged",
          url: "https://github.com/leonardwongly/agentic/pull/883"
        })
      ])
    );
  });

  it("keeps the latest GitHub sync preflight and canary hardening PRs in the closeout package", () => {
    const manifest = readCheckedInManifest();

    expect(manifest.pullRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          number: 884,
          status: "merged",
          url: "https://github.com/leonardwongly/agentic/pull/884"
        }),
        expect.objectContaining({
          number: 885,
          status: "merged",
          url: "https://github.com/leonardwongly/agentic/pull/885"
        }),
        expect.objectContaining({
          number: 886,
          status: "merged",
          url: "https://github.com/leonardwongly/agentic/pull/886"
        }),
        expect.objectContaining({
          number: 887,
          status: "merged",
          url: "https://github.com/leonardwongly/agentic/pull/887"
        }),
        expect.objectContaining({
          number: 888,
          status: "merged",
          url: "https://github.com/leonardwongly/agentic/pull/888"
        }),
        expect.objectContaining({
          number: 889,
          status: "merged",
          url: "https://github.com/leonardwongly/agentic/pull/889"
        })
      ])
    );
  });

  it("keeps the latest blocked GitHub sync completion audit in the closeout package", () => {
    const manifest = readCheckedInManifest();
    const githubSyncPreflight = manifest.validationGates.find((gate) => gate.id === "github-app-sync-preflight");

    expect(githubSyncPreflight?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "github_issue",
          ref: "https://github.com/leonardwongly/agentic/issues/145#issuecomment-4498544854",
          status: "blocked"
        })
      ])
    );
  });

  it("keeps the read-only GitHub sync preflight collector in the closeout package", () => {
    const manifest = readCheckedInManifest();
    const githubSyncPreflight = manifest.validationGates.find((gate) => gate.id === "github-app-sync-preflight");

    expect(githubSyncPreflight?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "repo_path",
          ref: "scripts/github-app-sync-live-preflight-collect.ts",
          status: "ready"
        })
      ])
    );
    expect(manifest.observability.commands).toContain("npm run github:app-sync:preflight:collect");
  });

  it("keeps the latest Render provider readiness blocker in the closeout package", () => {
    const manifest = readCheckedInManifest();
    const deployIngressCheck = manifest.validationGates.find((gate) => gate.id === "deploy-ingress-check");

    expect(deployIngressCheck?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "github_issue",
          ref: "https://github.com/leonardwongly/agentic/issues/141#issuecomment-4498944971",
          status: "blocked"
        })
      ])
    );
  });

  it("requires blocked live validation gates to link blocker issues", () => {
    const manifest = cloneManifest(clonedManifest => {
      delete clonedManifest.validationGates[0]!.blockerIssues;
    });
    const report = validateReleaseCloseoutEvidenceManifest(manifest, { cwd: repoRoot });

    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        path: "validationGates[0].blockerIssues",
        message: "Blocked or not-run validation gates must link blockers."
      })
    );
  });

  it("rejects raw secret-like values in closeout evidence", () => {
    const manifest = cloneManifest(clonedManifest => {
      clonedManifest.residualRisks[0]!.mitigation = "Run against postgres://agentic:super-secret@db.example.com/agentic.";
    });
    const report = validateReleaseCloseoutEvidenceManifest(manifest, { cwd: repoRoot });

    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        path: "manifest.residualRisks[0].mitigation",
        message: "Release closeout evidence must not contain raw secrets, tokens, credentials, or URL credentials."
      })
    );
  });

  it("rejects pull request URLs outside this repository", () => {
    const manifest = cloneManifest(clonedManifest => {
      clonedManifest.pullRequests[0]!.url = "https://github.com/example/other/pull/858";
    });
    const report = validateReleaseCloseoutEvidenceManifest(manifest, { cwd: repoRoot });

    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        path: "pullRequests[0].url",
        message: "Pull request URL must point to this repository."
      })
    );
  });

  it("rejects unresolved repository evidence paths", () => {
    const manifest = cloneManifest(clonedManifest => {
      clonedManifest.trackedIssues[0]!.evidence[0]!.ref = "docs/runbooks/missing-closeout.md";
    });
    const report = validateReleaseCloseoutEvidenceManifest(manifest, { cwd: repoRoot });

    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        path: "trackedIssues[0].evidence[0].ref",
        message:
          "Evidence reference 'docs/runbooks/missing-closeout.md' is not a safe repo_path reference or does not resolve."
      })
    );
  });

  it("requires every W01-T05 child issue to stay in the closeout map", () => {
    const manifest = cloneManifest(clonedManifest => {
      clonedManifest.trackedIssues = clonedManifest.trackedIssues.filter(issue => issue.issue !== 294);
    });
    const report = validateReleaseCloseoutEvidenceManifest(manifest, { cwd: repoRoot });

    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        path: "trackedIssues",
        message: "Child issue #294 is missing from the release closeout map."
      })
    );
  });

  it("requires the GitHub App sync preflight to stay in the closeout gates", () => {
    const manifest = cloneManifest(clonedManifest => {
      clonedManifest.validationGates = clonedManifest.validationGates.filter(gate => gate.id !== "github-app-sync-preflight");
    });
    const report = validateReleaseCloseoutEvidenceManifest(manifest, { cwd: repoRoot });

    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        path: "validationGates",
        message: "Required validation gate 'github-app-sync-preflight' is missing."
      })
    );
  });
});
