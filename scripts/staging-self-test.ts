import { spawn, type ChildProcess } from "node:child_process";
import { runDeploymentSmoke } from "./lib/deployment-smoke";
import { runDeploymentAsyncCanary } from "./lib/deployment-async-canary";

type ManagedChild = {
  name: string;
  child: ChildProcess;
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} must be configured.`);
  }

  return value;
}

function parsePositiveInt(value: string | undefined, fallback: number, label: string): number {
  if (!value?.trim()) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer when configured.`);
  }

  return parsed;
}

function spawnManagedChild(name: string, command: string, args: string[], env: NodeJS.ProcessEnv): ManagedChild {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env,
    stdio: "inherit"
  });

  return {
    name,
    child
  };
}

async function waitForHealthyBaseUrl(baseUrl: string, timeoutMs: number, intervalMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: string | null = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/health`, {
        headers: {
          Accept: "application/json"
        }
      });

      if (response.ok) {
        const payload = (await response.json()) as { status?: string };

        if (payload.status === "live") {
          return;
        }

        lastError = `Health endpoint returned status=${payload.status ?? "unknown"}.`;
      } else {
        lastError = `Health endpoint returned HTTP ${response.status}.`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Unknown startup probe failure.";
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(lastError ? `Local staging stack did not become healthy: ${lastError}` : "Local staging stack did not become healthy.");
}

async function stopManagedChildren(children: ManagedChild[]): Promise<void> {
  for (const { child } of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
  }

  await Promise.all(
    children.map(
      ({ name, child }) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            resolve();
            return;
          }

          const forceKill = setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) {
              child.kill("SIGKILL");
            }
          }, 5_000);

          child.once("exit", () => {
            clearTimeout(forceKill);
            resolve();
          });

          child.once("error", (error) => {
            clearTimeout(forceKill);
            console.error(error instanceof Error ? `${name} shutdown error: ${error.message}` : `${name} shutdown error.`);
            resolve();
          });
        })
    )
  );
}

async function main() {
  const baseUrl = requireEnv("AGENTIC_SMOKE_BASE_URL").replace(/\/+$/, "");
  const accessKey = requireEnv("AGENTIC_SMOKE_ACCESS_KEY");
  const runtimeAccessKey = requireEnv("AGENTIC_ACCESS_KEY");
  const databaseUrl = requireEnv("DATABASE_URL");
  const parsedBaseUrl = new URL(baseUrl);
  const hostname = parsedBaseUrl.hostname;
  const port = parsedBaseUrl.port || (parsedBaseUrl.protocol === "https:" ? "443" : "80");
  const startupTimeoutMs = parsePositiveInt(process.env.AGENTIC_STAGING_SELF_TEST_STARTUP_TIMEOUT_MS, 120_000, "AGENTIC_STAGING_SELF_TEST_STARTUP_TIMEOUT_MS");
  const startupPollIntervalMs = parsePositiveInt(process.env.AGENTIC_STAGING_SELF_TEST_POLL_INTERVAL_MS, 2_000, "AGENTIC_STAGING_SELF_TEST_POLL_INTERVAL_MS");

  if (runtimeAccessKey !== accessKey) {
    throw new Error("AGENTIC_ACCESS_KEY and AGENTIC_SMOKE_ACCESS_KEY must match for the local staging self-test.");
  }

  if (parsedBaseUrl.protocol !== "http:") {
    throw new Error("Runner-local staging self-test only supports http:// loopback URLs.");
  }

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    AGENTIC_ACCESS_KEY: runtimeAccessKey,
    AGENTIC_ALLOW_PROCESS_LOCAL_AUTH_STATE: "true",
    AGENTIC_TRUST_PROXY_HEADERS: "true",
    AGENTIC_TRUSTED_CLIENT_IP_HEADER: "x-forwarded-for",
    AGENTIC_REQUIRE_SHARED_AUTH_STATE: "false",
    NODE_ENV: "production"
  };

  const children: ManagedChild[] = [
    spawnManagedChild("web", "npm", ["run", "start:web:prod", "--", "--hostname", hostname, "--port", port], childEnv),
    spawnManagedChild("worker", "npm", ["run", "start:worker:prod"], childEnv)
  ];

  let childExitError: Error | null = null;

  for (const { name, child } of children) {
    child.once("exit", (code, signal) => {
      if (code === 0 && !signal) {
        return;
      }

      childExitError = new Error(
        signal ? `${name} exited unexpectedly from signal ${signal}.` : `${name} exited unexpectedly with code ${code ?? 0}.`
      );
    });
  }

  try {
    await waitForHealthyBaseUrl(baseUrl, startupTimeoutMs, startupPollIntervalMs);

    if (childExitError) {
      throw childExitError;
    }

    const smokeSummary = await runDeploymentSmoke({
      baseUrl,
      accessKey
    });
    const asyncSummary = await runDeploymentAsyncCanary({
      baseUrl,
      accessKey
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: "self-test",
          smokeSummary,
          asyncSummary
        },
        null,
        2
      )
    );
  } finally {
    await stopManagedChildren(children);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Runner-local staging self-test failed.");
  process.exitCode = 1;
});
