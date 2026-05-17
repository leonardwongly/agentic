import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  ISSUE_THEME_TAXONOMY,
  buildIssueThemeGatePlan,
  renderIssueThemeGatePlan,
  validateIssueThemeTaxonomy
} from "./lib/issue-theme-gates";

type ParsedArgs = {
  themes: string[];
  labels: string[];
  titles: string[];
  changedFiles: string[];
  baseRef?: string;
  fromGit: boolean;
  list: boolean;
  json: boolean;
  assertWorkflow: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    themes: [],
    labels: [],
    titles: [],
    changedFiles: [],
    fromGit: false,
    list: false,
    json: false,
    assertWorkflow: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    switch (argument) {
      case "--theme":
      case "--label":
      case "--title":
      case "--changed-file":
      case "--base-ref": {
        const next = argv[index + 1];
        if (!next) {
          throw new Error(`${argument} requires a value.`);
        }

        if (argument === "--theme") {
          parsed.themes.push(next);
        } else if (argument === "--label") {
          parsed.labels.push(next);
        } else if (argument === "--title") {
          parsed.titles.push(next);
        } else if (argument === "--changed-file") {
          parsed.changedFiles.push(next);
        } else {
          parsed.baseRef = next;
        }

        index += 1;
        break;
      }
      case "--from-git":
        parsed.fromGit = true;
        break;
      case "--list":
        parsed.list = true;
        break;
      case "--json":
        parsed.json = true;
        break;
      case "--assert-workflow":
        parsed.assertWorkflow = true;
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

async function listChangedFilesFromGit(repoRoot: string, baseRef?: string): Promise<string[]> {
  const base = baseRef?.trim() || process.env.GITHUB_BASE_REF?.trim() || "origin/main";
  const mergeBase = await runGit(["merge-base", "HEAD", base], { cwd: repoRoot });
  const output = await runGit(["diff", "--name-only", "--diff-filter=ACDMRT", `${mergeBase}..HEAD`], {
    cwd: repoRoot
  });
  const statusOutput = await runGit(["status", "--porcelain"], { cwd: repoRoot });
  const statusFiles = statusOutput
    ? statusOutput
        .split("\n")
        .map(line => line.slice(3).trim())
        .filter(Boolean)
        .map(file => file.replace(/^.* -> /u, ""))
    : [];

  return Array.from(new Set([...(output ? output.split("\n").filter(Boolean) : []), ...statusFiles]));
}

function assertWorkflowCoverage(repoRoot: string): string[] {
  const requiredWorkflowPaths = [".github/workflows/ci.yml", ".github/workflows/staging-manual-deploy.yml"];
  const errors: string[] = [];

  for (const workflowPath of requiredWorkflowPaths) {
    const workflow = readFileSync(path.resolve(repoRoot, workflowPath), "utf8");
    if (!workflow.includes("npm run ci:issue-theme-gates")) {
      errors.push(`${workflowPath} must run npm run ci:issue-theme-gates.`);
    }
  }

  return errors;
}

async function main() {
  const repoRoot = (await runGit(["rev-parse", "--show-toplevel"], { cwd: process.cwd() })).trim();
  const parsed = parseArgs(process.argv.slice(2));
  const changedFiles = [
    ...parsed.changedFiles,
    ...(parsed.fromGit ? await listChangedFilesFromGit(repoRoot, parsed.baseRef) : [])
  ];
  const taxonomyErrors = validateIssueThemeTaxonomy({ packageJsonPath: path.resolve(repoRoot, "package.json") });
  const workflowErrors = parsed.assertWorkflow ? assertWorkflowCoverage(repoRoot) : [];
  const errors = [...taxonomyErrors, ...workflowErrors];

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  if (parsed.list) {
    const payload = {
      themes: ISSUE_THEME_TAXONOMY.map(theme => ({
        id: theme.id,
        title: theme.title,
        ciShard: theme.ciShard,
        gates: theme.gateIds
      }))
    };

    console.log(parsed.json ? JSON.stringify(payload, null, 2) : payload.themes.map(theme => `${theme.id}: ${theme.title}`).join("\n"));
    return;
  }

  const plan = buildIssueThemeGatePlan({
    explicitThemes: parsed.themes,
    labels: parsed.labels,
    titles: parsed.titles,
    changedFiles
  });

  if (parsed.json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  console.log(renderIssueThemeGatePlan(plan));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Failed to resolve issue-theme validation gates.");
  process.exitCode = 1;
});
