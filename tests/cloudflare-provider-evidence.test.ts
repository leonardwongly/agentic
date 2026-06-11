import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCloudflareProviderEvidence } from "../scripts/lib/cloudflare-provider-evidence";
import { validateGitHubAppSyncLivePreflight } from "../scripts/lib/github-app-sync-live-preflight";

function collectStringValues(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectStringValues);
  }

  if (value && typeof value === "object") {
    return Object.values(value).flatMap(collectStringValues);
  }

  return [];
}

async function writeWranglerConfig(contents: string): Promise<string> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "agentic-cloudflare-evidence-"));
  const appDir = path.join(repoRoot, "apps", "web");
  await mkdir(appDir, { recursive: true });
  await writeFile(path.join(appDir, "wrangler.jsonc"), contents);
  return repoRoot;
}

describe("Cloudflare provider evidence", () => {
  it("builds non-secret alternate-provider evidence from wrangler config", async () => {
    const repoRoot = await writeWranglerConfig(`{
      // Comments are allowed because the source file is JSONC.
      "name": "agentic",
      "triggers": {
        "crons": ["*/5 * * * *"]
      },
      "hyperdrive": [
        {
          "binding": "HYPERDRIVE",
          "id": "819b9b7ecf14441cbbd1e456ed3e50d1"
        }
      ]
    }`);

    const evidence = buildCloudflareProviderEvidence({
      repoRoot,
      environment: "production"
    });

    expect(evidence).toEqual({
      provider: "cloudflare-workers",
      environment: "production",
      services: [
        {
          name: "agentic",
          role: "web"
        },
        {
          name: "agentic-cron",
          role: "worker"
        }
      ],
      database: {
        engine: "postgres",
        configured: true,
        binding: "HYPERDRIVE",
        hyperdriveId: "819b9b7ecf14441cbbd1e456ed3e50d1"
      },
      stableHttpsIngress: true,
      secretManagement: true,
      rollbackAuthority: "wrangler deployments rollback"
    });
    expect(collectStringValues(evidence).join("\n")).not.toMatch(/secret|password|token|private/iu);
  });

  it("feeds the GitHub App live preflight as alternate provider evidence", async () => {
    const evidence = buildCloudflareProviderEvidence({
      repoRoot: process.cwd()
    });
    const report = validateGitHubAppSyncLivePreflight({
      AGENTIC_GITHUB_APP_ISSUE_SYNC_URL: "https://agentic.leonardwong.workers.dev/api/github/issues/app/sync",
      AGENTIC_SMOKE_BASE_URL: "https://agentic.leonardwong.workers.dev",
      AGENTIC_SMOKE_ACCESS_KEY: "runtime-access-key",
      AGENTIC_GITHUB_APP_SYNC_WORKFLOW_STATE: "active",
      AGENTIC_GITHUB_ACTIONS_SECRETS_JSON: JSON.stringify([{ name: "AGENTIC_GITHUB_APP_SYNC_SECRET" }]),
      DATABASE_URL: "postgres://agentic:redacted@postgres.internal:5432/agentic",
      AGENTIC_ACCESS_KEY: "runtime-access-key",
      AGENTIC_GITHUB_APP_ID: "123456",
      AGENTIC_GITHUB_APP_INSTALLATION_ID: "654321",
      AGENTIC_GITHUB_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\\nredacted\\n-----END RSA PRIVATE KEY-----",
      AGENTIC_GITHUB_APP_SYNC_SECRET: "github-app-sync-secret-with-at-least-32-characters",
      AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES: "leonardwongly/agentic",
      AGENTIC_DEPLOYMENT_PROVIDER_EVIDENCE_JSON: JSON.stringify(evidence),
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
        attempts: 1,
        statusUrl: "https://agentic.leonardwong.workers.dev/api/goals/jobs/job-canary-1"
      }),
      AGENTIC_GITHUB_APP_SYNC_CANARY_JSON: JSON.stringify({
        ok: true,
        negativeAuthStatus: 401,
        repositories: [{ fullName: "leonardwongly/agentic", openIssuesSeen: 1, skippedPullRequests: 1 }],
        jobs: [{ id: "job-sync-1", repository: "leonardwongly/agentic", issueNumber: 145, attempts: 1 }]
      })
    });

    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "provider_services",
        status: "pass",
        details: expect.objectContaining({
          provider: "cloudflare-workers"
        })
      })
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "provider_configuration",
        status: "pass"
      })
    );
  });
});
