import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const envExamplePath = join(process.cwd(), ".env.example");

function readEnvExample(): string {
  return readFileSync(envExamplePath, "utf8");
}

describe(".env.example", () => {
  it("documents the production GitHub issue sync preflight environment without real secrets", () => {
    const envExample = readEnvExample();
    const requiredNames = [
      "AGENTIC_SMOKE_BASE_URL",
      "AGENTIC_INGRESS_BASE_URL",
      "AGENTIC_SMOKE_ACCESS_KEY",
      "DATABASE_URL",
      "AGENTIC_ACCESS_KEY",
      "AGENTIC_GITHUB_APP_ID",
      "AGENTIC_GITHUB_APP_INSTALLATION_ID",
      "AGENTIC_GITHUB_APP_PRIVATE_KEY",
      "AGENTIC_GITHUB_APP_SYNC_SECRET",
      "AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES",
      "AGENTIC_GITHUB_APP_ISSUE_SYNC_URL",
      "AGENTIC_GITHUB_APP_SYNC_WORKFLOW_STATE",
      "AGENTIC_GITHUB_ACTIONS_SECRETS_JSON",
      "AGENTIC_RENDER_SERVICES_JSON",
      "AGENTIC_RENDER_BLUEPRINT_VALIDATION_JSON",
      "AGENTIC_DEPLOYMENT_PROVIDER_EVIDENCE_JSON",
      "AGENTIC_DEPLOYMENT_SMOKE_JSON",
      "AGENTIC_DEPLOYMENT_ASYNC_CANARY_JSON",
      "AGENTIC_GITHUB_APP_SYNC_CANARY_JSON"
    ];

    for (const name of requiredNames) {
      expect(envExample, `${name} should be documented`).toContain(`# ${name}=`);
    }

    expect(envExample).toContain("Runtime-only credentials belong in the");
    expect(envExample).toContain("Non-secret live preflight evidence");
    expect(envExample).toContain("hand-edit them to bypass live proof");
    expect(envExample).not.toContain("trycloudflare.com");
    expect(envExample).not.toMatch(/^AGENTIC_GITHUB_APP_PRIVATE_KEY=/mu);
    expect(envExample).not.toMatch(/^AGENTIC_GITHUB_APP_SYNC_SECRET=/mu);
    expect(envExample).not.toMatch(/^AGENTIC_ACCESS_KEY=/mu);
  });
});
