import { collectGitHubAppSyncLivePreflight } from "./lib/github-app-sync-live-preflight-collector";

type GitHubAppSyncLivePreflightCollectionReport = Awaited<ReturnType<typeof collectGitHubAppSyncLivePreflight>>;

function printHumanSummary(report: GitHubAppSyncLivePreflightCollectionReport) {
  const heading = report.ok
    ? "GitHub App sync live preflight collection passed."
    : "GitHub App sync live preflight collection failed.";

  console.log(heading);
  console.log("Collection:");

  for (const step of report.collection) {
    console.log(`- [${step.status}] ${step.name}: ${step.message}`);
  }

  console.log("Preflight:");
  console.log(
    `workflow=${report.preflight.workflowState ?? "unconfigured"} syncUrl=${report.preflight.syncUrl ?? "unconfigured"} smokeBaseUrl=${report.preflight.smokeBaseUrl ?? "unconfigured"}`
  );

  for (const check of report.preflight.checks) {
    console.log(`- [${check.status}] ${check.name}: ${check.message}`);
  }

  if (report.preflight.ok) {
    console.log(`health=${report.preflight.endpoints.health}`);
    console.log(`ready=${report.preflight.endpoints.readiness}`);
    console.log(`sync=${report.preflight.endpoints.sync}`);
  }
}

async function main() {
  const json = process.argv.includes("--json");
  const report = await collectGitHubAppSyncLivePreflight(process.env);

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
  console.error(error instanceof Error ? error.message : "GitHub App sync live preflight collection failed.");
  process.exitCode = 1;
});

