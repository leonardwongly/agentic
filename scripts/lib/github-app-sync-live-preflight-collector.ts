import { spawn } from "node:child_process";
import {
  redactGitHubAppSyncLivePreflightReport,
  validateGitHubAppSyncLivePreflight,
  type GitHubAppSyncLivePreflightReport
} from "./github-app-sync-live-preflight";

export type GitHubAppSyncLivePreflightCollectionStatus = "collected" | "collected_with_command_failure" | "failed";

export type GitHubAppSyncLivePreflightCollectionStep = {
  name: string;
  envName: string;
  status: GitHubAppSyncLivePreflightCollectionStatus;
  message: string;
  exitCode: number | null;
};

export type GitHubAppSyncLivePreflightCollectionReport = {
  ok: boolean;
  collection: GitHubAppSyncLivePreflightCollectionStep[];
  preflight: GitHubAppSyncLivePreflightReport;
};

export type GitHubAppSyncLivePreflightCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: Error;
};

export type GitHubAppSyncLivePreflightCommandRunner = (
  command: string,
  args: string[]
) => Promise<GitHubAppSyncLivePreflightCommandResult>;

type CollectionCommand = {
  name: string;
  envName: string;
  command: string;
  args: string[];
};

const COLLECTION_COMMANDS: CollectionCommand[] = [
  {
    name: "workflow_state",
    envName: "AGENTIC_GITHUB_APP_SYNC_WORKFLOW_STATE",
    command: "gh",
    args: ["api", "repos/leonardwongly/agentic/actions/workflows/github-app-issue-sync.yml", "--jq", ".state"]
  },
  {
    name: "sync_url",
    envName: "AGENTIC_GITHUB_APP_ISSUE_SYNC_URL",
    command: "gh",
    args: ["variable", "get", "AGENTIC_GITHUB_APP_ISSUE_SYNC_URL", "--repo", "leonardwongly/agentic"]
  },
  {
    name: "github_actions_secret_inventory",
    envName: "AGENTIC_GITHUB_ACTIONS_SECRETS_JSON",
    command: "gh",
    args: ["secret", "list", "--repo", "leonardwongly/agentic", "--json", "name"]
  },
  {
    name: "render_services",
    envName: "AGENTIC_RENDER_SERVICES_JSON",
    command: "render",
    args: ["services", "list", "--output", "json"]
  },
  {
    name: "render_blueprint",
    envName: "AGENTIC_RENDER_BLUEPRINT_VALIDATION_JSON",
    command: "render",
    args: ["blueprints", "validate", "deploy/render/render.yaml", "--output", "json"]
  }
];

export function runGitHubAppSyncLivePreflightCommand(
  command: string,
  args: string[]
): Promise<GitHubAppSyncLivePreflightCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", (error) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode: null,
        error
      });
    });
    child.on("close", (exitCode) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode
      });
    });
  });
}

function buildCollectionStep(command: CollectionCommand, result: GitHubAppSyncLivePreflightCommandResult) {
  const stdout = result.stdout.trim();

  if (!stdout) {
    return {
      envValue: null,
      step: {
        name: command.name,
        envName: command.envName,
        status: "failed" as const,
        message: result.error
          ? `Could not run ${command.command}; install/authenticate the CLI before live preflight.`
          : `No ${command.envName} evidence was collected from ${command.command}.`,
        exitCode: result.exitCode
      }
    };
  }

  return {
    envValue: stdout,
    step: {
      name: command.name,
      envName: command.envName,
      status: result.exitCode === 0 ? ("collected" as const) : ("collected_with_command_failure" as const),
      message:
        result.exitCode === 0
          ? `Collected ${command.envName} from ${command.command}.`
          : `Collected ${command.envName} from ${command.command} output, but the command exited non-zero.`,
      exitCode: result.exitCode
    }
  };
}

export async function collectGitHubAppSyncLivePreflight(
  env: NodeJS.ProcessEnv = process.env,
  runCommand: GitHubAppSyncLivePreflightCommandRunner = runGitHubAppSyncLivePreflightCommand
): Promise<GitHubAppSyncLivePreflightCollectionReport> {
  const collectedEnv: NodeJS.ProcessEnv = { ...env };
  const collection: GitHubAppSyncLivePreflightCollectionStep[] = [];

  for (const command of COLLECTION_COMMANDS) {
    const result = await runCommand(command.command, command.args);
    const { envValue, step } = buildCollectionStep(command, result);

    collection.push(step);

    if (envValue) {
      collectedEnv[command.envName] = envValue;
    }
  }

  const preflight = redactGitHubAppSyncLivePreflightReport(validateGitHubAppSyncLivePreflight(collectedEnv));

  return {
    ok: preflight.ok && collection.every((step) => step.status !== "failed"),
    collection,
    preflight
  };
}

