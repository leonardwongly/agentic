import { runDeploymentSmoke } from "./lib/deployment-smoke";

const HELP_TEXT = `Usage: npm run test:smoke:deployment -- [--json]

Runs live deployment health, readiness, and optional session smoke checks against the deployed Agentic origin.

Required inputs:
- AGENTIC_SMOKE_BASE_URL: stable deployed origin to test

Optional inputs:
- AGENTIC_SMOKE_ACCESS_KEY: runtime access key used to prove authenticated session readiness

Output:
- Redacted JSON suitable for AGENTIC_DEPLOYMENT_SMOKE_JSON after the command passes.
`;

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(HELP_TEXT);
    return;
  }

  const summary = await runDeploymentSmoke({
    baseUrl: process.env.AGENTIC_SMOKE_BASE_URL?.trim() ?? "",
    accessKey: process.env.AGENTIC_SMOKE_ACCESS_KEY?.trim()
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
  console.error(error instanceof Error ? error.message : "Deployment smoke test failed.");
  process.exitCode = 1;
});
