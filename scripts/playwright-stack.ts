import { spawn, type ChildProcess } from "node:child_process";

type ManagedProcess = {
  name: string;
  child: ChildProcess;
};

function buildChildEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };

  if (env.FORCE_COLOR) {
    delete env.NO_COLOR;
  }

  if (!env.NODE_OPTIONS?.includes("--no-deprecation")) {
    env.NODE_OPTIONS = [env.NODE_OPTIONS, "--no-deprecation"].filter(Boolean).join(" ");
  }

  return env;
}

function spawnManagedProcess(name: string, command: string, args: string[]) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: buildChildEnv(),
    stdio: "inherit"
  });

  return {
    name,
    child
  };
}

async function runCommand(name: string, command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: buildChildEnv(),
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
