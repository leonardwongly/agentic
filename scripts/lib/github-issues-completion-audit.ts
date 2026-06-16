import type { GitHubAppSyncLivePreflightCheck } from "./github-app-sync-live-preflight";
import type { GitHubAppSyncLivePreflightCollectionReport } from "./github-app-sync-live-preflight-collector";
import type { ReleaseCloseoutEvidenceReport } from "./release-closeout-evidence";

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
  releaseCloseoutEvidence: ReleaseCloseoutEvidenceReport;
  criteria: GitHubIssueSyncCompletionAuditCriterion[];
  summary: {
    checkedIssues: number;
    passedCriteria: number;
    failedCriteria: number;
  };
};

export type GitHubIssueSyncRemediationActionKind =
  | "local_read_only"
  | "external_provider"
  | "external_github_mutation"
  | "external_runtime_config"
  | "live_smoke_required"
  | "issue_closeout";

export type GitHubIssueSyncRemediationActionItem = {
  kind: GitHubIssueSyncRemediationActionKind;
  action: string;
};

export type GitHubIssueSyncRemediationCommandItem = {
  kind: GitHubIssueSyncRemediationActionKind;
  command: string;
};

export type GitHubIssueSyncCompletionRemediationPlanItem = {
  issue: GitHubIssueSyncCompletionIssueNumber;
  title: string;
  blocked: boolean;
  open: boolean;
  failedChecks: GitHubAppSyncLivePreflightCheck["name"][];
  actions: string[];
  actionItems: GitHubIssueSyncRemediationActionItem[];
  validation: string[];
  validationCommands: GitHubIssueSyncRemediationCommandItem[];
};

export type GitHubIssueSyncCompletionRemediationPlan = {
  ok: boolean;
  generatedFrom: {
    checkedIssues: number;
    failedCriteria: number;
  };
  items: GitHubIssueSyncCompletionRemediationPlanItem[];
  commands: string[];
  commandItems: GitHubIssueSyncRemediationCommandItem[];
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
  141: ["sync_url", "stable_host", "smoke_base_url", "provider_services", "provider_configuration", "deployment_smoke"],
  142: [
    "workflow_state",
    "github_actions_secret_inventory",
    "runtime_secret_inventory",
    "runtime_secret_shape",
    "repository_allowlist"
  ],
  143: ["runtime_secret_inventory", "smoke_base_url", "provider_services", "provider_configuration", "deployment_smoke"],
  144: ["runtime_secret_inventory", "provider_services", "provider_configuration", "deployment_async_canary"],
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
    "provider_services",
    "provider_configuration",
    "deployment_smoke",
    "deployment_async_canary",
    "github_app_sync_canary"
  ],
  146: [],
  152: []
};

const PREFLIGHT_REMEDIATION_ACTIONS: Record<GitHubAppSyncLivePreflightCheck["name"], string> = {
  sync_url:
    "Set `AGENTIC_GITHUB_APP_ISSUE_SYNC_URL` to the canonical deployed HTTPS sync endpoint `/api/github/issues/app/sync`.",
  stable_host:
    "Replace the temporary tunnel URL with a stable public HTTPS deployment origin for `AGENTIC_GITHUB_APP_ISSUE_SYNC_URL`.",
  smoke_base_url: "Set `AGENTIC_SMOKE_BASE_URL` or `AGENTIC_INGRESS_BASE_URL` to the deployed origin.",
  workflow_state:
    "Re-enable the GitHub App Issue Sync workflow only after stable deployment and runtime proof are ready.",
  github_actions_secret_inventory:
    "Keep only the GitHub App sync secret in GitHub Actions secrets and keep provider-only runtime credentials out of Actions.",
  runtime_secret_inventory:
    "Configure provider runtime variables for database access, runtime access key, GitHub App credentials, sync secret, and repository allowlist.",
  runtime_secret_shape:
    "Fix provider runtime variable shapes so IDs, private key, sync secret, database URL, access key, and repository allowlist validate.",
  smoke_canary_inventory: "Configure `AGENTIC_SMOKE_ACCESS_KEY` for live deployment smoke and canary execution.",
  repository_allowlist:
    "Set `AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES=<your-org>/<your-repo>` in the provider runtime for the repositories this installation should sync.",
  provider_services:
    "Provision or sync deployed Agentic web and worker services, or provide alternate provider evidence JSON for the selected target.",
  provider_configuration:
    "Resolve provider configuration validation errors such as Render `need_payment_info`, or provide alternate provider evidence JSON.",
  deployment_smoke:
    "Run `npm run test:smoke:deployment` against the stable origin and export passing JSON as `AGENTIC_DEPLOYMENT_SMOKE_JSON`.",
  deployment_async_canary:
    "Run `npm run test:smoke:deployment-async` against the deployed worker and export passing JSON as `AGENTIC_DEPLOYMENT_ASYNC_CANARY_JSON`.",
  github_app_sync_canary:
    "Run `npm run test:smoke:github-app-sync` against the deployed sync route and export passing JSON as `AGENTIC_GITHUB_APP_SYNC_CANARY_JSON`."
};

