import { spawn } from "node:child_process";
import path from "node:path";
import { assertDatabaseSchemaReady } from "@agentic/db";

async function main() {
  await assertDatabaseSchemaReady({
    databaseUrl: process.env.DATABASE_URL
  });

  const child = spawn(process.execPath, ["--import", "tsx", "./src/index.ts", ...process.argv.slice(2)], {
    cwd: path.join(process.cwd(), "apps", "worker"),
    env: process.env,
    stdio: "inherit"
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Worker startup validation failed.");
  process.exitCode = 1;
});

