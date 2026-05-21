import { spawn } from "node:child_process";
import {
  buildGitHubIssueSyncCompletionAudit,
  githubIssueSyncCompletionAuditTrackedIssues,
  type GitHubIssueSyncCompletionAuditReport,
  type GitHubIssueSyncCompletionIssueState
} from "./lib/github-issues-completion-audit";
import { collectGitHubAppSyncLivePreflight } from "./lib/github-app-sync-live-preflight-collector";

type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: Error;
};

function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", (error) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode: null,
        error
      });
    });
    child.on("close", (exitCode) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode
      });
    });
  });
}

function parseIssueState(raw: string): GitHubIssueSyncCompletionIssueState {
  const parsed = JSON.parse(raw) as Partial<GitHubIssueSyncCompletionIssueState>;

  if (
    typeof parsed.number !== "number" ||
    typeof parsed.state !== "string" ||
    typeof parsed.title !== "string" ||
    !githubIssueSyncCompletionAuditTrackedIssues.includes(parsed.number as GitHubIssueSyncCompletionIssueState["number"])
  ) {
    throw new Error("GitHub issue state response did not match the expected shape.");
  }

  return {
    number: parsed.number as GitHubIssueSyncCompletionIssueState["number"],
    state: parsed.state,
    title: parsed.title
  };
}

async function collectIssueStates(): Promise<GitHubIssueSyncCompletionIssueState[]> {
  const issues: GitHubIssueSyncCompletionIssueState[] = [];

  for (const issue of githubIssueSyncCompletionAuditTrackedIssues) {
    const result = await runCommand("gh", [
      "issue",
      "view",
      String(issue),
      "--repo",
      "leonardwongly/agentic",
      "--json",
      "number,state,title"
    ]);

    if (result.exitCode !== 0 || !result.stdout.trim()) {
      throw new Error(
        result.error
          ? `Could not run gh to collect issue #${issue}; install/authenticate GitHub CLI first.`
          : `Could not collect issue #${issue} state from GitHub CLI.`
      );
    }

    issues.push(parseIssueState(result.stdout));
  }

  return issues;
}

function printHumanSummary(report: GitHubIssueSyncCompletionAuditReport) {
  console.log(report.ok ? "GitHub issue-sync completion audit passed." : "GitHub issue-sync completion audit failed.");
  console.log(`Checked issues: ${report.summary.checkedIssues}`);
  console.log(`Passed criteria: ${report.summary.passedCriteria}`);
  console.log(`Failed criteria: ${report.summary.failedCriteria}`);

  for (const criterion of report.criteria) {
    console.log(`- [${criterion.status}] #${criterion.issue}: ${criterion.requirement}`);
    for (const evidence of criterion.evidence) {
      console.log(`  - ${evidence}`);
    }
  }
}

async function main() {
  const json = process.argv.includes("--json");
  const [issues, preflight] = await Promise.all([collectIssueStates(), collectGitHubAppSyncLivePreflight(process.env)]);
  const report = buildGitHubIssueSyncCompletionAudit({ issues, preflight });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanSummary(report);
  }

  if (!report.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "GitHub issue-sync completion audit failed.");
  process.exitCode = 1;
});
