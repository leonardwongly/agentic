import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

type ManagedProcess = {
  name: string;
  child: ChildProcess;
};

function spawnManagedProcess(name: string, command: string, args: string[]) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit"
  });

  return {
    name,
    child
  };
}

function existingNextDevLockPaths(): string[] {
  return [path.join(process.cwd(), "apps/web/.next/dev/lock"), path.join(process.cwd(), ".next/dev/lock")].filter((candidate) =>
    existsSync(candidate)
  );
}

function assertNoExistingNextDevServer(mode: "development" | "production") {
  if (mode !== "development") {
    return;
  }

  const lockPaths = existingNextDevLockPaths();

  if (lockPaths.length === 0) {
    return;
  }

  throw new Error(
    [
      "A Next.js development server lock is already present, so the Playwright stack cannot start its own web server safely.",
      "Stop the existing `npm run dev` process before running `npm run test:e2e`, or set PLAYWRIGHT_E2E_PORT to an unused port after the stale lock is removed.",
      `Detected lock path${lockPaths.length === 1 ? "" : "s"}: ${lockPaths.join(", ")}`
    ].join(" ")
  );
}

async function runCommand(name: string, command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit"
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${name} exited from signal ${signal}.`));
        return;
      }

      if ((code ?? 0) !== 0) {
        reject(new Error(`${name} exited with code ${code ?? 0}.`));
        return;
      }

      resolve();
    });

    child.on("error", reject);
  });
}

async function main() {
  const mode = process.env.PLAYWRIGHT_STACK_MODE === "production" ? "production" : "development";
  assertNoExistingNextDevServer(mode);

  if (mode === "production") {
    await runCommand("build", "npm", ["run", "build"]);
  }

  const webArgs =
    mode === "production"
      ? ["run", "start:web:prod", "--", ...process.argv.slice(2)]
      : ["run", "dev", "-w", "@agentic/web", "--", ...process.argv.slice(2)];
  const workerArgs =
    mode === "production"
      ? ["run", "start:worker:prod"]
      : ["run", "worker:start"];

  const children: ManagedProcess[] = [
    spawnManagedProcess("web", "npm", webArgs),
    spawnManagedProcess("worker", "npm", workerArgs)
  ];

  let shuttingDown = false;

  const stopChildren = (signal?: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;

    for (const { child } of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill(signal ?? "SIGTERM");
      }
    }
  };

  process.on("SIGINT", () => stopChildren("SIGINT"));
  process.on("SIGTERM", () => stopChildren("SIGTERM"));

  await new Promise<void>((resolve, reject) => {
    let closedChildren = 0;

    for (const { name, child } of children) {
      child.on("error", (error) => {
        stopChildren();
        reject(error);
      });

      child.on("exit", (code, signal) => {
        closedChildren += 1;

        if (!shuttingDown) {
          stopChildren();

          if (signal) {
            reject(new Error(`${name} exited from signal ${signal}.`));
            return;
          }

          reject(new Error(`${name} exited unexpectedly with code ${code ?? 0}.`));
          return;
        }

        if (closedChildren === children.length) {
          resolve();
        }
      });
    }
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Playwright stack failed.");
  process.exitCode = 1;
});
