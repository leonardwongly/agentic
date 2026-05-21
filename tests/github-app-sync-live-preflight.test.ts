import { describe, expect, it } from "vitest";
import { validateGitHubAppSyncLivePreflight } from "../scripts/lib/github-app-sync-live-preflight";

const PRIVATE_KEY = "-----BEGIN RSA PRIVATE KEY-----\\nredacted\\n-----END RSA PRIVATE KEY-----";

const BASE_ENV = {
  AGENTIC_GITHUB_APP_ISSUE_SYNC_URL: "https://agentic.example.com/api/github/issues/app/sync",
  AGENTIC_SMOKE_BASE_URL: "https://agentic.example.com",
  AGENTIC_SMOKE_ACCESS_KEY: "runtime-access-key",
  AGENTIC_GITHUB_APP_SYNC_WORKFLOW_STATE: "active",
  AGENTIC_GITHUB_ACTIONS_SECRETS_JSON: JSON.stringify([{ name: "AGENTIC_GITHUB_APP_SYNC_SECRET" }]),
  DATABASE_URL: "postgres://agentic:redacted@postgres.internal:5432/agentic",
  AGENTIC_ACCESS_KEY: "runtime-access-key",
  AGENTIC_GITHUB_APP_ID: "123456",
  AGENTIC_GITHUB_APP_INSTALLATION_ID: "654321",
  AGENTIC_GITHUB_APP_PRIVATE_KEY: PRIVATE_KEY,
  AGENTIC_GITHUB_APP_SYNC_SECRET: "github-app-sync-secret-with-at-least-32-characters",
  AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES: "leonardwongly/agentic",
  AGENTIC_RENDER_SERVICES_JSON: JSON.stringify([
    { name: "agentic-web" },
    { name: "agentic-worker" }
  ]),
  AGENTIC_RENDER_BLUEPRINT_VALIDATION_JSON: JSON.stringify({ valid: true, errors: [] }),
  AGENTIC_DEPLOYMENT_SMOKE_JSON: JSON.stringify({
    ok: true,
    healthStatus: "live",
    readinessStatus: "ready",
    sessionChecked: true,
    checks: [
      { name: "health", status: 200 },
      { name: "readiness", status: 200 },
      { name: "session", status: 200 }
    ]
  }),
  AGENTIC_DEPLOYMENT_ASYNC_CANARY_JSON: JSON.stringify({
    ok: true,
    jobId: "job-canary-1",
    attempts: 2,
    statusUrl: "https://agentic.example.com/api/goals/jobs/job-canary-1"
  }),
  AGENTIC_GITHUB_APP_SYNC_CANARY_JSON: JSON.stringify({
    ok: true,
    negativeAuthStatus: 401,
    repositories: [{ fullName: "leonardwongly/agentic", openIssuesSeen: 1, skippedPullRequests: 1 }],
    jobs: [{ id: "job-sync-1", repository: "leonardwongly/agentic", issueNumber: 145, attempts: 2 }]
  })
};

