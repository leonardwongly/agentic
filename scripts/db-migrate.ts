import { runDatabaseMigrations } from "@agentic/db";

async function main() {
  const status = await runDatabaseMigrations({
    databaseUrl: process.env.DATABASE_URL
  });

  console.log(
    JSON.stringify(
      {
        ok: status.ready,
        appliedMigrations: status.appliedMigrations,
        pendingMigrations: status.pendingMigrations,
        driftedMigrations: status.driftedMigrations
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Database migration failed.");
  process.exitCode = 1;
});