const PREFLIGHT_REMEDIATION_ACTION_KINDS: Record<GitHubAppSyncLivePreflightCheck["name"], GitHubIssueSyncRemediationActionKind> = {
  sync_url: "external_github_mutation",
  stable_host: "external_github_mutation",
  smoke_base_url: "external_runtime_config",
  workflow_state: "external_github_mutation",
  github_actions_secret_inventory: "external_github_mutation",
  runtime_secret_inventory: "external_runtime_config",
  runtime_secret_shape: "external_runtime_config",
  smoke_canary_inventory: "external_runtime_config",
  repository_allowlist: "external_runtime_config",
  provider_services: "external_provider",
  provider_configuration: "external_provider",
  deployment_smoke: "live_smoke_required",
  deployment_async_canary: "live_smoke_required",
  github_app_sync_canary: "live_smoke_required"
};

const PREFLIGHT_REMEDIATION_VALIDATION: Record<GitHubAppSyncLivePreflightCheck["name"], string> = {
  sync_url: "npm run github:app-sync:preflight:collect -- --json",
  stable_host: "npm run github:app-sync:preflight:collect -- --json",
  smoke_base_url: "npm run github:app-sync:preflight:collect -- --json",
  workflow_state: "npm run github:app-sync:preflight:collect -- --json",
  github_actions_secret_inventory: "npm run github:app-sync:preflight:collect -- --json",
  runtime_secret_inventory: "npm run github:app-sync:preflight:collect -- --json",
  runtime_secret_shape: "npm run github:app-sync:preflight:collect -- --json",
  smoke_canary_inventory: "npm run github:app-sync:preflight:collect -- --json",
  repository_allowlist: "npm run github:app-sync:preflight:collect -- --json",
  provider_services: "npm run github:app-sync:preflight:collect -- --json",
  provider_configuration: "npm run github:app-sync:preflight:collect -- --json",
  deployment_smoke: "npm run test:smoke:deployment",
  deployment_async_canary: "npm run test:smoke:deployment-async",
  github_app_sync_canary: "npm run test:smoke:github-app-sync"
};

const PREFLIGHT_REMEDIATION_VALIDATION_KINDS: Record<GitHubAppSyncLivePreflightCheck["name"], GitHubIssueSyncRemediationActionKind> = {
  sync_url: "local_read_only",
  stable_host: "local_read_only",
  smoke_base_url: "local_read_only",
  workflow_state: "local_read_only",
  github_actions_secret_inventory: "local_read_only",
  runtime_secret_inventory: "local_read_only",
  runtime_secret_shape: "local_read_only",
  smoke_canary_inventory: "local_read_only",
  repository_allowlist: "local_read_only",
  provider_services: "local_read_only",
  provider_configuration: "local_read_only",
  deployment_smoke: "live_smoke_required",
  deployment_async_canary: "live_smoke_required",
  github_app_sync_canary: "live_smoke_required"
};

const REMEDIATION_PLAN_COMMANDS = [
  "npm run github:app-sync:preflight:collect -- --json",
  "npm run github:issues:completion-audit -- --remediation-plan",
  "npm run github:issues:completion-audit -- --json",
  "npm run release:closeout:evidence -- --json"
] as const;

