import {
  redactGitHubAppSyncLivePreflightReport,
  validateGitHubAppSyncLivePreflight
} from "./lib/github-app-sync-live-preflight";

type GitHubAppSyncLivePreflightReport = ReturnType<typeof validateGitHubAppSyncLivePreflight>;

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
