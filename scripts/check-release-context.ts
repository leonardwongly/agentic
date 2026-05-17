import { spawnSync } from "node:child_process";

import { checkReleaseContext } from "./lib/engineering-hygiene";

function git(args: string[], options?: { allowFailure?: boolean }) {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false
  });

  if (result.status !== 0 && !options?.allowFailure) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed.`);
  }

  return result.stdout.trim();
}

function tryGit(args: string[]) {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false
  });

  return result.status === 0 ? result.stdout.trim() : "";
}

function splitLines(output: string) {
  return output.split("\n").map(line => line.trim()).filter(Boolean);
}

function resolveDiffBase() {
  for (const candidate of ["origin/main", "main", "HEAD^1"]) {
    const output = tryGit(["merge-base", "HEAD", candidate]);
    if (output) {
      return output;
    }
  }

  return "";
}

const base = resolveDiffBase();
const committedFiles = base ? splitLines(git(["diff", "--name-only", "--diff-filter=ACDMRT", `${base}..HEAD`])) : [];
const stagedFiles = splitLines(git(["diff", "--cached", "--name-only", "--diff-filter=ACDMRT"]));
const changedFiles = splitLines(git(["diff", "--name-only", "--diff-filter=ACDMRT"]));
const untrackedFiles = splitLines(git(["ls-files", "--others", "--exclude-standard"]));
const candidatePaths = Array.from(new Set([...committedFiles, ...stagedFiles, ...changedFiles, ...untrackedFiles]));
const issues = checkReleaseContext(candidatePaths);

if (issues.length > 0) {
  console.error("Release-context check failed:");
  for (const issue of issues) {
    console.error(`- ${issue.path}: ${issue.message}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Release-context check passed for ${candidatePaths.length} changed and local paths.`);
}
