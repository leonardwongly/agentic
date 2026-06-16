import { spawn } from "node:child_process";
import {
  buildGitHubIssueSyncCompletionAudit,
  buildGitHubIssueSyncRemediationPlan,
  githubIssueSyncCompletionAuditTrackedIssues,
  type GitHubIssueSyncCompletionAuditReport,
  type GitHubIssueSyncCompletionIssueState,
  type GitHubIssueSyncCompletionRemediationPlan
} from "./lib/github-issues-completion-audit";
import { collectGitHubAppSyncLivePreflight } from "./lib/github-app-sync-live-preflight-collector";
import {
  DEFAULT_RELEASE_CLOSEOUT_EVIDENCE_PATH,
  readReleaseCloseoutEvidenceManifest,
  validateReleaseCloseoutEvidenceManifest
} from "./lib/release-closeout-evidence";

type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: Error;
};

const HELP_TEXT = `Usage: npm run github:issues:completion-audit -- [--json] [--remediation-plan]

Audits whether the GitHub issue-sync production-proof issue tree is complete.

Live evidence checked:
- GitHub issue states for #141, #142, #143, #144, #145, #146, and #152
- GitHub App sync live preflight collection and checks
- Release closeout evidence manifest

This command fails closed until stable ingress, runtime configuration, deployed provider services, workflow activation, deployment smoke evidence, async worker canary evidence, GitHub App sync canary evidence, and issue closeout are all proven.

Run npm run github:app-sync:preflight:collect -- --json first to inspect the live preflight blockers without closing issues.
Use --remediation-plan to print a deterministic read-only operator checklist derived from failed audit criteria.
Use --local-only with --remediation-plan to show only safe read-only commands and omit provider, GitHub mutation, runtime config, live smoke, and issue-closeout actions.
`;

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
  const repository = process.env.AGENTIC_REPOSITORY?.trim() || process.env.GITHUB_REPOSITORY?.trim();

  if (!repository) {
    throw new Error("Set AGENTIC_REPOSITORY to `<your-org>/<your-repo>` before collecting GitHub issue states.");
  }

  for (const issue of githubIssueSyncCompletionAuditTrackedIssues) {
    const result = await runCommand("gh", [
      "issue",
      "view",
      String(issue),
      "--repo",
      repository,
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

function printRemediationPlan(plan: GitHubIssueSyncCompletionRemediationPlan) {
  console.log(plan.ok ? "GitHub issue-sync remediation plan is empty." : "GitHub issue-sync remediation plan:");
  console.log(`Checked issues: ${plan.generatedFrom.checkedIssues}`);
  console.log(`Failed criteria: ${plan.generatedFrom.failedCriteria}`);

  for (const item of plan.items) {
    console.log(`- #${item.issue} ${item.open ? "open" : "closed"}: ${item.title}`);

    if (item.failedChecks.length > 0) {
      console.log(`  Failed checks: ${item.failedChecks.join(", ")}`);
    }

    for (const action of item.actionItems) {
      console.log(`  - [${action.kind}] ${action.action}`);
    }

    for (const validation of item.validationCommands) {
      console.log(`  validation [${validation.kind}]: ${validation.command}`);
    }
  }

  console.log("Commands:");
  for (const command of plan.commandItems) {
    console.log(`- [${command.kind}] ${command.command}`);
  }
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(HELP_TEXT);
    return;
  }

  const json = process.argv.includes("--json");
  const remediationPlan = process.argv.includes("--remediation-plan");
  const localOnly = process.argv.includes("--local-only");
  const [issues, preflight] = await Promise.all([collectIssueStates(), collectGitHubAppSyncLivePreflight(process.env)]);
  const releaseCloseoutEvidence = validateReleaseCloseoutEvidenceManifest(
    readReleaseCloseoutEvidenceManifest(DEFAULT_RELEASE_CLOSEOUT_EVIDENCE_PATH),
    { cwd: process.cwd() }
  );
  const report = buildGitHubIssueSyncCompletionAudit({ issues, preflight, releaseCloseoutEvidence });

  if (remediationPlan) {
    const plan = buildGitHubIssueSyncRemediationPlan(report, { localOnly });

    if (json) {
      console.log(JSON.stringify(plan, null, 2));
    } else {
      printRemediationPlan(plan);
    }
  } else if (json) {
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
