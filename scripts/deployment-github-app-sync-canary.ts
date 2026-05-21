import { runDeploymentGitHubAppSyncCanary } from "./lib/deployment-github-app-sync-canary";

const HELP_TEXT = `Usage: npm run test:smoke:github-app-sync -- [--json]

Runs a live GitHub App issue sync canary against the deployed Agentic origin. The canary first proves invalid bearer auth returns 401, then syncs allowlisted issues and polls queued github_issue_intake jobs to settlement.

Required inputs:
- AGENTIC_SMOKE_BASE_URL: stable deployed origin to test
- AGENTIC_SMOKE_ACCESS_KEY: runtime access key for job polling
- AGENTIC_GITHUB_APP_SYNC_SECRET: shared bearer secret configured in the deployed runtime and GitHub Actions caller

Optional inputs:
- AGENTIC_GITHUB_APP_SYNC_CANARY_TIMEOUT_MS: positive timeout in milliseconds
- AGENTIC_GITHUB_APP_SYNC_CANARY_POLL_INTERVAL_MS: positive poll interval in milliseconds

Output:
- Redacted JSON suitable for AGENTIC_GITHUB_APP_SYNC_CANARY_JSON after the command passes.
`;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} must be configured.`);
  }

  return value;
}

function readPositiveIntEnv(name: string): number | undefined {
  const value = process.env[name]?.trim();

  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer when configured.`);
  }

  return parsed;
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(HELP_TEXT);
    return;
  }

  const summary = await runDeploymentGitHubAppSyncCanary({
    baseUrl: requireEnv("AGENTIC_SMOKE_BASE_URL"),
    accessKey: requireEnv("AGENTIC_SMOKE_ACCESS_KEY"),
    syncSecret: requireEnv("AGENTIC_GITHUB_APP_SYNC_SECRET"),
    timeoutMs: readPositiveIntEnv("AGENTIC_GITHUB_APP_SYNC_CANARY_TIMEOUT_MS"),
    pollIntervalMs: readPositiveIntEnv("AGENTIC_GITHUB_APP_SYNC_CANARY_POLL_INTERVAL_MS")
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        ...summary
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "GitHub App sync deployment canary failed.");
  process.exitCode = 1;
});
