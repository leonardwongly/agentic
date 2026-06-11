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
  truncatedStream?: "stdout" | "stderr";
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

const GITHUB_REPOSITORY_FULL_NAME_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

function resolveGitHubRepositoryFullName(env: NodeJS.ProcessEnv): string | null {
  const configured = env.AGENTIC_REPOSITORY?.trim() || env.GITHUB_REPOSITORY?.trim();
  return configured && GITHUB_REPOSITORY_FULL_NAME_PATTERN.test(configured) ? configured : null;
}

function buildCollectionCommands(env: NodeJS.ProcessEnv): CollectionCommand[] {
  const repository = resolveGitHubRepositoryFullName(env);
  const commands: CollectionCommand[] = [];

  if (repository) {
    commands.push(
      {
        name: "workflow_state",
        envName: "AGENTIC_GITHUB_APP_SYNC_WORKFLOW_STATE",
        command: "gh",
        args: ["api", `repos/${repository}/actions/workflows/github-app-issue-sync.yml`, "--jq", ".state"]
      },
      {
        name: "sync_url",
        envName: "AGENTIC_GITHUB_APP_ISSUE_SYNC_URL",
        command: "gh",
        args: ["variable", "get", "AGENTIC_GITHUB_APP_ISSUE_SYNC_URL", "--repo", repository]
      },
      {
        name: "github_actions_secret_inventory",
        envName: "AGENTIC_GITHUB_ACTIONS_SECRETS_JSON",
        command: "gh",
        args: ["secret", "list", "--repo", repository, "--json", "name"]
      }
    );
  }

  commands.push(
    {
      name: "cloudflare_provider_evidence",
      envName: "AGENTIC_DEPLOYMENT_PROVIDER_EVIDENCE_JSON",
      command: "npm",
      args: ["run", "--silent", "cloudflare:provider-evidence"]
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
  );

  return commands;
}
const MAX_COMMAND_OUTPUT_BYTES = 1_048_576;
const RENDER_COLLECTION_STEP_NAMES = new Set(["render_services", "render_blueprint"]);

export function runGitHubAppSyncLivePreflightCommand(
  command: string,
  args: string[]
): Promise<GitHubAppSyncLivePreflightCommandResult> {
  return new Promise((resolve) => {
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let truncatedStream: "stdout" | "stderr" | undefined;
    let settled = false;
    const child = spawn(command, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const appendChunk = (stream: "stdout" | "stderr", chunk: Buffer) => {
      if (truncatedStream) {
        return;
      }

      const currentBytes = stream === "stdout" ? stdoutBytes : stderrBytes;
      const remainingBytes = MAX_COMMAND_OUTPUT_BYTES - currentBytes;

      if (remainingBytes <= 0 || chunk.length > remainingBytes) {
        truncatedStream = stream;

        if (remainingBytes > 0) {
          const partialChunk = chunk.subarray(0, remainingBytes);
          if (stream === "stdout") {
            stdoutChunks.push(partialChunk);
            stdoutBytes += partialChunk.length;
          } else {
            stderrChunks.push(partialChunk);
            stderrBytes += partialChunk.length;
          }
        }

        child.kill("SIGTERM");
        return;
      }

      if (stream === "stdout") {
        stdoutChunks.push(chunk);
        stdoutBytes += chunk.length;
      } else {
        stderrChunks.push(chunk);
        stderrBytes += chunk.length;
      }
    };
    const resolveOnce = (result: GitHubAppSyncLivePreflightCommandResult) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(result);
    };

    child.stdout.on("data", (chunk: Buffer) => appendChunk("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => appendChunk("stderr", chunk));
    child.on("error", (error) => {
      resolveOnce({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode: null,
        error,
        truncatedStream
      });
    });
    child.on("close", (exitCode) => {
      resolveOnce({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode,
        truncatedStream
      });
    });
  });
}

function buildCollectionStep(command: CollectionCommand, result: GitHubAppSyncLivePreflightCommandResult) {
  const stdout = result.stdout.trim();

  if (result.truncatedStream) {
    return {
      envValue: null,
      step: {
        name: command.name,
        envName: command.envName,
        status: "failed" as const,
        message: `${command.command} ${result.truncatedStream} exceeded ${MAX_COMMAND_OUTPUT_BYTES} bytes; live preflight evidence must be bounded and complete.`,
        exitCode: result.exitCode
      }
    };
  }

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
  const collectionCommands = buildCollectionCommands(env);

  if (!resolveGitHubRepositoryFullName(env)) {
    collection.push({
      name: "repository",
      envName: "AGENTIC_REPOSITORY",
      status: "failed",
      message:
        "Set AGENTIC_REPOSITORY to the target GitHub repository full name, for example `<your-org>/<your-repo>`, before collecting GitHub App sync evidence.",
      exitCode: null
    });
  }

  for (const command of collectionCommands) {
    const result = await runCommand(command.command, command.args);
    const { envValue, step } = buildCollectionStep(command, result);

    collection.push(step);

    if (envValue) {
      collectedEnv[command.envName] = envValue;
    }
  }

  const preflight = redactGitHubAppSyncLivePreflightReport(validateGitHubAppSyncLivePreflight(collectedEnv));

  return {
    ok:
      preflight.ok &&
      collection.every((step) => step.status !== "failed" || RENDER_COLLECTION_STEP_NAMES.has(step.name)),
    collection,
    preflight
  };
}
