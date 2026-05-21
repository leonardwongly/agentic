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
        pullRequests: 30,
        blockedValidationGates: 7,
        residualRisks: 3
      },
      issues: []
    });
  });

  it("renders a reviewer summary for valid manifests", () => {
    const report = validateReleaseCloseoutEvidenceManifest(readCheckedInManifest(), { cwd: repoRoot });
    const rendered = renderReleaseCloseoutEvidenceReport(report);

    expect(rendered).toContain("Release closeout evidence passed.");
    expect(rendered).toContain("- Pull requests: 30");
    expect(rendered).toContain("- Blocked validation gates: 7");
    expect(rendered).toContain("- Residual risks: 3");
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
        }),
        expect.objectContaining({
          kind: "github_issue",
          ref: "https://github.com/leonardwongly/agentic/issues/152#issuecomment-4503450287",
          status: "blocked"
        }),
        expect.objectContaining({
          kind: "github_issue",
          ref: "https://github.com/leonardwongly/agentic/issues/142#issuecomment-4503963483",
          status: "blocked"
        }),
        expect.objectContaining({
          kind: "github_issue",
          ref: "https://github.com/leonardwongly/agentic/issues/145#issuecomment-4503965733",
          status: "blocked"
        }),
        expect.objectContaining({
          kind: "github_issue",
          ref: "https://github.com/leonardwongly/agentic/issues/152#issuecomment-4503966874",
          status: "blocked"
        })
      ])
    );
  });

  it("keeps the latest GitHub issue route hardening PRs in the closeout package", () => {
    const manifest = readCheckedInManifest();

    expect(manifest.pullRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          number: 894,
          status: "merged",
          url: "https://github.com/leonardwongly/agentic/pull/894"
        }),
        expect.objectContaining({
          number: 895,
          status: "merged",
          url: "https://github.com/leonardwongly/agentic/pull/895"
        }),
        expect.objectContaining({
          number: 896,
          status: "merged",
          url: "https://github.com/leonardwongly/agentic/pull/896"
        }),
        expect.objectContaining({
          number: 897,
          status: "merged",
          url: "https://github.com/leonardwongly/agentic/pull/897"
        }),
        expect.objectContaining({
          number: 898,
          status: "merged",
          url: "https://github.com/leonardwongly/agentic/pull/898"
        })
      ])
    );
  });

  it("keeps the latest closeout evidence refresh PRs in the closeout package", () => {
    const manifest = readCheckedInManifest();

    expect(manifest.pullRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          number: 899,
          status: "merged",
          url: "https://github.com/leonardwongly/agentic/pull/899"
        }),
        expect.objectContaining({
          number: 900,
          status: "merged",
          url: "https://github.com/leonardwongly/agentic/pull/900"
        }),
        expect.objectContaining({
          number: 901,
          status: "merged",
          url: "https://github.com/leonardwongly/agentic/pull/901"
        }),
        expect.objectContaining({
          number: 902,
          status: "merged",
          url: "https://github.com/leonardwongly/agentic/pull/902"
        })
      ])
    );
  });

  it("keeps the final workflow dependency and post-merge CI audit in the closeout package", () => {
    const manifest = readCheckedInManifest();
    const localCiGate = manifest.validationGates.find((gate) => gate.id === "local-ci");
    const githubSyncPreflight = manifest.validationGates.find((gate) => gate.id === "github-app-sync-preflight");

    expect(manifest.pullRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          number: 877,
          status: "merged",
          url: "https://github.com/leonardwongly/agentic/pull/877"
        }),
        expect.objectContaining({
          number: 903,
          status: "merged",
          url: "https://github.com/leonardwongly/agentic/pull/903"
        }),
        expect.objectContaining({
          number: 904,
          status: "merged",
          url: "https://github.com/leonardwongly/agentic/pull/904"
        })
      ])
    );
    expect(localCiGate?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "github_action",
          ref: "https://github.com/leonardwongly/agentic/actions/runs/26201318000",
          status: "passed"
        }),
        expect.objectContaining({
          kind: "github_action",
          ref: "https://github.com/leonardwongly/agentic/actions/runs/26202597305",
          status: "passed"
        }),
        expect.objectContaining({
          kind: "github_action",
          ref: "https://github.com/leonardwongly/agentic/actions/runs/26203705829",
          status: "passed"
        })
      ])
    );
    expect(githubSyncPreflight?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "runtime_blocker",
          ref: "2026-05-21T02:29Z github:app-sync:preflight:collect",
          status: "blocked"
        }),
        expect.objectContaining({
          kind: "runtime_blocker",
          ref: "2026-05-21T03:10Z github:app-sync:preflight:collect",
          status: "blocked"
        }),
        expect.objectContaining({
          kind: "runtime_blocker",
          ref: "2026-05-21T03:51Z github:app-sync:preflight:collect",
          status: "blocked"
        })
      ])
    );
  });

  it("keeps the issue-sync completion audit and runbook PRs in the closeout package", () => {
    const manifest = readCheckedInManifest();
    const localCiGate = manifest.validationGates.find((gate) => gate.id === "local-ci");
    const githubSyncPreflight = manifest.validationGates.find((gate) => gate.id === "github-app-sync-preflight");

    expect(manifest.pullRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          number: 905,
          status: "merged",
          url: "https://github.com/leonardwongly/agentic/pull/905"
        }),
        expect.objectContaining({
          number: 906,
          status: "merged",
          url: "https://github.com/leonardwongly/agentic/pull/906"
        }),
        expect.objectContaining({
          number: 907,
          status: "merged",
          url: "https://github.com/leonardwongly/agentic/pull/907"
        })
      ])
    );
    expect(localCiGate?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "github_action",
          ref: "https://github.com/leonardwongly/agentic/actions/runs/26204947119",
          status: "passed"
        }),
        expect.objectContaining({
          kind: "github_action",
          ref: "https://github.com/leonardwongly/agentic/actions/runs/26206287937",
          status: "passed"
        }),
        expect.objectContaining({
          kind: "github_action",
          ref: "https://github.com/leonardwongly/agentic/actions/runs/26207505033",
          status: "passed"
        })
      ])
    );
    expect(githubSyncPreflight?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "repo_path",
          ref: "scripts/github-issues-completion-audit.ts",
          status: "ready"
        }),
        expect.objectContaining({
          kind: "runtime_blocker",
          ref: "2026-05-21T05:50Z github:app-sync:preflight:collect",
          status: "blocked"
        }),
        expect.objectContaining({
          kind: "runtime_blocker",
          ref: "2026-05-21T05:50Z github:issues:completion-audit",
          status: "blocked"
        })
      ])
    );
    expect(manifest.observability.commands).toContain("npm run github:issues:completion-audit -- --json");
  });

  it("keeps the reopened stable-ingress blocker correction in the closeout package", () => {
    const manifest = readCheckedInManifest();
    const ingressGate = manifest.validationGates.find((gate) => gate.id === "deploy-ingress-check");
    const smokeGate = manifest.validationGates.find((gate) => gate.id === "deployment-smoke");

    expect(ingressGate?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "github_issue",
          ref: "https://github.com/leonardwongly/agentic/issues/141#issuecomment-4504440830",
          status: "blocked"
        }),
        expect.objectContaining({
          kind: "github_issue",
          ref: "https://github.com/leonardwongly/agentic/issues/141#issuecomment-4504609146",
          status: "blocked"
        })
      ])
    );
    expect(smokeGate?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "github_issue",
          ref: "https://github.com/leonardwongly/agentic/issues/141#issuecomment-4504609146",
          status: "blocked"
        })
      ])
    );
  });

  it("keeps the post-PR #904 blocker refresh comments in the closeout package", () => {
    const manifest = readCheckedInManifest();
    const dbGate = manifest.validationGates.find((gate) => gate.id === "db-status-require-ready");
    const asyncGate = manifest.validationGates.find((gate) => gate.id === "deployment-async-canary");
    const githubSyncPreflight = manifest.validationGates.find((gate) => gate.id === "github-app-sync-preflight");

    expect(dbGate?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "github_issue",
          ref: "https://github.com/leonardwongly/agentic/issues/143#issuecomment-4504612149",
          status: "blocked"
        })
      ])
    );
    expect(asyncGate?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "github_issue",
          ref: "https://github.com/leonardwongly/agentic/issues/144#issuecomment-4504613320",
          status: "blocked"
        })
      ])
    );
    expect(githubSyncPreflight?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "github_issue",
          ref: "https://github.com/leonardwongly/agentic/issues/142#issuecomment-4504610449",
          status: "blocked"
        }),
        expect.objectContaining({
          kind: "github_issue",
          ref: "https://github.com/leonardwongly/agentic/issues/145#issuecomment-4504614955",
          status: "blocked"
        }),
        expect.objectContaining({
          kind: "github_issue",
          ref: "https://github.com/leonardwongly/agentic/issues/152#issuecomment-4504616601",
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

  it("keeps the GitHub App sync canary in the closeout operator commands", () => {
    const manifest = readCheckedInManifest();

    expect(manifest.observability.commands).toContain("npm run test:smoke:github-app-sync");
  });

  it("records hosted CI recovery without leaving #190 as a residual CI blocker", () => {
    const manifest = readCheckedInManifest();
    const localCiGate = manifest.validationGates.find((gate) => gate.id === "local-ci");

    expect(localCiGate?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "github_action",
          ref: "https://github.com/leonardwongly/agentic/actions/runs/26184631450",
          status: "passed"
        })
      ])
    );
    expect(manifest.residualRisks).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "hosted-ci-provenance-blocked",
          blockerIssues: [190]
        })
      ])
    );
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
        }),
        expect.objectContaining({
          kind: "github_issue",
          ref: "https://github.com/leonardwongly/agentic/issues/141#issuecomment-4503457603",
          status: "blocked"
        }),
        expect.objectContaining({
          kind: "github_issue",
          ref: "https://github.com/leonardwongly/agentic/issues/141#issuecomment-4503962701",
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

  it("requires the GitHub App sync canary to stay in the closeout gates", () => {
    const manifest = cloneManifest(clonedManifest => {
      clonedManifest.validationGates = clonedManifest.validationGates.filter(gate => gate.id !== "github-app-sync-canary");
    });
    const report = validateReleaseCloseoutEvidenceManifest(manifest, { cwd: repoRoot });

    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        path: "validationGates",
        message: "Required validation gate 'github-app-sync-canary' is missing."
      })
    );
  });

  it("requires required validation gates to keep their expected commands", () => {
    const manifest = cloneManifest(clonedManifest => {
      const syncCanaryGate = clonedManifest.validationGates.find(gate => gate.id === "github-app-sync-canary");
      if (syncCanaryGate) {
        syncCanaryGate.command = "npm run github:app-sync:preflight";
      }
    });
    const report = validateReleaseCloseoutEvidenceManifest(manifest, { cwd: repoRoot });

    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        path: "validationGates",
        message: "Validation gate 'github-app-sync-canary' must use command 'npm run test:smoke:github-app-sync'."
      })
    );
  });
});
