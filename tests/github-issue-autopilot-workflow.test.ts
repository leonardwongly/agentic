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
});
