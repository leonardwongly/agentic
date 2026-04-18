import { spawn } from "node:child_process";

import { evaluateParallelWorktreeProtection } from "./lib/parallel-worktrees";

type ParsedArgs = {
  branch?: string;
  baseBranch?: string;
  branchPrefix?: string;
  changedFiles: string[];
  json: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    changedFiles: [],
    json: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    switch (argument) {
      case "--branch": {
        const next = argv[index + 1];
        if (!next) {
          throw new Error("--branch requires a value.");
        }

        parsed.branch = next;
        index += 1;
        break;
      }
      case "--base-branch": {
        const next = argv[index + 1];
        if (!next) {
          throw new Error("--base-branch requires a value.");
        }

        parsed.baseBranch = next;
        index += 1;
        break;
      }
      case "--branch-prefix": {
        const next = argv[index + 1];
        if (!next) {
          throw new Error("--branch-prefix requires a value.");
        }

        parsed.branchPrefix = next;
        index += 1;
        break;
      }
      case "--changed-file": {
        const next = argv[index + 1];
        if (!next) {
          throw new Error("--changed-file requires a value.");
        }

        parsed.changedFiles.push(next);
        index += 1;
        break;
      }
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return parsed;
}

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

async function gitRefExists(repoRoot: string, revision: string) {
  try {
    await runGit(["rev-parse", "--verify", revision], { cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
}

async function resolveBranchName(repoRoot: string, override?: string) {
  if (override?.trim()) {
    return override.trim();
  }

  const envBranch = process.env.GITHUB_HEAD_REF?.trim() || process.env.GITHUB_REF_NAME?.trim();
  if (envBranch) {
    return envBranch;
  }

  const currentBranch = await runGit(["branch", "--show-current"], { cwd: repoRoot });
  if (currentBranch) {
    return currentBranch;
  }

  throw new Error("Unable to determine the current branch name. Pass --branch explicitly.");
}

async function resolveBaseRevision(repoRoot: string, baseBranch: string) {
  for (const candidate of [baseBranch, `origin/${baseBranch}`]) {
    if (await gitRefExists(repoRoot, candidate)) {
      return candidate;
    }
  }

  throw new Error(`Unable to resolve base branch '${baseBranch}'. Fetch it locally or pass --changed-file.`);
}

async function listChangedFiles(repoRoot: string, branchName: string, baseBranch: string, providedChangedFiles: string[]) {
  if (providedChangedFiles.length > 0 || branchName === baseBranch) {
    return providedChangedFiles;
  }

  if ((process.env.GITHUB_EVENT_NAME === "pull_request" || process.env.GITHUB_HEAD_REF) && (await gitRefExists(repoRoot, "HEAD^1"))) {
    const output = await runGit(["diff", "--name-only", "--diff-filter=ACDMRT", "HEAD^1", "HEAD"], { cwd: repoRoot });
    return output ? output.split("\n").filter(Boolean) : [];
  }

  const baseRevision = await resolveBaseRevision(repoRoot, baseBranch);
  const mergeBase = await runGit(["merge-base", "HEAD", baseRevision], { cwd: repoRoot });
  const output = await runGit(["diff", "--name-only", "--diff-filter=ACDMRT", `${mergeBase}..HEAD`], { cwd: repoRoot });
  return output ? output.split("\n").filter(Boolean) : [];
}

function formatViolationMessage(branchName: string, baseBranch: string, violation: ReturnType<typeof evaluateParallelWorktreeProtection>["violations"][number]) {
  const owners = violation.ownerStreamIds.join(", ");

  switch (violation.reason) {
    case "shared-spine-only":
      return `${violation.file} is a shared protected file owned by ${owners}. Only the spine stream branch or ${baseBranch} may carry this edit, but the current branch is ${branchName}.`;
    case "owned-by-other-stream":
      return `${violation.file} is protected by ${owners}. The current stream branch ${branchName} does not own it.`;
    case "protected-requires-owned-stream":
      return `${violation.file} is protected by ${owners}. Use the owning stream branch or ${baseBranch} for this change.`;
    default:
      return `${violation.file} is protected by ${owners}.`;
  }
}

async function main() {
  const repoRoot = (await runGit(["rev-parse", "--show-toplevel"], { cwd: process.cwd() })).trim();
  const parsed = parseArgs(process.argv.slice(2));
  const branchName = await resolveBranchName(repoRoot, parsed.branch);
  const baseBranch = parsed.baseBranch?.trim() || process.env.GITHUB_BASE_REF?.trim() || "main";
  const changedFiles = await listChangedFiles(repoRoot, branchName, baseBranch, parsed.changedFiles);
  const evaluation = evaluateParallelWorktreeProtection({
    branchName,
    baseBranch,
    branchPrefix: parsed.branchPrefix,
    changedFiles
  });

  if (parsed.json) {
    console.log(JSON.stringify(evaluation, null, 2));
    if (!evaluation.ok) {
      process.exitCode = 1;
    }
    return;
  }

  if (!evaluation.ok) {
    console.error(`Parallel worktree protection violations detected for branch ${branchName}:`);
    for (const violation of evaluation.violations) {
      console.error(`- ${formatViolationMessage(branchName, baseBranch, violation)}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Parallel worktree protection checks passed.");
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Failed to validate parallel worktree protection.");
  process.exitCode = 1;
});
