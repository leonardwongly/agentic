import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  buildParallelWorktreePlan,
  parseParallelWorktreeArgs,
  renderParallelWorktreePlan
} from "./lib/parallel-worktrees";

function runGit(args: string[], options?: { cwd?: string; capture?: boolean }) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: options?.cwd,
      stdio: options?.capture ? ["ignore", "pipe", "pipe"] : "inherit",
      shell: false
    });

    let stdout = "";
    let stderr = "";

    if (options?.capture) {
      child.stdout?.on("data", chunk => {
        stdout += String(chunk);
      });
      child.stderr?.on("data", chunk => {
        stderr += String(chunk);
      });
    }

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

async function branchExists(repoRoot: string, branch: string) {
  const output = await runGit(["branch", "--list", branch], { cwd: repoRoot, capture: true });
  return output.length > 0;
}

async function main() {
  const repoRoot = (await runGit(["rev-parse", "--show-toplevel"], { cwd: process.cwd(), capture: true })).trim();
  const parsed = parseParallelWorktreeArgs(process.argv.slice(2), { cwd: repoRoot });
  const plan = buildParallelWorktreePlan({
    repoRoot,
    worktreeRoot: parsed.worktreeRoot,
    baseBranch: parsed.baseBranch,
    branchPrefix: parsed.branchPrefix,
    includeSpine: parsed.includeSpine
  });

  if (parsed.printOnly) {
    const output = parsed.json ? JSON.stringify(plan, null, 2) : renderParallelWorktreePlan(plan);
    console.log(output);
    return;
  }

  fs.mkdirSync(plan.worktreeRoot, { recursive: true });

  for (const stream of plan.streams) {
    if (fs.existsSync(stream.path)) {
      throw new Error(`Worktree path already exists: ${stream.path}`);
    }

    if (await branchExists(repoRoot, stream.branch)) {
      throw new Error(`Branch already exists: ${stream.branch}`);
    }
  }

  for (const stream of plan.streams) {
    await runGit(["worktree", "add", "-b", stream.branch, stream.path, plan.baseBranch], { cwd: repoRoot });
  }

  const summary = {
    ok: true,
    repoRoot,
    baseBranch: plan.baseBranch,
    worktreeRoot: plan.worktreeRoot,
    streams: plan.streams.map(stream => ({
      id: stream.id,
      branch: stream.branch,
      path: path.relative(plan.worktreeRoot, stream.path)
    }))
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Failed to create parallel worktrees.");
  process.exitCode = 1;
});
