import fs from "node:fs";
import { spawn } from "node:child_process";

import {
  buildParallelWorktreePlan,
  parseParallelWorktreeArgs,
  renderParallelWorktreeStatus
} from "./lib/parallel-worktrees";

function runGit(args: string[], options?: { cwd?: string }) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: options?.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", chunk => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", chunk => {
      stderr += String(chunk);
    });

    child.once("error", reject);
    child.once("exit", code => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `git ${args.join(" ")} exited with status ${code}.`));
        return;
      }

      resolve(stdout.trim());
    });
  });
}

async function main() {
  const repoRoot = (await runGit(["rev-parse", "--show-toplevel"], { cwd: process.cwd() })).trim();
  const parsed = parseParallelWorktreeArgs(process.argv.slice(2), { cwd: repoRoot });
  const plan = buildParallelWorktreePlan({
    repoRoot,
    worktreeRoot: parsed.worktreeRoot,
    baseBranch: parsed.baseBranch,
    branchPrefix: parsed.branchPrefix,
    includeSpine: parsed.includeSpine
  });

  const statuses = [];

  for (const stream of plan.streams) {
    if (!fs.existsSync(stream.path)) {
      statuses.push({
        id: stream.id,
        exists: false,
        branch: stream.branch
      });
      continue;
    }

    const [branch, head, dirtyOutput] = await Promise.all([
      runGit(["branch", "--show-current"], { cwd: stream.path }),
      runGit(["rev-parse", "--short", "HEAD"], { cwd: stream.path }),
      runGit(["status", "--short"], { cwd: stream.path })
    ]);

    statuses.push({
      id: stream.id,
      exists: true,
      branch,
      head,
      dirtyFiles: dirtyOutput ? dirtyOutput.split("\n").filter(Boolean).length : 0
    });
  }

  if (parsed.json) {
    console.log(
      JSON.stringify(
        {
          repoRoot: plan.repoRoot,
          baseBranch: plan.baseBranch,
          worktreeRoot: plan.worktreeRoot,
          streams: statuses
        },
        null,
        2
      )
    );
    return;
  }

  console.log(renderParallelWorktreeStatus(plan, statuses));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Failed to inspect worktree status.");
  process.exitCode = 1;
});
