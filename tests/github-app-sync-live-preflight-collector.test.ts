import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  collectGitHubAppSyncLivePreflight,
  runGitHubAppSyncLivePreflightCommand,
  type GitHubAppSyncLivePreflightCommandRunner
} from "../scripts/lib/github-app-sync-live-preflight-collector";

const PRIVATE_KEY = "-----BEGIN RSA PRIVATE KEY-----\\nredacted\\n-----END RSA PRIVATE KEY-----";
const CLOUDFLARE_PROVIDER_EVIDENCE = JSON.stringify({
  provider: "cloudflare-workers",
  environment: "production",
  services: [
    { name: "agentic", role: "web" },
    { name: "agentic-cron", role: "worker" }
  ],
  database: {
    engine: "postgres",
    configured: true,
    binding: "HYPERDRIVE"
  },
  stableHttpsIngress: true,
  secretManagement: true,
  rollbackAuthority: "wrangler deployments rollback"
});

const RUNTIME_ENV = {
  AGENTIC_REPOSITORY: "octo-org/demo-agentic",
  AGENTIC_SMOKE_BASE_URL: "https://agentic.example.com",
  AGENTIC_SMOKE_ACCESS_KEY: "runtime-access-key",
  DATABASE_URL: "postgres://agentic:redacted@postgres.internal:5432/agentic",
  AGENTIC_ACCESS_KEY: "runtime-access-key",
  AGENTIC_GITHUB_APP_ID: "123456",
  AGENTIC_GITHUB_APP_INSTALLATION_ID: "654321",
  AGENTIC_GITHUB_APP_PRIVATE_KEY: PRIVATE_KEY,
  AGENTIC_GITHUB_APP_SYNC_SECRET: "github-app-sync-secret-with-at-least-32-characters",
  AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES: "octo-org/demo-agentic",
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
    repositories: [{ fullName: "octo-org/demo-agentic", openIssuesSeen: 1, skippedPullRequests: 1 }],
    jobs: [{ id: "job-sync-1", repository: "octo-org/demo-agentic", issueNumber: 145, attempts: 2 }]
  })
};

function commandKey(command: string, args: string[]) {
  return `${command} ${args.join(" ")}`;
}

function runnerWith(outputs: Record<string, { stdout: string; exitCode?: number }>): GitHubAppSyncLivePreflightCommandRunner {
  return async (command, args) => {
    const output = outputs[commandKey(command, args)];

    if (!output) {
      return {
        stdout: "",
        stderr: `missing test output for ${command}`,
        exitCode: 1
      };
    }

    return {
      stdout: output.stdout,
      stderr: "",
      exitCode: output.exitCode ?? 0
    };
  };
}

const STABLE_OUTPUTS = {
  "gh api repos/octo-org/demo-agentic/actions/workflows/github-app-issue-sync.yml --jq .state": {
    stdout: "active\n"
  },
  "gh variable get AGENTIC_GITHUB_APP_ISSUE_SYNC_URL --repo octo-org/demo-agentic": {
    stdout: "https://agentic.example.com/api/github/issues/app/sync\n"
  },
  "gh secret list --repo octo-org/demo-agentic --json name": {
    stdout: JSON.stringify([{ name: "AGENTIC_GITHUB_APP_SYNC_SECRET" }])
  },
  "npm run --silent cloudflare:provider-evidence": {
    stdout: CLOUDFLARE_PROVIDER_EVIDENCE
  },
  "render services list --output json": {
    stdout: JSON.stringify([{ name: "agentic-web" }, { name: "agentic-worker" }])
  },
  "render blueprints validate deploy/render/render.yaml --output json": {
    stdout: JSON.stringify({ valid: true, errors: [] })
  }
};

