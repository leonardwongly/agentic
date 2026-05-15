import { validateStableIngressConfig } from "./lib/stable-ingress-config";

function printHumanSummary(report: ReturnType<typeof validateStableIngressConfig>) {
  const heading = report.ok ? "Stable ingress readiness passed." : "Stable ingress readiness failed.";

  console.log(`${heading} target=${report.targetName} baseUrl=${report.baseUrl ?? "unconfigured"}`);

  for (const check of report.checks) {
    console.log(`- [${check.status}] ${check.name}: ${check.message}`);
  }

  if (report.ok) {
    console.log(`health=${report.endpoints.health}`);
    console.log(`ready=${report.endpoints.readiness}`);
    console.log(`session=${report.endpoints.session}`);
  }
}

async function main() {
  const json = process.argv.includes("--json");
  const report = validateStableIngressConfig(process.env);

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
  console.error(error instanceof Error ? error.message : "Stable ingress configuration validation failed.");
  process.exitCode = 1;
});
