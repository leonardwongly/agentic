import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

import {
  evaluateRepoHygieneSnapshot,
  type BranchSnapshot,
  type PullRequestSnapshot,
  type WorktreeSnapshot
} from "./lib/engineering-hygiene";

type ParsedArgs = {
  json: boolean;
  maxAgeDays: number;
};

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    json: false,
    maxAgeDays: 21
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    switch (argument) {
      case "--json":
        parsed.json = true;
        break;
      case "--max-age-days": {
        const value = argv[index + 1];
        if (!value || !/^[1-9]\d*$/u.test(value)) {
          throw new Error("--max-age-days requires a positive integer.");
        }
        parsed.maxAgeDays = Number.parseInt(value, 10);
        index += 1;
        break;
      }
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return parsed;
}

function run(command: string, args: string[], options?: { allowFailure?: boolean }) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false
  });

  if (result.status !== 0 && !options?.allowFailure) {
    throw new Error(result.stderr.trim() || `${command} ${args.join(" ")} failed.`);
  }

  return result.stdout.trim();
}

function loadBranches(): BranchSnapshot[] {
  const currentBranch = run("git", ["branch", "--show-current"], { allowFailure: true });
  const merged = new Set(
    run("git", ["branch", "--merged", "origin/main"], { allowFailure: true })
      .split("\n")
      .map(line => line.replace(/^\*\s*/u, "").trim())
      .filter(Boolean)
  );
  const output = run("git", [
    "for-each-ref",
    "--format=%(refname:short)%09%(committerdate:iso8601-strict)",
    "refs/heads"
  ]);

  return output
    .split("\n")
    .filter(Boolean)
    .map(line => {
      const [name = "", lastCommitAt = ""] = line.split("\t");
      return {
        name,
        lastCommitAt,
        current: name === currentBranch,
        protected: name === "main" || name === "master",
        merged: merged.has(name)
      };
    });
}

function loadPullRequests(): PullRequestSnapshot[] {
  const output = run(
    "gh",
    [
      "pr",
      "list",
      "--repo",
      "leonardwongly/agentic",
      "--state",
      "open",
      "--json",
      "number,title,headRefName,updatedAt,state,isDraft"
    ],
    { allowFailure: true }
  );

  if (!output) {
    return [];
  }

  const records = JSON.parse(output) as Array<{
    number: number;
    title: string;
    headRefName: string;
    updatedAt: string;
    state: PullRequestSnapshot["state"];
    isDraft?: boolean;
  }>;

  return records.map(record => ({
    number: record.number,
    title: record.title,
    branch: record.headRefName,
    updatedAt: record.updatedAt,
    state: record.state,
    draft: record.isDraft
  }));
}

function loadWorktrees(): WorktreeSnapshot[] {
  const output = run("git", ["worktree", "list", "--porcelain"]);
  const snapshots: WorktreeSnapshot[] = [];
  let current: Partial<WorktreeSnapshot> = {};

  function flush() {
    if (current.path) {
      snapshots.push({
        path: current.path,
        branch: current.branch ?? "(detached)",
        head: current.head ?? "",
        dirtyFiles: current.exists === false ? 0 : countDirtyFiles(current.path),
        exists: current.exists ?? existsSync(current.path)
      });
    }
    current = {};
  }

  for (const line of output.split("\n")) {
    if (!line.trim()) {
      flush();
      continue;
    }
    if (line.startsWith("worktree ")) {
      current.path = line.slice("worktree ".length);
      current.exists = existsSync(current.path);
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice("branch refs/heads/".length);
    }
  }
  flush();

  return snapshots;
}

function countDirtyFiles(cwd: string) {
  if (!existsSync(cwd)) {
    return 0;
  }

  const output = spawnSync("git", ["status", "--short"], {
    cwd,
    encoding: "utf8",
    shell: false
  });

  if (output.status !== 0) {
    return 0;
  }

  return output.stdout.split("\n").filter(Boolean).length;
}

const parsed = parseArgs(process.argv.slice(2));
const report = evaluateRepoHygieneSnapshot({
  branches: loadBranches(),
  pullRequests: loadPullRequests(),
  worktrees: loadWorktrees(),
  now: new Date(),
  maxAgeDays: parsed.maxAgeDays
});

if (parsed.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Repository hygiene report generated at ${report.generatedAt}`);
  console.log(`Max stale age: ${report.maxAgeDays} days`);
  if (report.findings.length === 0) {
    console.log("No stale branch, stale PR, or dirty worktree findings.");
  } else {
    for (const finding of report.findings) {
      console.log(`${finding.severity.toUpperCase()} ${finding.kind} ${finding.subject}: ${finding.message}`);
    }
  }
}

if (!report.ok) {
  process.exitCode = 1;
}
