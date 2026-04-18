import fs from "node:fs";
import { spawn } from "node:child_process";

import {
  buildParallelWorktreePlan,
  parseParallelWorktreeCleanupArgs
} from "./lib/parallel-worktrees";

type CleanupStatus = {
  id: string;
  path: string;
  branch: string;
  worktreeExists: boolean;
  dirtyFiles: number;
  branchExists: boolean;
  branchMergedIntoBase: boolean;
};

function runGit(args: string[], options?: { cwd?: string; allowExitCodes?: number[] }) {
  return new Promise<{ stdout: string; code: number }>((resolve, reject) => {
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
      const exitCode = code ?? 1;
      if (exitCode !== 0 && !(options?.allowExitCodes ?? []).includes(exitCode)) {
        reject(new Error(stderr.trim() || `git ${args.join(" ")} exited with status ${exitCode}.`));
        return;
      }

      resolve({
        stdout: stdout.trim(),
        code: exitCode
      });
    });
  });
}

async function branchExists(repoRoot: string, branch: string) {
  const output = await runGit(["branch", "--list", branch], { cwd: repoRoot });
  return output.stdout.length > 0;
}

async function resolveBaseRevision(repoRoot: string, baseBranch: string) {
  for (const candidate of [baseBranch, `origin/${baseBranch}`]) {
    const result = await runGit(["rev-parse", "--verify", candidate], {
      cwd: repoRoot,
      allowExitCodes: [128]
    });
    if (result.code === 0) {
      return candidate;
    }
  }

  throw new Error(`Unable to resolve base branch '${baseBranch}' for cleanup safety checks.`);
}

async function branchMergedIntoBase(repoRoot: string, branch: string, baseRevision: string) {
  const result = await runGit(["branch", "--merged", baseRevision, "--list", branch], { cwd: repoRoot });
  return result.stdout.length > 0;
}

function renderCleanupPlan(baseBranch: string, statuses: CleanupStatus[], keepBranches: boolean) {
  const lines = [`Base branch: ${baseBranch}`, `Keep branches: ${keepBranches ? "yes" : "no"}`, ""];

  for (const status of statuses) {
    lines.push(
      `${status.id.padEnd(12)} worktree=${status.worktreeExists ? "remove" : "skip"} dirty=${status.dirtyFiles} branch=${
        keepBranches ? "keep" : status.branchExists ? (status.branchMergedIntoBase ? "delete" : "blocked") : "skip"
      }`
    );
  }

  return lines.join("\n");
}

async function main() {
  const repoRoot = (await runGit(["rev-parse", "--show-toplevel"], { cwd: process.cwd() })).stdout.trim();
  const parsed = parseParallelWorktreeCleanupArgs(process.argv.slice(2), { cwd: repoRoot });
  const plan = buildParallelWorktreePlan({
    repoRoot,
    worktreeRoot: parsed.worktreeRoot,
    baseBranch: parsed.baseBranch,
    branchPrefix: parsed.branchPrefix,
    includeSpine: parsed.includeSpine
  });
  const baseRevision = await resolveBaseRevision(repoRoot, plan.baseBranch);
  const currentBranch = (await runGit(["branch", "--show-current"], { cwd: repoRoot })).stdout.trim();
  const statuses: CleanupStatus[] = [];

  for (const stream of plan.streams) {
    const worktreeExists = fs.existsSync(stream.path);
    const dirtyFiles = worktreeExists
      ? (await runGit(["status", "--short"], { cwd: stream.path })).stdout
          .split("\n")
          .filter(Boolean).length
      : 0;
    const hasBranch = await branchExists(repoRoot, stream.branch);
    const merged = hasBranch ? await branchMergedIntoBase(repoRoot, stream.branch, baseRevision) : false;

    statuses.push({
      id: stream.id,
      path: stream.path,
      branch: stream.branch,
      worktreeExists,
      dirtyFiles,
      branchExists: hasBranch,
      branchMergedIntoBase: merged
    });
  }

  if (parsed.printOnly) {
    if (parsed.json) {
      console.log(
        JSON.stringify(
          {
            repoRoot: plan.repoRoot,
            baseBranch: plan.baseBranch,
            keepBranches: parsed.keepBranches,
            streams: statuses
          },
          null,
          2
        )
      );
      return;
    }

    console.log(renderCleanupPlan(plan.baseBranch, statuses, parsed.keepBranches));
    return;
  }

  const blockers = statuses.flatMap(status => {
    const failures: string[] = [];

    if (status.worktreeExists && status.dirtyFiles > 0) {
      failures.push(`${status.id} worktree is dirty: ${status.path}`);
    }

    if (!parsed.keepBranches && status.branchExists && !status.branchMergedIntoBase) {
      failures.push(`${status.id} branch is not merged into ${plan.baseBranch}: ${status.branch}`);
    }

    if (!parsed.keepBranches && currentBranch === status.branch) {
      failures.push(`${status.id} branch is currently checked out in the main repo: ${status.branch}`);
    }

    return failures;
  });

  if (blockers.length > 0) {
    console.error("Cleanup safety checks failed:");
    for (const blocker of blockers) {
      console.error(`- ${blocker}`);
    }
    process.exitCode = 1;
    return;
  }

  for (const status of statuses) {
    if (status.worktreeExists) {
      await runGit(["worktree", "remove", status.path], { cwd: repoRoot });
    }
  }

  if (!parsed.keepBranches) {
    for (const status of statuses) {
      if (status.branchExists) {
        await runGit(["branch", "-d", status.branch], { cwd: repoRoot });
      }
    }
  }

  await runGit(["worktree", "prune"], { cwd: repoRoot });

  console.log(
    JSON.stringify(
      {
        ok: true,
        repoRoot: plan.repoRoot,
        baseBranch: plan.baseBranch,
        keepBranches: parsed.keepBranches,
        removedWorktrees: statuses.filter(status => status.worktreeExists).map(status => status.id),
        deletedBranches: parsed.keepBranches
          ? []
          : statuses.filter(status => status.branchExists).map(status => status.branch)
      },
      null,
      2
    )
  );
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Failed to clean up parallel worktrees.");
  process.exitCode = 1;
});
