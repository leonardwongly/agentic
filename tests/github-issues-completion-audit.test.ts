import { describe, expect, it } from "vitest";
import { validateGitHubAppSyncLivePreflight } from "../scripts/lib/github-app-sync-live-preflight";
import {
  buildGitHubIssueSyncCompletionAudit,
  type GitHubIssueSyncCompletionIssueState
} from "../scripts/lib/github-issues-completion-audit";
import type { GitHubAppSyncLivePreflightCollectionReport } from "../scripts/lib/github-app-sync-live-preflight-collector";

const PRIVATE_KEY = "-----BEGIN RSA PRIVATE KEY-----\\nredacted\\n-----END RSA PRIVATE KEY-----";

const BASE_ENV = {
  AGENTIC_GITHUB_APP_ISSUE_SYNC_URL: "https://agentic.example.com/api/github/issues/app/sync",
  AGENTIC_SMOKE_BASE_URL: "https://agentic.example.com",
  AGENTIC_SMOKE_ACCESS_KEY: "runtime-access-key",
  AGENTIC_GITHUB_APP_SYNC_WORKFLOW_STATE: "active",
  AGENTIC_GITHUB_ACTIONS_SECRETS_JSON: JSON.stringify([{ name: "AGENTIC_GITHUB_APP_SYNC_SECRET" }]),
  DATABASE_URL: "postgres://agentic:redacted@postgres.internal:5432/agentic",
  AGENTIC_ACCESS_KEY: "runtime-access-key",
  AGENTIC_GITHUB_APP_ID: "123456",
  AGENTIC_GITHUB_APP_INSTALLATION_ID: "654321",
  AGENTIC_GITHUB_APP_PRIVATE_KEY: PRIVATE_KEY,
  AGENTIC_GITHUB_APP_SYNC_SECRET: "github-app-sync-secret-with-at-least-32-characters",
  AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES: "leonardwongly/agentic",
  AGENTIC_RENDER_SERVICES_JSON: JSON.stringify([{ name: "agentic-web" }, { name: "agentic-worker" }]),
  AGENTIC_RENDER_BLUEPRINT_VALIDATION_JSON: JSON.stringify({ valid: true, errors: [] })
};

const CLOSED_ISSUES: GitHubIssueSyncCompletionIssueState[] = [
  { number: 141, state: "CLOSED", title: "Deploy stable ingress" },
  { number: 142, state: "CLOSED", title: "Configure GitHub App sync secrets" },
  { number: 143, state: "CLOSED", title: "Bootstrap production database" },
  { number: 144, state: "CLOSED", title: "Deploy durable worker" },
  { number: 145, state: "CLOSED", title: "Validate live issue sync" },
  { number: 146, state: "CLOSED", title: "Capture rollout evidence" },
  { number: 152, state: "CLOSED", title: "Close roadmap" }
];

function collection(env: NodeJS.ProcessEnv): GitHubAppSyncLivePreflightCollectionReport {
  const preflight = validateGitHubAppSyncLivePreflight(env);

  return {
    ok: preflight.ok,
    collection: [],
    preflight
  };
}

