import { describe, expect, it, vi } from "vitest";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import { runDeploymentGitHubAppSyncCanary } from "../scripts/lib/deployment-github-app-sync-canary";

function jsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

describe("deployment GitHub App sync canary", () => {
  it("proves GitHub App sync jobs reach durable worker completion", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(202, {
          ok: true,
          synchronizedAt: "2026-05-18T10:00:00.000Z",
          automationMode: "work",
          repositories: [
            {
              fullName: "leonardwongly/agentic",
              openIssuesSeen: 1,
              skippedPullRequests: 1
            }
          ],
          jobs: [
            {
              id: "job-sync-1",
              kind: "github_issue_intake",
              status: "queued",
              repository: "leonardwongly/agentic",
              issueNumber: 203,
              automationMode: "work",
              goalId: "goal-sync-1",
              statusUrl: "/api/jobs/job-sync-1"
            }
          ]
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(202, {
          job: {
            id: "job-sync-1",
            kind: "github_issue_intake",
            status: "running",
            repository: "leonardwongly/agentic",
            issueNumber: 203,
            automationMode: "work",
            goalId: "goal-sync-1"
          },
          result: null,
          error: null
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          job: {
            id: "job-sync-1",
            kind: "github_issue_intake",
            status: "completed",
            repository: "leonardwongly/agentic",
            issueNumber: 203,
            automationMode: "work",
            goalId: "goal-sync-1"
          },
          result: {
            goal: {
              id: "goal-sync-1"
            }
          },
          error: null
        })
      );
    const wait = vi.fn(async () => undefined);

    const summary = await runDeploymentGitHubAppSyncCanary({
      baseUrl: "https://agentic.example.com/",
      accessKey: "test-access-key",
      syncSecret: "github-app-sync-secret",
      pollIntervalMs: 10,
      timeoutMs: 30,
      requestId: "sync-canary-request-1",
      traceId: "sync-canary-trace-1",
      fetchImpl,
      wait
    });

    expect(summary).toMatchObject({
      synchronizedAt: "2026-05-18T10:00:00.000Z",
      automationMode: "work",
      repositories: [
        {
          fullName: "leonardwongly/agentic",
          openIssuesSeen: 1,
          skippedPullRequests: 1
        }
      ],
      jobs: [
        {
          id: "job-sync-1",
          repository: "leonardwongly/agentic",
          issueNumber: 203,
          automationMode: "work",
          goalId: "goal-sync-1",
          attempts: 2,
          statusUrl: "https://agentic.example.com/api/jobs/job-sync-1"
        }
      ],
      requestId: "sync-canary-request-1",
      traceId: "sync-canary-trace-1",
      syncDurationMs: expect.any(Number),
      pollDurationMs: expect.any(Number)
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://agentic.example.com/api/github/issues/app/sync",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer github-app-sync-secret",
          "x-request-id": "sync-canary-request-1",
          "x-trace-id": "sync-canary-trace-1"
        })
      })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://agentic.example.com/api/jobs/job-sync-1",
      expect.objectContaining({
        headers: expect.objectContaining({
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key",
          "x-request-id": "sync-canary-request-1",
          "x-trace-id": "sync-canary-trace-1"
        })
      })
    );
    expect(JSON.stringify(summary)).not.toContain("github-app-sync-secret");
    expect(JSON.stringify(summary)).not.toContain("test-access-key");
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it("fails when sync produces no durable jobs to poll", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse(202, {
        ok: true,
        repositories: [
          {
            fullName: "leonardwongly/agentic",
            openIssuesSeen: 0,
            skippedPullRequests: 0
          }
        ],
        jobs: []
      })
    );

    await expect(
      runDeploymentGitHubAppSyncCanary({
        baseUrl: "https://agentic.example.com",
        accessKey: "test-access-key",
        syncSecret: "github-app-sync-secret",
        fetchImpl
      })
    ).rejects.toThrow("GitHub App sync did not enqueue any github_issue_intake jobs to prove worker durability.");
  });

  it("fails when a synced job dead-letters", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(202, {
          ok: true,
          jobs: [
            {
              id: "job-sync-2",
              kind: "github_issue_intake",
              status: "queued",
              repository: "leonardwongly/agentic",
              issueNumber: 204,
              automationMode: "work"
            }
          ]
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          job: {
            id: "job-sync-2",
            status: "dead_letter"
          },
          result: null,
          error: "GitHub issue intake failed. Replay the job or inspect worker logs."
        })
      );

    await expect(
      runDeploymentGitHubAppSyncCanary({
        baseUrl: "https://agentic.example.com",
        accessKey: "test-access-key",
        syncSecret: "github-app-sync-secret",
        fetchImpl,
        wait: async () => undefined
      })
    ).rejects.toThrow("GitHub issue intake failed. Replay the job or inspect worker logs.");
  });

  it("rejects unsafe job status URLs from the sync response", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse(202, {
        ok: true,
        jobs: [
          {
            id: "job-sync-unsafe",
            kind: "github_issue_intake",
            status: "queued",
            statusUrl: "https://metadata.internal/api/jobs/job-sync-unsafe",
            repository: "leonardwongly/agentic",
            issueNumber: 205,
            automationMode: "work"
          }
        ]
      })
    );

    await expect(
      runDeploymentGitHubAppSyncCanary({
        baseUrl: "https://agentic.example.com",
        accessKey: "test-access-key",
        syncSecret: "github-app-sync-secret",
        fetchImpl
      })
    ).rejects.toThrow("GitHub App sync job job-sync-unsafe returned an unsafe status URL.");
  });

  it("rejects invalid configuration before making network calls", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      runDeploymentGitHubAppSyncCanary({
        baseUrl: " ",
        accessKey: "test-access-key",
        syncSecret: "github-app-sync-secret",
        fetchImpl
      })
    ).rejects.toThrow("AGENTIC_SMOKE_BASE_URL must be configured.");
    await expect(
      runDeploymentGitHubAppSyncCanary({
        baseUrl: "https://agentic.example.com",
        accessKey: " ",
        syncSecret: "github-app-sync-secret",
        fetchImpl
      })
    ).rejects.toThrow("AGENTIC_SMOKE_ACCESS_KEY must be configured.");
    await expect(
      runDeploymentGitHubAppSyncCanary({
        baseUrl: "https://agentic.example.com",
        accessKey: "test-access-key",
        syncSecret: " ",
        fetchImpl
      })
    ).rejects.toThrow("AGENTIC_GITHUB_APP_SYNC_SECRET must be configured.");
    await expect(
      runDeploymentGitHubAppSyncCanary({
        baseUrl: "https://agentic.example.com",
        accessKey: "test-access-key",
        syncSecret: "github-app-sync-secret",
        timeoutMs: 0,
        fetchImpl
      })
    ).rejects.toThrow("timeoutMs must be a positive number.");

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
