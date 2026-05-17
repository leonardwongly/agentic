import { spawnSync } from "node:child_process";

import { checkTextFormatting, readTrackedTextFiles } from "./lib/engineering-hygiene";

function git(args: string[]) {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false
  });

  if (result.status !== 0) {
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

function listCandidateFiles() {
  const base = resolveDiffBase();
  const committed = base ? splitLines(git(["diff", "--name-only", "--diff-filter=ACMRT", `${base}..HEAD`])) : [];
  const staged = splitLines(git(["diff", "--cached", "--name-only", "--diff-filter=ACMRT"]));
  const unstaged = splitLines(git(["diff", "--name-only", "--diff-filter=ACMRT"]));
  const untracked = splitLines(git(["ls-files", "--others", "--exclude-standard"]));

  return Array.from(new Set([...committed, ...staged, ...unstaged, ...untracked]));
}

const files = readTrackedTextFiles(process.cwd(), listCandidateFiles());
const issues = checkTextFormatting(files);

if (issues.length > 0) {
  console.error("Format check failed:");
  for (const issue of issues) {
    const location = issue.line ? `${issue.path}:${issue.line}` : issue.path;
    console.error(`- ${location} ${issue.message}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Format check passed for ${files.length} changed text files.`);
}