describe("GitHub App sync live preflight collector", () => {
  it("prints operator help without running GitHub or Render commands", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/github-app-sync-live-preflight-collect.ts", "--help"], {
      cwd: process.cwd(),
      encoding: "utf8"
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: npm run github:app-sync:preflight:collect -- [--json]");
    expect(result.stdout).toContain("GitHub App Issue Sync workflow state");
    expect(result.stdout).toContain("Cloudflare provider evidence");
    expect(result.stdout).toContain("Runtime-only secrets are not fetched");
    expect(result.stdout).toContain("AGENTIC_DEPLOYMENT_PROVIDER_EVIDENCE_JSON");
    expect(result.stderr).toBe("");
  });

  it("collects read-only GitHub and deployment-provider evidence before running preflight", async () => {
    const report = await collectGitHubAppSyncLivePreflight(RUNTIME_ENV, runnerWith(STABLE_OUTPUTS));

    expect(report.ok).toBe(true);
    expect(report.collection.map((step) => [step.name, step.envName, step.status])).toEqual([
      ["workflow_state", "AGENTIC_GITHUB_APP_SYNC_WORKFLOW_STATE", "collected"],
      ["sync_url", "AGENTIC_GITHUB_APP_ISSUE_SYNC_URL", "collected"],
      ["github_actions_secret_inventory", "AGENTIC_GITHUB_ACTIONS_SECRETS_JSON", "collected"],
      ["cloudflare_provider_evidence", "AGENTIC_DEPLOYMENT_PROVIDER_EVIDENCE_JSON", "collected"],
      ["render_services", "AGENTIC_RENDER_SERVICES_JSON", "collected"],
      ["render_blueprint", "AGENTIC_RENDER_BLUEPRINT_VALIDATION_JSON", "collected"]
    ]);
    expect(report.preflight.checks.every((check) => check.status === "pass")).toBe(true);
  });

  it("allows missing Render CLI evidence when Cloudflare provider evidence satisfies preflight", async () => {
    const report = await collectGitHubAppSyncLivePreflight(
      RUNTIME_ENV,
      runnerWith({
        ...STABLE_OUTPUTS,
        "render services list --output json": {
          stdout: "",
          exitCode: 1
        },
        "render blueprints validate deploy/render/render.yaml --output json": {
          stdout: "",
          exitCode: 1
        }
      })
    );

    expect(report.ok).toBe(true);
    expect(report.collection).toContainEqual(
      expect.objectContaining({
        name: "render_services",
        status: "failed"
      })
    );
    expect(report.preflight.checks).toContainEqual(
      expect.objectContaining({
        name: "provider_services",
        status: "pass",
        details: expect.objectContaining({
          provider: "cloudflare-workers"
        })
      })
    );
  });

  it("uses collected live evidence to expose current disabled workflow and temporary tunnel blockers", async () => {
    const report = await collectGitHubAppSyncLivePreflight(
      RUNTIME_ENV,
      runnerWith({
        ...STABLE_OUTPUTS,
        "gh api repos/octo-org/demo-agentic/actions/workflows/github-app-issue-sync.yml --jq .state": {
          stdout: "disabled_manually\n"
        },
        "gh variable get AGENTIC_GITHUB_APP_ISSUE_SYNC_URL --repo octo-org/demo-agentic": {
          stdout: "https://occasion-translations-cover-vids.trycloudflare.com/api/github/issues/app/sync\n"
        }
      })
    );

    expect(report.ok).toBe(false);
    expect(report.preflight.checks).toContainEqual(
      expect.objectContaining({
        name: "stable_host",
        status: "fail"
      })
    );
    expect(report.preflight.checks).toContainEqual(
      expect.objectContaining({
        name: "workflow_state",
        status: "fail"
      })
    );
  });

  it("does not print secret values in collection or preflight output", async () => {
    const report = await collectGitHubAppSyncLivePreflight(RUNTIME_ENV, runnerWith(STABLE_OUTPUTS));
    const serialized = JSON.stringify(report);

    expect(serialized).not.toContain(RUNTIME_ENV.AGENTIC_GITHUB_APP_SYNC_SECRET);
    expect(serialized).not.toContain(RUNTIME_ENV.DATABASE_URL);
    expect(serialized).not.toContain(PRIVATE_KEY);
  });

  it("preserves provider validation JSON from non-zero commands so preflight can report the real blocker", async () => {
    const report = await collectGitHubAppSyncLivePreflight(
      RUNTIME_ENV,
      runnerWith({
        ...STABLE_OUTPUTS,
        "render blueprints validate deploy/render/render.yaml --output json": {
          stdout: JSON.stringify({
            valid: false,
            errors: [{ error: "need_payment_info", path: "services[0]" }]
          }),
          exitCode: 1
        },
        "npm run --silent cloudflare:provider-evidence": {
          stdout: "",
          exitCode: 1
        }
      })
    );

    expect(report.ok).toBe(false);
    expect(report.collection).toContainEqual(
      expect.objectContaining({
        name: "render_blueprint",
        status: "collected_with_command_failure",
        exitCode: 1
      })
    );
    expect(report.preflight.checks).toContainEqual(
      expect.objectContaining({
        name: "provider_configuration",
        status: "fail",
        details: expect.objectContaining({
          firstError: "need_payment_info"
        })
      })
    );
  });

  it("fails closed when a required read-only inventory command produces no output", async () => {
    const report = await collectGitHubAppSyncLivePreflight(
      RUNTIME_ENV,
      runnerWith({
        ...STABLE_OUTPUTS,
        "gh secret list --repo octo-org/demo-agentic --json name": {
          stdout: "",
          exitCode: 1
        }
      })
    );

    expect(report.ok).toBe(false);
    expect(report.collection).toContainEqual(
      expect.objectContaining({
        name: "github_actions_secret_inventory",
        status: "failed"
      })
    );
    expect(report.preflight.checks).toContainEqual(
      expect.objectContaining({
        name: "github_actions_secret_inventory",
        status: "fail"
      })
    );
  });

  it("fails closed when a read-only inventory command output is truncated", async () => {
    const report = await collectGitHubAppSyncLivePreflight(
      RUNTIME_ENV,
      async (command, args) => {
        const baseOutput = await runnerWith(STABLE_OUTPUTS)(command, args);

        if (commandKey(command, args) === "render services list --output json") {
          return {
            ...baseOutput,
            stdout: JSON.stringify([{ name: "agentic-web" }, { name: "agentic-worker" }]),
            truncatedStream: "stdout"
          };
        }

        if (commandKey(command, args) === "npm run --silent cloudflare:provider-evidence") {
          return {
            stdout: "",
            stderr: "not configured",
            exitCode: 1
          };
        }

        return baseOutput;
      }
    );

    expect(report.ok).toBe(false);
    expect(report.collection).toContainEqual(
      expect.objectContaining({
        name: "render_services",
        status: "failed",
        message: expect.stringContaining("stdout exceeded 1048576 bytes")
      })
    );
    expect(report.preflight.checks).toContainEqual(
      expect.objectContaining({
        name: "provider_services",
        status: "fail"
      })
    );
  });

  it("bounds stdout captured from live preflight commands", async () => {
    const result = await runGitHubAppSyncLivePreflightCommand(process.execPath, [
      "-e",
      "process.stdout.write('x'.repeat(1048577));"
    ]);

    expect(result.truncatedStream).toBe("stdout");
    expect(Buffer.byteLength(result.stdout, "utf8")).toBe(1048576);
  });
});
