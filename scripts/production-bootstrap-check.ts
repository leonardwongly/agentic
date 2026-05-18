import { getDatabaseSchemaStatus } from "@agentic/db/migration-runtime";
import { validateProductionBootstrap, type ProductionBootstrapReport } from "./lib/production-bootstrap-check";

function printHumanSummary(report: ProductionBootstrapReport) {
  const heading = report.ok ? "Production bootstrap readiness passed." : "Production bootstrap readiness failed.";
  const database = report.database.checked
    ? `databaseReady=${report.database.ready ?? false}`
    : "databaseReady=not-checked";

  console.log(
    `${heading} target=${report.targetName} storage=${report.storageBackend} staticOnly=${report.staticOnly} ${database}`
  );

  for (const check of report.checks) {
    console.log(`- [${check.status}] ${check.name}: ${check.message}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const staticOnly = args.includes("--static-only");
  const databaseStatus = staticOnly
    ? undefined
    : await getDatabaseSchemaStatus({
        databaseUrl: process.env.DATABASE_URL
      });
  const report = validateProductionBootstrap({
    env: process.env,
    databaseStatus,
    staticOnly
  });

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
  console.error(error instanceof Error ? error.message : "Production bootstrap validation failed.");
  process.exitCode = 1;
});
