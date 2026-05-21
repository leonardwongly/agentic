import {
  redactGitHubAppSyncLivePreflightReport,
  validateGitHubAppSyncLivePreflight
} from "./lib/github-app-sync-live-preflight";

type GitHubAppSyncLivePreflightReport = ReturnType<typeof validateGitHubAppSyncLivePreflight>;

const HELP_TEXT = `Usage: npm run github:app-sync:preflight -- [--json]

Validates the live GitHub App issue sync production-proof evidence already present in the environment.

Required live evidence inputs:
- AGENTIC_GITHUB_APP_ISSUE_SYNC_URL: stable HTTPS URL ending in /api/github/issues/app/sync
- AGENTIC_SMOKE_BASE_URL or AGENTIC_INGRESS_BASE_URL: deployed web/API origin
- AGENTIC_GITHUB_APP_SYNC_WORKFLOW_STATE: expected to be active
- AGENTIC_GITHUB_ACTIONS_SECRETS_JSON: GitHub Actions secret inventory by name only
- DATABASE_URL, AGENTIC_ACCESS_KEY, AGENTIC_SMOKE_ACCESS_KEY
- AGENTIC_GITHUB_APP_ID, AGENTIC_GITHUB_APP_INSTALLATION_ID, AGENTIC_GITHUB_APP_PRIVATE_KEY
- AGENTIC_GITHUB_APP_SYNC_SECRET, AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES
- AGENTIC_RENDER_SERVICES_JSON and AGENTIC_RENDER_BLUEPRINT_VALIDATION_JSON for the default Render target
- or AGENTIC_DEPLOYMENT_PROVIDER_EVIDENCE_JSON for an approved alternate target with equivalent web, worker, Postgres, stable ingress, secret management, and rollback controls
- AGENTIC_DEPLOYMENT_SMOKE_JSON, AGENTIC_DEPLOYMENT_ASYNC_CANARY_JSON, AGENTIC_GITHUB_APP_SYNC_CANARY_JSON

Use npm run github:app-sync:preflight:collect -- --json to collect read-only GitHub and Render inventory before this check.
`;

function printHumanSummary(report: GitHubAppSyncLivePreflightReport) {
  const heading = report.ok ? "GitHub App sync live preflight passed." : "GitHub App sync live preflight failed.";

  console.log(
    `${heading} workflow=${report.workflowState ?? "unconfigured"} syncUrl=${report.syncUrl ?? "unconfigured"} smokeBaseUrl=${report.smokeBaseUrl ?? "unconfigured"}`
  );

  for (const check of report.checks) {
    console.log(`- [${check.status}] ${check.name}: ${check.message}`);
  }

  if (report.ok) {
    console.log(`health=${report.endpoints.health}`);
    console.log(`ready=${report.endpoints.readiness}`);
    console.log(`sync=${report.endpoints.sync}`);
  }
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(HELP_TEXT);
    return;
  }

  const json = process.argv.includes("--json");
  const report = redactGitHubAppSyncLivePreflightReport(validateGitHubAppSyncLivePreflight(process.env));

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanSummary(report);
  }

  if (!report.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "GitHub App sync live preflight failed.");
  process.exitCode = 1;
});
