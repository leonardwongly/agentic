import type { GitHubAppSyncLivePreflightCheck } from "./github-app-sync-live-preflight";
import type { GitHubAppSyncLivePreflightCollectionReport } from "./github-app-sync-live-preflight-collector";

export type GitHubIssueSyncCompletionIssueNumber = 141 | 142 | 143 | 144 | 145 | 146 | 152;

export type GitHubIssueSyncCompletionIssueState = {
  number: GitHubIssueSyncCompletionIssueNumber;
  state: string;
  title: string;
};

export type GitHubIssueSyncCompletionAuditStatus = "pass" | "fail";

export type GitHubIssueSyncCompletionAuditCriterion = {
  issue: GitHubIssueSyncCompletionIssueNumber;
  status: GitHubIssueSyncCompletionAuditStatus;
  requirement: string;
  evidence: string[];
};

export type GitHubIssueSyncCompletionAuditReport = {
  ok: boolean;
  issues: GitHubIssueSyncCompletionIssueState[];
  criteria: GitHubIssueSyncCompletionAuditCriterion[];
  summary: {
    checkedIssues: number;
    passedCriteria: number;
    failedCriteria: number;
  };
};

const TRACKED_ISSUES = [141, 142, 143, 144, 145, 146, 152] as const;

const ISSUE_REQUIREMENTS: Record<GitHubIssueSyncCompletionIssueNumber, string> = {
  141: "Stable HTTPS ingress, provider target, health/readiness, proxy posture, and rollback authority are complete.",
  142: "GitHub App runtime configuration, repository caller settings, allowlist, and fail-closed auth proof are complete.",
  143: "Postgres/shared-auth production bootstrap, migrations, db status, and readiness proof are complete.",
  144: "Deployed worker durability, shared state, job settlement, retry, and sanitized failure proof are complete.",
  145: "Live GitHub App issue sync workflow dispatch, valid/invalid auth, duplicate behavior, PR skip, and worker result proof are complete.",
  146: "Release evidence, rollout, rollback, disablement, and residual-risk closeout package is complete.",
  152: "Roadmap closeout after production proof is complete and no production proof child issue remains open."
};

const ISSUE_PREFLIGHT_CHECKS: Record<GitHubIssueSyncCompletionIssueNumber, GitHubAppSyncLivePreflightCheck["name"][]> = {
  141: ["sync_url", "stable_host", "smoke_base_url", "render_services", "render_blueprint"],
  142: [
    "workflow_state",
    "github_actions_secret_inventory",
    "runtime_secret_inventory",
    "runtime_secret_shape",
    "repository_allowlist"
  ],
  143: ["runtime_secret_inventory", "smoke_base_url", "render_services", "render_blueprint"],
  144: ["runtime_secret_inventory", "render_services", "render_blueprint"],
  145: [
    "sync_url",
    "stable_host",
    "smoke_base_url",
    "workflow_state",
    "github_actions_secret_inventory",
    "runtime_secret_inventory",
    "runtime_secret_shape",
    "smoke_canary_inventory",
    "repository_allowlist",
    "render_services",
    "render_blueprint"
  ],
  146: [],
  152: []
};

function normalizeState(state: string): string {
  return state.trim().toUpperCase();
}

function issueByNumber(
  issues: GitHubIssueSyncCompletionIssueState[],
  issueNumber: GitHubIssueSyncCompletionIssueNumber
): GitHubIssueSyncCompletionIssueState | null {
  return issues.find((issue) => issue.number === issueNumber) ?? null;
}

function checkByName(
  preflight: GitHubAppSyncLivePreflightCollectionReport,
  name: GitHubAppSyncLivePreflightCheck["name"]
): GitHubAppSyncLivePreflightCheck | null {
  return preflight.preflight.checks.find((check) => check.name === name) ?? null;
}

function issueStateCriterion(
  issues: GitHubIssueSyncCompletionIssueState[],
  issueNumber: GitHubIssueSyncCompletionIssueNumber
): GitHubIssueSyncCompletionAuditCriterion {
  const issue = issueByNumber(issues, issueNumber);

  if (!issue) {
    return {
      issue: issueNumber,
      status: "fail",
      requirement: `Issue #${issueNumber} is present in the tracker audit.`,
      evidence: [`#${issueNumber} was not returned by the live issue-state collector.`]
    };
  }

  const state = normalizeState(issue.state);

  return {
    issue: issueNumber,
    status: state === "CLOSED" || state === "MERGED" ? "pass" : "fail",
    requirement: ISSUE_REQUIREMENTS[issueNumber],
    evidence: [`#${issueNumber} ${state}: ${issue.title}`]
  };
}

