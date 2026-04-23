import { appendFile } from "node:fs/promises";
import { resolveStagingExecutionPlan } from "./lib/staging-execution-plan";

async function appendGithubEnv(entries: Record<string, string>) {
  const target = process.env.GITHUB_ENV?.trim();

  if (!target) {
    return;
  }

  const lines = Object.entries(entries).map(([key, value]) => `${key}=${value}`);
  await appendFile(target, `${lines.join("\n")}\n`, "utf8");
}

async function appendGithubOutput(plan: ReturnType<typeof resolveStagingExecutionPlan>) {
  const target = process.env.GITHUB_OUTPUT?.trim();

  if (!target) {
    return;
  }

  const lines = [
    `mode=${plan.mode}`,
    `missing_external=${plan.missingExternalConfig.join(",")}`
  ];
  await appendFile(target, `${lines.join("\n")}\n`, "utf8");
}

async function main() {
  const plan = resolveStagingExecutionPlan(process.env);

  if (plan.mode === "self-test") {
    await appendGithubEnv(plan.injectedEnv);
  }

  await appendGithubOutput(plan);

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: plan.mode,
        missingExternalConfig: plan.missingExternalConfig
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Failed to resolve staging execution plan.");
  process.exitCode = 1;
});
