import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("GitHub issue autopilot workflow", () => {
  it("runs for bounded issue automation triggers and forwards signed events to Agentic", () => {
    const workflow = readRepoFile(".github/workflows/github-issue-autopilot.yml");

    expect(workflow).toContain("name: GitHub Issue Autopilot");
    expect(workflow).toContain("issues:");
    expect(workflow).toContain("types: [opened, reopened, labeled]");
    expect(workflow).toContain("issue_comment:");
    expect(workflow).toContain("types: [created]");
    expect(workflow).toContain("github.event.issue.pull_request == null");
    expect(workflow).toContain("AGENTIC_GITHUB_ISSUE_WEBHOOK_URL: ${{ vars.AGENTIC_GITHUB_ISSUE_WEBHOOK_URL }}");
    expect(workflow).toContain("AGENTIC_GITHUB_WEBHOOK_SECRET: ${{ secrets.AGENTIC_GITHUB_WEBHOOK_SECRET }}");
    expect(workflow).toContain('createHmac("sha256", secret).update(body).digest("hex")');
    expect(workflow).toContain("const eventName = process.env.GITHUB_EVENT_NAME;");
    expect(workflow).toContain('"x-github-event": eventName');
    expect(workflow).not.toContain('"x-github-event": "issues"');
    expect(workflow).toContain('"x-hub-signature-256": signature');
    expect(workflow).toContain("fetch(url, {");
  });

  it("uses least privilege and avoids mutable repository permissions", () => {
    const workflow = readRepoFile(".github/workflows/github-issue-autopilot.yml");

    expect(workflow).toContain("permissions:");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("issues: read");
    expect(workflow).not.toContain("contents: write");
    expect(workflow).not.toContain("issues: write");
    expect(workflow).not.toContain("pull-requests: write");
    expect(workflow).not.toContain("actions/checkout");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("github.event.comment.id || github.event.label.name || github.event.action");
  });

  it("fails closed for unsafe endpoint configuration without printing secrets", () => {
    const workflow = readRepoFile(".github/workflows/github-issue-autopilot.yml");

    expect(workflow).toContain('!url.startsWith("https://")');
    expect(workflow).toContain("secret.length < 32");
    expect(workflow).toContain("process.exit(1)");
    expect(workflow).not.toContain("console.log(secret");
    expect(workflow).not.toContain("console.error(secret");
  });

  it("schedules GitHub App open issue sync without app private key exposure", () => {
    const workflow = readRepoFile(".github/workflows/github-app-issue-sync.yml");
    const runbook = readRepoFile("docs/runbooks/github-issue-autopilot.md");

    expect(workflow).toContain("name: GitHub App Issue Sync");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("allow_temporary_url:");
    expect(workflow).toContain("schedule:");
    expect(workflow).toContain('cron: "17 * * * *"');
    expect(workflow).toContain("contents: read");
    expect(workflow).not.toContain("contents: write");
    expect(workflow).not.toContain("issues: write");
    expect(workflow).not.toContain("actions/checkout");
    expect(workflow).toContain("AGENTIC_GITHUB_APP_ISSUE_SYNC_URL: ${{ vars.AGENTIC_GITHUB_APP_ISSUE_SYNC_URL }}");
    expect(workflow).toContain("AGENTIC_GITHUB_APP_SYNC_SECRET: ${{ secrets.AGENTIC_GITHUB_APP_SYNC_SECRET }}");
    expect(workflow).toContain("core.setSecret(secret)");
    expect(workflow).toContain("const requestId = `github-app-issue-sync-${context.runId}-${context.runAttempt}`;");
    expect(workflow).toContain('authorization: `Bearer ${secret}`');
    expect(workflow).toContain('"x-request-id": requestId');
    expect(workflow).toContain('"x-trace-id": requestId');
    expect(workflow).toContain('const allowTemporaryUrl = String(context.payload.inputs?.allow_temporary_url ?? "false") === "true";');
    expect(workflow).toContain('parsedUrl.protocol !== "https:"');
    expect(workflow).toContain("parsedUrl.username || parsedUrl.password");
    expect(workflow).toContain('parsedUrl.pathname !== "/api/github/issues/app/sync"');
    expect(workflow).toContain("parsedUrl.search || parsedUrl.hash");
    expect(workflow).toContain("trycloudflare\\.com");
    expect(workflow).toContain("ngrok\\.app");
    expect(workflow).toContain("localhost\\.run");
    expect(workflow).toContain("devtunnels\\.ms");
    expect(workflow).toContain("serveo\\.net");
    expect(workflow).toContain("tunnelmole\\.net");
    expect(workflow).toContain("^192\\.168\\.");
    expect(workflow).toContain('context.eventName === "schedule"');
    expect(workflow).toContain("temporary tunnel host");
    expect(workflow).toContain("!allowTemporaryUrl");
    expect(workflow).toContain("secret.length < 32");
    expect(workflow).not.toContain("AGENTIC_GITHUB_APP_PRIVATE_KEY");
    expect(workflow).not.toContain("AGENTIC_GITHUB_APP_INSTALLATION_ID");
    expect(workflow).not.toContain("console.log(secret");
    expect(workflow).not.toContain("console.error(secret");
    expect(runbook).toContain("disabled_manually");
    expect(runbook).toContain('gh workflow enable github-app-issue-sync.yml --repo "$AGENTIC_REPOSITORY"');
    expect(runbook).toContain("npm run github:app-sync:preflight -- --help");
    expect(runbook).toContain("npm run github:app-sync:preflight -- --provider-evidence-template");
    expect(runbook).toContain("npm run github:app-sync:preflight:collect -- --help");
    expect(runbook).toContain("npm run github:app-sync:preflight");
    expect(runbook).toContain("npm run github:issues:completion-audit -- --help");
    expect(runbook).toContain("npm run github:issues:completion-audit -- --json");
    expect(runbook).toContain("npm run test:smoke:deployment -- --help");
    expect(runbook).toContain("npm run test:smoke:deployment-async -- --help");
    expect(runbook).toContain("npm run test:smoke:github-app-sync -- --help");
    expect(runbook).toContain("The ordered closeout sequence is:");
    expect(runbook).toContain("| #141 | Stable HTTPS ingress exists");
    expect(runbook).toContain("| #142 | Runtime-only GitHub App credentials");
    expect(runbook).toContain("| #143 | Target Postgres exists");
    expect(runbook).toContain("| #144 | Deployed worker is running");
    expect(runbook).toContain("| #145 | Manual GitHub App issue sync reaches the stable deployed route");
    expect(runbook).toContain("| #152 | All child production proof issues are closed");
    expect(runbook).toContain("Do not enable scheduled sync or run a");
    expect(runbook).toContain("live manual dispatch before #141 stable ingress");
    expect(runbook).toContain("Do not waive the worker and durable-store requirements");
    expect(runbook).toContain("production topology to a web-only shape");
    expect(runbook).toContain("equivalent web, worker, Postgres, HTTPS ingress");
  });
});