function preflightCriterion(
  issues: GitHubIssueSyncCompletionIssueState[],
  preflight: GitHubAppSyncLivePreflightCollectionReport,
  issueNumber: GitHubIssueSyncCompletionIssueNumber
): GitHubIssueSyncCompletionAuditCriterion {
  const requiredChecks = ISSUE_PREFLIGHT_CHECKS[issueNumber];

  if (requiredChecks.length === 0) {
    if (issueNumber === 146) {
      const issue = issueByNumber(issues, issueNumber);
      const state = normalizeState(issue?.state ?? "");

      return {
        issue: issueNumber,
        status: state === "CLOSED" || state === "MERGED" ? "pass" : "fail",
        requirement: "Release closeout evidence package is complete before roadmap closeout.",
        evidence:
          state === "CLOSED" || state === "MERGED"
            ? ["#146 release closeout evidence package is closed."]
            : [`#146 ${state || "MISSING"}: release closeout evidence package is not closed.`]
      };
    }

    const childIssues = [141, 142, 143, 144, 145] as const;
    const openChildIssues = childIssues.filter((childIssue) => {
      const issue = issueByNumber(issues, childIssue);
      const state = normalizeState(issue?.state ?? "");

      return state !== "CLOSED" && state !== "MERGED";
    });
    const blockedChildGates = childIssues.filter((childIssue) =>
      preflight.preflight.checks.some((check) => ISSUE_PREFLIGHT_CHECKS[childIssue].includes(check.name) && check.status === "fail")
    );
    const failedEvidence = [
      openChildIssues.length > 0
        ? `Production proof child issues remain open or uncollected: ${openChildIssues.map((issue) => `#${issue}`).join(", ")}.`
        : null,
      blockedChildGates.length > 0
        ? `Live preflight still blocks production proof children: ${blockedChildGates.map((issue) => `#${issue}`).join(", ")}.`
        : null,
      openChildIssues.length === 0 && blockedChildGates.length === 0 && !preflight.ok ? "Live preflight did not pass." : null
    ].filter((evidence): evidence is string => Boolean(evidence));

    return {
      issue: issueNumber,
      status: failedEvidence.length === 0 && preflight.ok ? "pass" : "fail",
      requirement: "Production proof child gates are unblocked before roadmap closeout.",
      evidence:
        failedEvidence.length === 0 && preflight.ok
          ? ["Live preflight passed for all production proof child gates."]
          : failedEvidence
    };
  }

  const failed = requiredChecks.flatMap((name) => {
    const check = checkByName(preflight, name);

    if (!check) {
      return [`${name}: fail - Live preflight did not return this required check.`];
    }

    if (check.status === "fail") {
      return [`${check.name}: ${check.status} - ${check.message}`];
    }

    return [];
  });

  return {
    issue: issueNumber,
    status: failed.length === 0 ? "pass" : "fail",
    requirement: `Live preflight checks pass for #${issueNumber}.`,
    evidence:
      failed.length === 0
        ? requiredChecks.map((name) => `${name}: pass`)
        : failed
  };
}

export function buildGitHubIssueSyncCompletionAudit(params: {
  issues: GitHubIssueSyncCompletionIssueState[];
  preflight: GitHubAppSyncLivePreflightCollectionReport;
}): GitHubIssueSyncCompletionAuditReport {
  const criteria = TRACKED_ISSUES.flatMap((issue) => [
    issueStateCriterion(params.issues, issue),
    preflightCriterion(params.issues, params.preflight, issue)
  ]);
  const failedCriteria = criteria.filter((criterion) => criterion.status === "fail").length;
  const passedCriteria = criteria.length - failedCriteria;

  return {
    ok: failedCriteria === 0,
    issues: params.issues,
    criteria,
    summary: {
      checkedIssues: TRACKED_ISSUES.length,
      passedCriteria,
      failedCriteria
    }
  };
}

export const githubIssueSyncCompletionAuditTrackedIssues = TRACKED_ISSUES;
