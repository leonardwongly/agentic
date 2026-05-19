import { runDeploymentGitHubAppSyncCanary } from "./lib/deployment-github-app-sync-canary";

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
