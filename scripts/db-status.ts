import { getDatabaseSchemaStatus } from "@agentic/db";

function requiresReadyStatus(args: string[]): boolean {
  return args.includes("--require-ready");
}

async function main() {
  const status = await getDatabaseSchemaStatus({
    databaseUrl: process.env.DATABASE_URL
  });

  console.log(JSON.stringify(status, null, 2));

  if (requiresReadyStatus(process.argv.slice(2)) && !status.ready) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Database status check failed.");
  process.exitCode = 1;
});