const REMEDIATION_PLAN_COMMAND_ITEMS: GitHubIssueSyncRemediationCommandItem[] = REMEDIATION_PLAN_COMMANDS.map((command) => ({
  kind: "local_read_only",
  command
}));

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
  releaseCloseoutEvidence: ReleaseCloseoutEvidenceReport,
  issueNumber: GitHubIssueSyncCompletionIssueNumber
): GitHubIssueSyncCompletionAuditCriterion {
  const requiredChecks = ISSUE_PREFLIGHT_CHECKS[issueNumber];

  if (requiredChecks.length === 0) {
    if (issueNumber === 146) {
      const issue = issueByNumber(issues, issueNumber);
      const state = normalizeState(issue?.state ?? "");

      return {
        issue: issueNumber,
        status: (state === "CLOSED" || state === "MERGED") && releaseCloseoutEvidence.ok ? "pass" : "fail",
        requirement: "Release closeout evidence package is complete before roadmap closeout.",
        evidence: [
          state === "CLOSED" || state === "MERGED"
            ? "#146 release closeout evidence issue is closed."
            : `#146 ${state || "MISSING"}: release closeout evidence package is not closed.`,
          releaseCloseoutEvidence.ok
            ? `Release closeout evidence manifest passed with ${releaseCloseoutEvidence.summary.validationGates} validation gates.`
            : `Release closeout evidence manifest failed with ${releaseCloseoutEvidence.issues.length} issue(s).`,
          ...releaseCloseoutEvidence.issues.slice(0, 5).map((validationIssue) => `${validationIssue.path}: ${validationIssue.message}`)
        ]
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
  releaseCloseoutEvidence: ReleaseCloseoutEvidenceReport;
}): GitHubIssueSyncCompletionAuditReport {
  const criteria = TRACKED_ISSUES.flatMap((issue) => [
    issueStateCriterion(params.issues, issue),
    preflightCriterion(params.issues, params.preflight, params.releaseCloseoutEvidence, issue)
  ]);
  const failedCriteria = criteria.filter((criterion) => criterion.status === "fail").length;
  const passedCriteria = criteria.length - failedCriteria;

  return {
    ok: failedCriteria === 0,
    issues: params.issues,
    releaseCloseoutEvidence: params.releaseCloseoutEvidence,
    criteria,
    summary: {
      checkedIssues: TRACKED_ISSUES.length,
      passedCriteria,
      failedCriteria
    }
  };
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function failedChecksForCriteria(
  criteria: GitHubIssueSyncCompletionAuditCriterion[]
): GitHubAppSyncLivePreflightCheck["name"][] {
  const failedCheckNames = new Set<GitHubAppSyncLivePreflightCheck["name"]>();
  const knownNames = Object.keys(PREFLIGHT_REMEDIATION_ACTIONS) as GitHubAppSyncLivePreflightCheck["name"][];

  for (const criterion of criteria) {
    for (const evidence of criterion.evidence) {
      const checkName = knownNames.find((name) => evidence.startsWith(`${name}: fail -`));

      if (checkName) {
        failedCheckNames.add(checkName);
      }
    }
  }

  return knownNames.filter((name) => failedCheckNames.has(name));
}

function releaseCloseoutActions(report: GitHubIssueSyncCompletionAuditReport): string[] {
  return report.releaseCloseoutEvidence.ok
    ? []
    : ["Repair the release closeout evidence manifest until `npm run release:closeout:evidence -- --json` reports `ok: true`."];
}

function releaseCloseoutActionItems(report: GitHubIssueSyncCompletionAuditReport): GitHubIssueSyncRemediationActionItem[] {
  return releaseCloseoutActions(report).map((action) => ({
    kind: "local_read_only",
    action
  }));
}

function roadmapActions(criteria: GitHubIssueSyncCompletionAuditCriterion[]): string[] {
  const roadmapBlocked = criteria.some(
    (criterion) =>
      criterion.issue === 152 &&
      criterion.status === "fail" &&
      criterion.evidence.some(
        (evidence) =>
          evidence.startsWith("Production proof child issues remain open") ||
          evidence.startsWith("Live preflight still blocks production proof children")
      )
  );

  return roadmapBlocked
    ? ["Resolve production proof child issues #141-#145 and rerun the completion audit before closing #152."]
    : [];
}

function roadmapActionItems(criteria: GitHubIssueSyncCompletionAuditCriterion[]): GitHubIssueSyncRemediationActionItem[] {
  return roadmapActions(criteria).map((action) => ({
    kind: "issue_closeout",
    action
  }));
}

function uniqueActionItems(items: GitHubIssueSyncRemediationActionItem[]): GitHubIssueSyncRemediationActionItem[] {
  const seen = new Set<string>();

  return items.filter((item) => {
    const key = `${item.kind}\u0000${item.action}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function uniqueCommandItems(items: GitHubIssueSyncRemediationCommandItem[]): GitHubIssueSyncRemediationCommandItem[] {
  const seen = new Set<string>();

  return items.filter((item) => {
    const key = `${item.kind}\u0000${item.command}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function localReadOnlyPlan(plan: GitHubIssueSyncCompletionRemediationPlan): GitHubIssueSyncCompletionRemediationPlan {
  const items = plan.items
    .map((item) => {
      const actionItems = item.actionItems.filter((action) => action.kind === "local_read_only");
      const validationCommands = item.validationCommands.filter((command) => command.kind === "local_read_only");

      return {
        ...item,
        actions: actionItems.map((action) => action.action),
        actionItems,
        validation: validationCommands.map((command) => command.command),
        validationCommands
      };
    })
    .filter((item) => item.actionItems.length > 0 || item.validationCommands.length > 0);
  const commandItems = plan.commandItems.filter((command) => command.kind === "local_read_only");

  return {
    ...plan,
    items,
    commands: commandItems.map((command) => command.command),
    commandItems
  };
}

export function buildGitHubIssueSyncRemediationPlan(
  report: GitHubIssueSyncCompletionAuditReport,
  options: { localOnly?: boolean } = {}
): GitHubIssueSyncCompletionRemediationPlan {
  const items = TRACKED_ISSUES.map((issue) => {
    const issueState = issueByNumber(report.issues, issue);
    const state = normalizeState(issueState?.state ?? "");
    const issueCriteria = report.criteria.filter((criterion) => criterion.issue === issue);
    const failedCriteria = issueCriteria.filter((criterion) => criterion.status === "fail");
    const open = state !== "CLOSED" && state !== "MERGED";
    const failedChecks = failedChecksForCriteria(failedCriteria);
    const issueCloseoutActions = open
      ? [`Keep #${issue} open until its issue-specific validation criteria pass; close it only after the audit reports pass for the issue.`]
      : [];
    const actionItems = uniqueActionItems([
      ...issueCloseoutActions.map((action) => ({ kind: "issue_closeout" as const, action })),
      ...failedChecks.map((check) => ({
        kind: PREFLIGHT_REMEDIATION_ACTION_KINDS[check],
        action: PREFLIGHT_REMEDIATION_ACTIONS[check]
      })),
      ...(issue === 146 ? releaseCloseoutActionItems(report) : []),
      ...(issue === 152 ? roadmapActionItems(failedCriteria) : [])
    ]);
    const validationCommands = uniqueCommandItems([
      ...failedChecks.map((check) => ({
        kind: PREFLIGHT_REMEDIATION_VALIDATION_KINDS[check],
        command: PREFLIGHT_REMEDIATION_VALIDATION[check]
      })),
      ...(issue === 146
        ? [{ kind: "local_read_only" as const, command: "npm run release:closeout:evidence -- --json" }]
        : []),
      { kind: "local_read_only" as const, command: "npm run github:issues:completion-audit -- --json" }
    ]);

    return {
      issue,
      title: issueState?.title ?? "Missing from live issue-state collection",
      blocked: failedCriteria.length > 0,
      open,
      failedChecks,
      actions: actionItems.map((action) => action.action),
      actionItems,
      validation: validationCommands.map((command) => command.command),
      validationCommands
    };
  }).filter((item) => item.blocked || item.open);

  const plan = {
    ok: report.ok,
    generatedFrom: {
      checkedIssues: report.summary.checkedIssues,
      failedCriteria: report.summary.failedCriteria
    },
    items,
    commands: REMEDIATION_PLAN_COMMAND_ITEMS.map((command) => command.command),
    commandItems: [...REMEDIATION_PLAN_COMMAND_ITEMS]
  };

  return options.localOnly ? localReadOnlyPlan(plan) : plan;
}

export const githubIssueSyncCompletionAuditTrackedIssues = TRACKED_ISSUES;