describe("GitHub App sync live preflight", () => {
  it("accepts a stable deployed sync target with active workflow and provider evidence", () => {
    const report = validateGitHubAppSyncLivePreflight(BASE_ENV);

    expect(report.ok).toBe(true);
    expect(report.endpoints).toEqual({
      health: "https://agentic.example.com/api/health",
      readiness: "https://agentic.example.com/api/ready",
      sync: "https://agentic.example.com/api/github/issues/app/sync"
    });
    expect(report.checks.map((check) => [check.name, check.status])).toEqual([
      ["sync_url", "pass"],
      ["stable_host", "pass"],
      ["smoke_base_url", "pass"],
      ["workflow_state", "pass"],
      ["github_actions_secret_inventory", "pass"],
      ["runtime_secret_inventory", "pass"],
      ["runtime_secret_shape", "pass"],
      ["smoke_canary_inventory", "pass"],
      ["repository_allowlist", "pass"],
      ["render_services", "pass"],
      ["render_blueprint", "pass"],
      ["deployment_smoke", "pass"],
      ["deployment_async_canary", "pass"],
      ["github_app_sync_canary", "pass"]
    ]);
  });

  it("rejects temporary tunnel sync URLs and disabled workflows", () => {
    const report = validateGitHubAppSyncLivePreflight({
      ...BASE_ENV,
      AGENTIC_GITHUB_APP_ISSUE_SYNC_URL: "https://occasion-translations-cover-vids.trycloudflare.com/api/github/issues/app/sync",
      AGENTIC_SMOKE_BASE_URL: "https://occasion-translations-cover-vids.trycloudflare.com",
      AGENTIC_GITHUB_APP_SYNC_WORKFLOW_STATE: "disabled_manually"
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "stable_host",
        status: "fail",
        message: "Sync URL must not use a temporary tunnel host."
      })
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "workflow_state",
        status: "fail",
        message: "GitHub App Issue Sync workflow must be active before live validation."
      })
    );
  });

  it("rejects unsafe sync URL structure and mismatched smoke origins", () => {
    const report = validateGitHubAppSyncLivePreflight({
      ...BASE_ENV,
      AGENTIC_GITHUB_APP_ISSUE_SYNC_URL: "https://user:secret@agentic.example.com/api/github/issues/app/sync?token=secret",
      AGENTIC_SMOKE_BASE_URL: "https://other-agentic.example.com"
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "sync_url",
        status: "fail",
        message: "Sync URL must not include embedded credentials."
      })
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "sync_url",
        status: "fail",
        message: "Sync URL must point exactly to /api/github/issues/app/sync without query or fragment."
      })
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "smoke_base_url",
        status: "fail",
        message: "Smoke base URL and GitHub App sync URL must use the same origin."
      })
    );
  });

  it("redacts URL credentials, query strings, and fragments from failed preflight reports", () => {
    const report = validateGitHubAppSyncLivePreflight({
      ...BASE_ENV,
      AGENTIC_GITHUB_APP_ISSUE_SYNC_URL:
        "https://user:sync-token@agentic.example.com/api/github/issues/app/sync?token=secret#debug",
      AGENTIC_SMOKE_BASE_URL: "https://smoke-user:smoke-token@agentic.example.com/smoke?access_key=secret#debug"
    });
    const serialized = JSON.stringify(report);

    expect(report.ok).toBe(false);
    expect(report.syncUrl).toBe("https://agentic.example.com/api/github/issues/app/sync");
    expect(report.smokeBaseUrl).toBe("https://agentic.example.com");
    expect(report.endpoints.sync).toBe("https://agentic.example.com/api/github/issues/app/sync");
    expect(serialized).not.toContain("sync-token");
    expect(serialized).not.toContain("smoke-token");
    expect(serialized).not.toContain("access_key");
    expect(serialized).not.toContain("token=secret");
    expect(serialized).not.toContain("#debug");
  });

  it("fails closed when runtime config is missing or malformed", () => {
    const report = validateGitHubAppSyncLivePreflight({
      ...BASE_ENV,
      AGENTIC_GITHUB_APP_ID: "app-id",
      AGENTIC_GITHUB_APP_SYNC_SECRET: "short",
      AGENTIC_GITHUB_APP_PRIVATE_KEY: "",
      AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES: "not-a-full-name",
      AGENTIC_SMOKE_ACCESS_KEY: ""
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "runtime_secret_inventory",
        status: "fail"
      })
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "runtime_secret_shape",
        status: "fail"
      })
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "smoke_canary_inventory",
        status: "fail",
        message: "Required smoke canary configuration is missing."
      })
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "repository_allowlist",
        status: "fail",
        message: "Repository allowlist includes an invalid repository full name."
      })
    );
  });

  it("fails closed when GitHub Actions secret inventory evidence is omitted", () => {
    const { AGENTIC_GITHUB_ACTIONS_SECRETS_JSON, ...envWithoutActionsSecretsEvidence } = BASE_ENV;
    const report = validateGitHubAppSyncLivePreflight(envWithoutActionsSecretsEvidence);

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "github_actions_secret_inventory",
        status: "fail",
        message: "AGENTIC_GITHUB_ACTIONS_SECRETS_JSON is not set; live preflight cannot prove GitHub Actions secret inventory."
      })
    );
  });

  it("fails closed when GitHub Actions lacks the route caller secret", () => {
    const report = validateGitHubAppSyncLivePreflight({
      ...BASE_ENV,
      AGENTIC_GITHUB_ACTIONS_SECRETS_JSON: JSON.stringify([])
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "github_actions_secret_inventory",
        status: "fail",
        message: "GitHub Actions secret inventory is missing required sync caller secret.",
        details: expect.objectContaining({
          missingNames: "AGENTIC_GITHUB_APP_SYNC_SECRET"
        })
      })
    );
  });

  it("fails closed when GitHub Actions contains runtime-only GitHub App credentials", () => {
    const report = validateGitHubAppSyncLivePreflight({
      ...BASE_ENV,
      AGENTIC_GITHUB_ACTIONS_SECRETS_JSON: JSON.stringify([
        { name: "AGENTIC_GITHUB_APP_SYNC_SECRET" },
        { name: "AGENTIC_GITHUB_APP_PRIVATE_KEY" },
        { name: "AGENTIC_GITHUB_APP_INSTALLATION_TOKEN" }
      ])
    });
    const serialized = JSON.stringify(report);

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "github_actions_secret_inventory",
        status: "fail",
        message: "GitHub Actions secret inventory includes runtime-only GitHub App credentials.",
        details: expect.objectContaining({
          forbiddenNames: "AGENTIC_GITHUB_APP_PRIVATE_KEY,AGENTIC_GITHUB_APP_INSTALLATION_TOKEN"
        })
      })
    );
    expect(serialized).not.toContain(BASE_ENV.AGENTIC_GITHUB_APP_SYNC_SECRET);
    expect(serialized).not.toContain(PRIVATE_KEY);
    expect(serialized).not.toContain(BASE_ENV.DATABASE_URL);
  });

  it("captures Render provider blockers without requiring secret values in output", () => {
    const report = validateGitHubAppSyncLivePreflight({
      ...BASE_ENV,
      AGENTIC_RENDER_SERVICES_JSON: "null",
      AGENTIC_RENDER_BLUEPRINT_VALIDATION_JSON: JSON.stringify({
        valid: false,
        errors: [{ error: "need_payment_info", path: "services[0]" }]
      })
    });
    const serialized = JSON.stringify(report);

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "render_services",
        status: "fail",
        message: "Render services list must include deployed Agentic services."
      })
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "render_blueprint",
        status: "fail",
        message: "Render Blueprint validation must pass before live sync validation."
      })
    );
    expect(serialized).not.toContain(BASE_ENV.AGENTIC_GITHUB_APP_SYNC_SECRET);
    expect(serialized).not.toContain(PRIVATE_KEY);
    expect(serialized).not.toContain(BASE_ENV.DATABASE_URL);
  });

  it("fails closed when live provider evidence is omitted", () => {
    const { AGENTIC_RENDER_SERVICES_JSON, AGENTIC_RENDER_BLUEPRINT_VALIDATION_JSON, ...envWithoutProviderEvidence } = BASE_ENV;
    const report = validateGitHubAppSyncLivePreflight(envWithoutProviderEvidence);

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "render_services",
        status: "fail",
        message: "AGENTIC_RENDER_SERVICES_JSON is not set; live preflight cannot prove deployed web and worker services exist."
      })
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "render_blueprint",
        status: "fail",
        message: "AGENTIC_RENDER_BLUEPRINT_VALIDATION_JSON is not set; live preflight cannot prove Render Blueprint validation passes."
      })
    );
  });

  it("fails closed when live smoke and canary evidence is omitted", () => {
    const {
      AGENTIC_DEPLOYMENT_SMOKE_JSON,
      AGENTIC_DEPLOYMENT_ASYNC_CANARY_JSON,
      AGENTIC_GITHUB_APP_SYNC_CANARY_JSON,
      ...envWithoutCanaryEvidence
    } = BASE_ENV;
    const report = validateGitHubAppSyncLivePreflight(envWithoutCanaryEvidence);

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "deployment_smoke",
        status: "fail",
        message: "Set AGENTIC_DEPLOYMENT_SMOKE_JSON from a passing `npm run test:smoke:deployment` run against the deployed origin."
      })
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "deployment_async_canary",
        status: "fail",
        message: "Set AGENTIC_DEPLOYMENT_ASYNC_CANARY_JSON from a passing `npm run test:smoke:deployment-async` run against the deployed worker."
      })
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "github_app_sync_canary",
        status: "fail",
        message: "Set AGENTIC_GITHUB_APP_SYNC_CANARY_JSON from a passing `npm run test:smoke:github-app-sync` run against the deployed sync route."
      })
    );
  });

  it("rejects smoke evidence that does not prove health and readiness", () => {
    const report = validateGitHubAppSyncLivePreflight({
      ...BASE_ENV,
      AGENTIC_DEPLOYMENT_SMOKE_JSON: JSON.stringify({
        ok: true,
        healthStatus: "live",
        readinessStatus: "not_ready",
        sessionChecked: true,
        checks: [{ name: "health", status: 200 }]
      })
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "deployment_smoke",
        status: "fail",
        message: "Deployment smoke evidence must prove live health and ready readiness."
      })
    );
  });

  it("rejects canary evidence that omits worker or GitHub App sync proof", () => {
    const report = validateGitHubAppSyncLivePreflight({
      ...BASE_ENV,
      AGENTIC_DEPLOYMENT_ASYNC_CANARY_JSON: JSON.stringify({
        ok: true,
        jobId: "",
        attempts: 0,
        statusUrl: ""
      }),
      AGENTIC_GITHUB_APP_SYNC_CANARY_JSON: JSON.stringify({
        ok: true,
        negativeAuthStatus: 200,
        repositories: [],
        jobs: []
      })
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "deployment_async_canary",
        status: "fail",
        message: "Deployment async canary evidence must prove a queued job reached durable completion."
      })
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "github_app_sync_canary",
        status: "fail",
        message: "GitHub App sync canary evidence must prove invalid auth, repository sync, and worker-settled jobs."
      })
    );
  });
});
