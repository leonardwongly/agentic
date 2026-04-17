import { spawn } from "node:child_process";
import path from "node:path";
import { getWebReadinessReport } from "../apps/web/lib/runtime-readiness";

function buildStartupFailureMessage(report: Awaited<ReturnType<typeof getWebReadinessReport>>): string {
  return report.checks
    .filter((check) => check.status === "fail")
    .map((check) => `${check.name}: ${check.message}`)
    .join("\n");
}

async function main() {
  const report = await getWebReadinessReport();

  if (!report.ok) {
    throw new Error(buildStartupFailureMessage(report));
  }

  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "start", ...process.argv.slice(2)], {
    cwd: path.join(process.cwd(), "apps", "web"),
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
  console.error(error instanceof Error ? error.message : "Web startup validation failed.");
  process.exitCode = 1;
});

