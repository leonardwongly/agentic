import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import {
  buildLocalCiPlan,
  formatLocalCiCommand,
  type LocalCiBuiltinStep,
  type LocalCiCommandStep,
  type LocalCiMode,
  type LocalCiPlan
} from "./lib/local-ci";

type ParsedArgs = {
  mode: LocalCiMode;
  dryRun: boolean;
  json: boolean;
  skipInstall: boolean;
  noE2e: boolean;
  withPostgres: boolean;
  keepPostgres: boolean;
};

const POSTGRES_CONTAINER_NAME = "agentic-local-ci-postgres";

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    mode: "fast",
    dryRun: false,
    json: false,
    skipInstall: false,
    noE2e: false,
    withPostgres: false,
    keepPostgres: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    switch (argument) {
      case "--mode": {
        const mode = argv[index + 1];
        if (mode !== "fast" && mode !== "full") {
          throw new Error("--mode requires fast or full.");
        }
        parsed.mode = mode;
        index += 1;
        break;
      }
      case "--fast":
        parsed.mode = "fast";
        break;
      case "--full":
        parsed.mode = "full";
        break;
      case "--dry-run":
        parsed.dryRun = true;
        break;
      case "--json":
        parsed.json = true;
        break;
      case "--skip-install":
        parsed.skipInstall = true;
        break;
      case "--no-e2e":
        parsed.noE2e = true;
        break;
      case "--with-postgres":
        parsed.withPostgres = true;
        break;
      case "--keep-postgres":
        parsed.keepPostgres = true;
        break;
      case "--help":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`Usage: npm run ci:local -- [options]

Options:
  --fast             Run the fast PR gate. This is the default.
  --full             Run the closest local equivalent of .github/workflows/ci.yml.
  --mode <fast|full> Select the local CI mode.
  --dry-run          Print the plan without executing commands.
  --json             Print the plan as JSON. Implies --dry-run.
  --skip-install     Skip npm ci.
  --no-e2e           Skip Playwright install and browser E2E in --full mode.
  --with-postgres    Start an isolated postgres:16 container for --full mode.
  --keep-postgres    Leave the local CI Postgres container running after completion.
`);
}

function runCommand(step: LocalCiCommandStep, plan: LocalCiPlan): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`\n> ${formatLocalCiCommand(step)}`);

    const child = spawn(step.command, step.args, {
      env: {
        ...process.env,
        ...plan.env
      },
      stdio: "inherit",
      shell: false
    });

    child.once("error", reject);
    child.once("exit", code => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${step.title} failed with exit code ${code}.`));
    });
  });
}

async function runDocker(args: string[]): Promise<void> {
  await runCommand(
    {
      kind: "command",
      id: `docker-${args[0] ?? "command"}`,
      title: `docker ${args.join(" ")}`,
      command: "docker",
      args
    },
    {
      mode: "full",
      env: {},
      steps: [],
      skipped: [],
      managesPostgres: false,
      keepPostgres: false
    }
  );
}

async function startPostgres() {
  await runDocker(["rm", "-f", POSTGRES_CONTAINER_NAME]).catch(() => undefined);
  await runDocker([
    "run",
    "-d",
    "--name",
    POSTGRES_CONTAINER_NAME,
    "-e",
    "POSTGRES_USER=postgres",
    "-e",
    "POSTGRES_PASSWORD=postgres",
    "-e",
    "POSTGRES_DB=agentic",
    "-p",
    "5432:5432",
    "postgres:16"
  ]);

  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await runDocker(["exec", POSTGRES_CONTAINER_NAME, "pg_isready", "-U", "postgres", "-d", "agentic"]);
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  throw new Error("Postgres did not become ready within 60 seconds.");
}

async function runBuiltin(step: LocalCiBuiltinStep) {
  if (step.action === "ensure-artifact-directories") {
    await Promise.all([
      mkdir(path.resolve(process.cwd(), "artifacts/security"), { recursive: true }),
      mkdir(path.resolve(process.cwd(), "artifacts/build"), { recursive: true }),
      mkdir(path.resolve(process.cwd(), "artifacts/compliance"), { recursive: true })
    ]);
    console.log("Created artifacts/security, artifacts/build, and artifacts/compliance.");
    return;
  }

  if (step.action === "start-postgres") {
    await startPostgres();
    return;
  }

  await runCommand(
    {
      kind: "command",
      id: "tar-runtime-bundle",
      title: "Package runtime bundle",
      command: "tar",
      args: [
        "-czf",
        "artifacts/build/agentic-runtime-bundle.tgz",
        "apps/web/.next",
        "apps/web/package.json",
        "apps/worker/package.json",
        "package.json",
        "package-lock.json",
        "packages",
        "scripts"
      ]
    },
    buildLocalCiPlan({ mode: "full" })
  );
  await runDocker(["save", "agentic-ci:local", "-o", "artifacts/build/agentic-image.tar"]);
}

function printPlan(plan: LocalCiPlan, asJson: boolean) {
  if (asJson) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  console.log(`Local CI mode: ${plan.mode}`);
  for (const [key, value] of Object.entries(plan.env)) {
    console.log(`env ${key}=${value}`);
  }

  console.log("\nSteps:");
  plan.steps.forEach((step, index) => {
    const label = `${index + 1}. ${step.title}`;
    if (step.kind === "command") {
      console.log(`${label}: ${formatLocalCiCommand(step)}`);
    } else {
      console.log(`${label}: ${step.action}`);
    }
  });

  if (plan.skipped.length > 0) {
    console.log("\nGitHub-only or skipped steps:");
    for (const skipped of plan.skipped) {
      console.log(`- ${skipped.title}: ${skipped.reason}`);
    }
  }
}

async function runPlan(plan: LocalCiPlan) {
  try {
    for (const step of plan.steps) {
      if (step.kind === "command") {
        await runCommand(step, plan);
      } else {
        await runBuiltin(step);
      }
    }
  } finally {
    if (plan.managesPostgres && !plan.keepPostgres) {
      await runDocker(["rm", "-f", POSTGRES_CONTAINER_NAME]).catch(() => undefined);
    }
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const plan = buildLocalCiPlan({
    mode: parsed.mode,
    skipInstall: parsed.skipInstall,
    noE2e: parsed.noE2e,
    withPostgres: parsed.withPostgres,
    keepPostgres: parsed.keepPostgres,
    branchName: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME,
    databaseUrl: parsed.withPostgres ? undefined : process.env.DATABASE_URL
  });

  if (parsed.dryRun || parsed.json) {
    printPlan(plan, parsed.json);
    return;
  }

  printPlan(plan, false);
  await runPlan(plan);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Local CI failed.");
  process.exitCode = 1;
});
