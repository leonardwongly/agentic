import { checkMigrationDiscipline } from "@agentic/db/migration-discipline";

async function main() {
  const report = await checkMigrationDiscipline();

  console.log(JSON.stringify(report, null, 2));

  if (report.status === "fail") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Migration discipline check failed.");
  process.exitCode = 1;
});
