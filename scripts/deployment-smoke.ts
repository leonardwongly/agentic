import { runDeploymentSmoke } from "./lib/deployment-smoke";

async function main() {
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
