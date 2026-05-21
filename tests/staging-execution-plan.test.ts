import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveStagingExecutionPlan } from "../scripts/lib/staging-execution-plan";

describe("staging execution plan", () => {
  it("keeps the external deployment flow when all required configuration is present", () => {
    const plan = resolveStagingExecutionPlan({
      DATABASE_URL: "postgres://staging",
      AGENTIC_ACCESS_KEY: "staging-key",
      AGENTIC_INGRESS_PROVIDER: "render",
      AGENTIC_INGRESS_ENVIRONMENT: "production-like",
      AGENTIC_INGRESS_ROLLOUT_MODE: "manual-only",
      AGENTIC_INGRESS_ROLLBACK_AUTHORITY: "platform-operator",
      AGENTIC_SMOKE_BASE_URL: "https://staging.example.com",
      AGENTIC_SMOKE_ACCESS_KEY: "staging-smoke-key",
      AGENTIC_TRUST_PROXY_HEADERS: "true",
      AGENTIC_PROXY_HEADER_OVERWRITE_CONFIRMED: "true",
      AGENTIC_TRUSTED_CLIENT_IP_HEADER: "x-forwarded-for",
      AGENTIC_STAGING_DEPLOY_BIN: "node"
    });

    expect(plan).toEqual({
      mode: "external",
      missingExternalConfig: [],
      injectedEnv: {}
    });
  });

  it("falls back to runner-local self-test mode when external staging config is incomplete", () => {
    const plan = resolveStagingExecutionPlan({
      AGENTIC_STAGING_DEPLOY_TIMEOUT_MS: "45000"
    });

    expect(plan.mode).toBe("self-test");
    expect(plan.missingExternalConfig).toEqual([
      "STAGING_DATABASE_URL",
      "STAGING_AGENTIC_ACCESS_KEY",
      "STAGING_INGRESS_PROVIDER",
      "STAGING_INGRESS_ENVIRONMENT",
      "STAGING_INGRESS_ROLLOUT_MODE",
      "STAGING_INGRESS_ROLLBACK_AUTHORITY",
      "STAGING_BASE_URL",
      "STAGING_SMOKE_ACCESS_KEY",
      "STAGING_TRUST_PROXY_HEADERS",
      "STAGING_PROXY_HEADER_OVERWRITE_CONFIRMED",
      "STAGING_TRUSTED_CLIENT_IP_HEADER",
      "STAGING_DEPLOY_BIN"
    ]);
    expect(plan.injectedEnv).toMatchObject({
      DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/agentic",
      AGENTIC_ACCESS_KEY: "agentic-staging-self-test-key",
      AGENTIC_INGRESS_PROVIDER: "runner-local",
      AGENTIC_INGRESS_ENVIRONMENT: "staging",
      AGENTIC_INGRESS_ROLLOUT_MODE: "manual-only",
      AGENTIC_INGRESS_ROLLBACK_AUTHORITY: "github-actions",
      AGENTIC_SMOKE_BASE_URL: "http://127.0.0.1:3301",
      AGENTIC_SMOKE_ACCESS_KEY: "agentic-staging-self-test-key",
      AGENTIC_ALLOW_PROCESS_LOCAL_AUTH_STATE: "true",
      AGENTIC_TRUST_PROXY_HEADERS: "true",
      AGENTIC_PROXY_HEADER_OVERWRITE_CONFIRMED: "true",
      AGENTIC_TRUSTED_CLIENT_IP_HEADER: "x-forwarded-for",
      AGENTIC_STAGING_DEPLOY_BIN: "node",
      AGENTIC_STAGING_DEPLOY_TIMEOUT_MS: "45000"
    });
  });

  it("exposes the staging planner as the workflow and operator command", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };
    const workflow = readFileSync(".github/workflows/staging-manual-deploy.yml", "utf8");
    const runbook = readFileSync("docs/runbooks/deployment.md", "utf8");

    expect(packageJson.scripts?.["deploy:staging:plan"]).toBe("tsx scripts/staging-execution-plan.ts");
    expect(workflow).toContain("run: npm run deploy:staging:plan");
    expect(workflow).not.toContain("run: npx tsx scripts/staging-execution-plan.ts");
    expect(runbook).toContain("npm run deploy:staging:plan");
    expect(runbook).toContain("Do not treat `self-test` mode as external deployment evidence.");
  });
});
