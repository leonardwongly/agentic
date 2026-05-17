export type LocalCiMode = "fast" | "full";

export type LocalCiPlanOptions = {
  mode?: LocalCiMode;
  skipInstall?: boolean;
  noE2e?: boolean;
  withPostgres?: boolean;
  keepPostgres?: boolean;
  branchName?: string;
  databaseUrl?: string;
};

export type LocalCiCommandStep = {
  kind: "command";
  id: string;
  title: string;
  command: string;
  args: string[];
};

export type LocalCiBuiltinStep = {
  kind: "builtin";
  id: string;
  title: string;
  action: "ensure-artifact-directories" | "start-postgres" | "package-build-artifacts";
};

export type LocalCiStep = LocalCiCommandStep | LocalCiBuiltinStep;

export type LocalCiSkippedStep = {
  id: string;
  title: string;
  reason: string;
};

export type LocalCiPlan = {
  mode: LocalCiMode;
  env: Record<string, string>;
  steps: LocalCiStep[];
  skipped: LocalCiSkippedStep[];
  managesPostgres: boolean;
  keepPostgres: boolean;
};

const DEFAULT_DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:5432/agentic";

function npmRun(script: string, args: string[] = []): LocalCiCommandStep {
  return {
    kind: "command",
    id: script.replaceAll(":", "-"),
    title: `npm run ${script}`,
    command: "npm",
    args: ["run", script, ...args]
  };
}

function npx(command: string, args: string[] = []): LocalCiCommandStep {
  return {
    kind: "command",
    id: command.replaceAll(":", "-"),
    title: `npx ${command}`,
    command: "npx",
    args: [command, ...args]
  };
}

function command(id: string, title: string, commandName: string, args: string[]): LocalCiCommandStep {
  return {
    kind: "command",
    id,
    title,
    command: commandName,
    args
  };
}

function builtin(
  id: LocalCiBuiltinStep["id"],
  title: string,
  action: LocalCiBuiltinStep["action"]
): LocalCiBuiltinStep {
  return {
    kind: "builtin",
    id,
    title,
    action
  };
}

export function buildLocalCiPlan(options: LocalCiPlanOptions = {}): LocalCiPlan {
  const mode = options.mode ?? "fast";
  const steps: LocalCiStep[] = [];
  const env: Record<string, string> = {
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_ENV: "test",
    NODE_OPTIONS: "--max-old-space-size=4096",
    AGENTIC_ACCESS_KEY: "ci-access-key"
  };
  const skipped: LocalCiSkippedStep[] = [
    {
      id: "dependency-review-action",
      title: "GitHub dependency-review action",
      reason: "Requires GitHub pull_request context and GHAS-backed dependency review."
    },
    {
      id: "upload-artifact",
      title: "GitHub artifact upload",
      reason: "Local CI writes artifacts under artifacts/ instead of uploading them to GitHub."
    },
    {
      id: "attestations",
      title: "GitHub provenance attestations",
      reason: "Requires GitHub OIDC and attestations APIs."
    }
  ];

  if (!options.skipInstall) {
    steps.push(command("npm-ci", "Install dependencies", "npm", ["ci"]));
  }

  steps.push(npmRun("ci:validate-provenance"));
  steps.push(npmRun("ci:issue-theme-gates", ["--", "--assert-workflow"]));
  steps.push(npmRun("compliance:validate-registry"));

  if (mode === "fast") {
    steps.push(npmRun("test:architecture:fitness"));
    steps.push(npmRun("test:performance:fitness"));
    steps.push(npmRun("test"));
    steps.push(npmRun("build"));
  } else {
    if (!options.withPostgres && !options.databaseUrl) {
      throw new Error("Full local CI requires --with-postgres or DATABASE_URL.");
    }

    env.DATABASE_URL = options.databaseUrl ?? DEFAULT_DATABASE_URL;

    if (options.withPostgres) {
      steps.unshift(builtin("start-postgres", "Start local Postgres service", "start-postgres"));
    }

    steps.push(builtin("ensure-artifact-directories", "Create local CI artifact directories", "ensure-artifact-directories"));
    steps.push(npmRun("security:audit-runtime", ["--", "--minimum-severity", "moderate", "--report", "artifacts/security/runtime-audit-report.json"]));
    steps.push(npmRun("db:check-migrations"));
    steps.push(npmRun("db:migrate"));
    steps.push(npmRun("db:status", ["--", "--require-ready"]));
    steps.push(npmRun("governance:simulate"));
    steps.push(npmRun("test:security:regression"));
    steps.push(npmRun("test"));
    steps.push(npmRun("test:smoke:capabilities"));
    steps.push(npmRun("test:architecture:fitness"));

    if (options.branchName?.startsWith("feat/parallel-")) {
      steps.push(npmRun("test:parallel-worktree:fitness"));
    } else {
      skipped.push({
        id: "test-parallel-worktree-fitness",
        title: "Parallel worktree ownership fitness",
        reason: "GitHub CI only runs this gate for feat/parallel-* branches."
      });
    }

    steps.push(npmRun("test:performance:fitness"));
    steps.push(npmRun("test:smoke:observability"));
    steps.push(npmRun("build"));
    steps.push(npmRun("security:sbom", ["--", "--output", "artifacts/security/agentic-sbom.spdx.json"]));

    if (options.noE2e) {
      skipped.push({
        id: "browser-e2e",
        title: "Browser E2E",
        reason: "Skipped because --no-e2e was provided."
      });
    } else {
      steps.push(npx("playwright", ["install", "--with-deps", "chromium"]));
      steps.push(npmRun("test:e2e"));
    }

    steps.push(command("docker-build", "Build local CI container image", "docker", ["build", "--build-arg", "NODE_OPTIONS=--max-old-space-size=4096", "-t", "agentic-ci:local", "."]));
    steps.push(builtin("package-build-artifacts", "Package deployable build artifacts", "package-build-artifacts"));
    steps.push(npmRun("security:collect-evidence", ["--", "--require-artifacts", "--output-dir", "artifacts/compliance"]));
  }

  return {
    mode,
    env,
    steps,
    skipped,
    managesPostgres: options.withPostgres ?? false,
    keepPostgres: options.keepPostgres ?? false
  };
}

export function formatLocalCiCommand(step: LocalCiCommandStep): string {
  return [step.command, ...step.args].map(part => (/\s/u.test(part) ? JSON.stringify(part) : part)).join(" ");
}
