import { spawn } from "node:child_process";

const DEFAULT_DEPLOY_TIMEOUT_MS = 20 * 60 * 1000;
const MAX_COMMAND_LENGTH = 200;
const MAX_ARG_LENGTH = 2_000;
const MAX_ARG_COUNT = 64;
const ALLOWED_DEPLOY_COMMANDS = new Set(["node", "npm", "npx", "render", "flyctl", "railway", "netlify"]);
const DEPLOY_ENV_EXACT_ALLOWLIST = new Set([
  "CI",
  "HOME",
  "PATH",
  "TMPDIR",
  "RUNNER_TEMP",
  "NODE_ENV",
  "NODE_OPTIONS",
  "NPM_CONFIG_CACHE"
]);
const DEPLOY_ENV_PREFIX_ALLOWLIST = [
  "AGENTIC_",
  "STAGING_",
  "GITHUB_",
  "RENDER_",
  "FLY_",
  "RAILWAY_",
  "NETLIFY_",
  "CLOUDFLARE_",
  "CF_",
  "AWS_",
  "AZURE_",
  "GOOGLE_",
  "GCP_"
] as const;

export type ProviderDeployConfig = {
  command: string;
  args: string[];
};

function assertSafeCommandSegment(value: string, label: string, maxLength: number) {
  if (!value.trim()) {
    throw new Error(`${label} must not be empty.`);
  }

  if (value.length > maxLength) {
    throw new Error(`${label} must be at most ${maxLength} characters.`);
  }

  if (value.includes("\u0000")) {
    throw new Error(`${label} must not contain null bytes.`);
  }
}

function assertAllowedDeployCommand(command: string) {
  if (command.includes("/") || command.includes("\\")) {
    throw new Error("AGENTIC_STAGING_DEPLOY_BIN must be a supported command name without path separators.");
  }

  if (!ALLOWED_DEPLOY_COMMANDS.has(command)) {
    throw new Error("AGENTIC_STAGING_DEPLOY_BIN must name a supported deploy command.");
  }
}

export function parseProviderDeployConfig(env: NodeJS.ProcessEnv, options?: { requireConfig?: boolean }): ProviderDeployConfig | null {
  const command = env.AGENTIC_STAGING_DEPLOY_BIN?.trim() ?? "";
  const rawArgs = env.AGENTIC_STAGING_DEPLOY_ARGS_JSON?.trim() ?? "";
  const requireConfig = options?.requireConfig ?? false;

  if (!command) {
    if (!requireConfig && !rawArgs) {
      return null;
    }

    throw new Error("AGENTIC_STAGING_DEPLOY_BIN must be configured.");
  }

  assertSafeCommandSegment(command, "AGENTIC_STAGING_DEPLOY_BIN", MAX_COMMAND_LENGTH);
  assertAllowedDeployCommand(command);

  let args: string[] = [];

  if (rawArgs) {
    let parsed: unknown;

    try {
      parsed = JSON.parse(rawArgs);
    } catch {
      throw new Error("AGENTIC_STAGING_DEPLOY_ARGS_JSON must be valid JSON.");
    }

    if (!Array.isArray(parsed)) {
      throw new Error("AGENTIC_STAGING_DEPLOY_ARGS_JSON must decode to a JSON array.");
    }

    if (parsed.length > MAX_ARG_COUNT) {
      throw new Error(`AGENTIC_STAGING_DEPLOY_ARGS_JSON must contain at most ${MAX_ARG_COUNT} arguments.`);
    }

    args = parsed.map((value, index) => {
      if (typeof value !== "string") {
        throw new Error(`AGENTIC_STAGING_DEPLOY_ARGS_JSON[${index}] must be a string.`);
      }

      assertSafeCommandSegment(value, `AGENTIC_STAGING_DEPLOY_ARGS_JSON[${index}]`, MAX_ARG_LENGTH);
      return value;
    });
  }

  return {
    command,
    args
  };
}

export function buildProviderDeployEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      continue;
    }

    if (
      DEPLOY_ENV_EXACT_ALLOWLIST.has(key) ||
      DEPLOY_ENV_PREFIX_ALLOWLIST.some((prefix) => key.startsWith(prefix))
    ) {
      result[key] = value;
    }
  }

  return result;
}

export function parseDeployTimeoutMs(env: NodeJS.ProcessEnv): number {
  const configured = env.AGENTIC_STAGING_DEPLOY_TIMEOUT_MS?.trim();

  if (!configured) {
    return DEFAULT_DEPLOY_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(configured, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("AGENTIC_STAGING_DEPLOY_TIMEOUT_MS must be a positive integer when configured.");
  }

  return parsed;
}

export async function runProviderDeployCommand(
  config: ProviderDeployConfig,
  options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  }
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_DEPLOY_TIMEOUT_MS;

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Provider deploy timeout must be a positive integer.");
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(config.command, config.args, {
      cwd: options?.cwd,
      env: options?.env,
      stdio: "inherit",
      shell: false
    });

    let settled = false;
    let forcedKillTimer: NodeJS.Timeout | null = null;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      child.kill("SIGTERM");
      forcedKillTimer = setTimeout(() => {
        if (!settled) {
          child.kill("SIGKILL");
        }
      }, 5_000);
    }, timeoutMs);

    const cleanup = () => {
      settled = true;
      clearTimeout(timeout);

      if (forcedKillTimer) {
        clearTimeout(forcedKillTimer);
      }
    };

    child.once("error", (error) => {
      cleanup();
      reject(error);
    });

    child.once("exit", (code, signal) => {
      cleanup();

      if (signal) {
        reject(new Error(`Provider deploy command was terminated by ${signal}.`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`Provider deploy command exited with status ${code}.`));
        return;
      }

      resolve();
    });
  });
}