describe("GitHub issue-sync completion audit", () => {
  it("passes only when tracked issues are closed and live preflight gates pass", () => {
    const report = buildGitHubIssueSyncCompletionAudit({
      issues: CLOSED_ISSUES,
      preflight: collection(BASE_ENV)
    });

    expect(report.ok).toBe(true);
    expect(report.summary).toEqual({
      checkedIssues: 7,
      passedCriteria: 14,
      failedCriteria: 0
    });
    expect(report.criteria.every((criterion) => criterion.status === "pass")).toBe(true);
  });

  it("surfaces open tracker issues and current live production blockers", () => {
    const report = buildGitHubIssueSyncCompletionAudit({
      issues: [
        { number: 141, state: "OPEN", title: "Deploy stable ingress" },
        { number: 142, state: "OPEN", title: "Configure GitHub App sync secrets" },
        { number: 143, state: "OPEN", title: "Bootstrap production database" },
        { number: 144, state: "OPEN", title: "Deploy durable worker" },
        { number: 145, state: "OPEN", title: "Validate live issue sync" },
        { number: 146, state: "CLOSED", title: "Capture rollout evidence" },
        { number: 152, state: "OPEN", title: "Close roadmap" }
      ],
      preflight: collection({
        ...BASE_ENV,
        AGENTIC_GITHUB_APP_ISSUE_SYNC_URL:
          "https://occasion-translations-cover-vids.trycloudflare.com/api/github/issues/app/sync",
        AGENTIC_SMOKE_BASE_URL: "https://occasion-translations-cover-vids.trycloudflare.com",
        AGENTIC_GITHUB_APP_SYNC_WORKFLOW_STATE: "disabled_manually",
        AGENTIC_RENDER_SERVICES_JSON: "null",
        AGENTIC_RENDER_BLUEPRINT_VALIDATION_JSON: JSON.stringify({
          valid: false,
          errors: [{ error: "need_payment_info", path: "services[0]" }]
        })
      })
    });

    expect(report.ok).toBe(false);
    expect(report.criteria).toContainEqual(
      expect.objectContaining({
        issue: 141,
        status: "fail",
        evidence: expect.arrayContaining(["#141 OPEN: Deploy stable ingress"])
      })
    );
    expect(report.criteria).toContainEqual(
      expect.objectContaining({
        issue: 141,
        status: "fail",
        evidence: expect.arrayContaining(["stable_host: fail - Sync URL must not use a temporary tunnel host."])
      })
    );
    expect(report.criteria).toContainEqual(
      expect.objectContaining({
        issue: 142,
        status: "fail",
        evidence: expect.arrayContaining([
          "workflow_state: fail - GitHub App Issue Sync workflow must be active before live validation."
        ])
      })
    );
    expect(report.criteria).toContainEqual(
      expect.objectContaining({
        issue: 145,
        status: "fail",
        evidence: expect.arrayContaining([
          "render_blueprint: fail - Render Blueprint validation must pass before live sync validation."
        ])
      })
    );
  });

  it("keeps roadmap closeout blocked while any production proof child gate fails", () => {
    const report = buildGitHubIssueSyncCompletionAudit({
      issues: CLOSED_ISSUES,
      preflight: collection({
        ...BASE_ENV,
        AGENTIC_RENDER_SERVICES_JSON: "null"
      })
    });

    expect(report.ok).toBe(false);
    expect(report.criteria).toContainEqual(
      expect.objectContaining({
        issue: 152,
        status: "fail",
        requirement: "Production proof child gates are unblocked before roadmap closeout.",
        evidence: ["Live preflight still blocks production proof children: #141, #143, #144, #145."]
      })
    );
  });

  it("keeps roadmap closeout blocked while any production proof child issue remains open", () => {
    const report = buildGitHubIssueSyncCompletionAudit({
      issues: CLOSED_ISSUES.map((issue) => (issue.number === 145 ? { ...issue, state: "OPEN" } : issue)),
      preflight: collection(BASE_ENV)
    });

    expect(report.ok).toBe(false);
    expect(report.criteria).toContainEqual(
      expect.objectContaining({
        issue: 152,
        status: "fail",
        requirement: "Production proof child gates are unblocked before roadmap closeout.",
        evidence: ["Production proof child issues remain open or uncollected: #145."]
      })
    );
  });

  it("keeps completion blocked when the release evidence package issue is open", () => {
    const report = buildGitHubIssueSyncCompletionAudit({
      issues: CLOSED_ISSUES.map((issue) => (issue.number === 146 ? { ...issue, state: "OPEN" } : issue)),
      preflight: collection(BASE_ENV)
    });

    expect(report.ok).toBe(false);
    expect(report.criteria).toContainEqual(
      expect.objectContaining({
        issue: 146,
        status: "fail",
        evidence: ["#146 OPEN: Capture rollout evidence"]
      })
    );
    expect(report.criteria).toContainEqual(
      expect.objectContaining({
        issue: 146,
        status: "fail",
        requirement: "Release closeout evidence package is complete before roadmap closeout.",
        evidence: ["#146 OPEN: release closeout evidence package is not closed."]
      })
    );
  });

  it("fails closed when a tracked issue state is missing from collection", () => {
    const report = buildGitHubIssueSyncCompletionAudit({
      issues: CLOSED_ISSUES.filter((issue) => issue.number !== 145),
      preflight: collection(BASE_ENV)
    });

    expect(report.ok).toBe(false);
    expect(report.criteria).toContainEqual(
      expect.objectContaining({
        issue: 145,
        status: "fail",
        evidence: ["#145 was not returned by the live issue-state collector."]
      })
    );
  });
});
