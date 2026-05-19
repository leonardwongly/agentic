import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID, createSystemActorContext } from "@agentic/contracts";
import type { AgenticRepository } from "@agentic/repository";
import { createSelfImprovementRepository } from "@agentic/self-improvement-memory";
import {
  enqueueGitHubIssueIntakeJob,
  runWorkerRuntime
} from "@agentic/worker-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAuthorizedGetRequest,
  createRouteTestRepository,
  expectNoStoreHeaders
} from "./route-test-helpers";

vi.mock("../apps/web/lib/server", () => ({
  getSeededRepository: async () => Reflect.get(globalThis, "__agenticRepository") as AgenticRepository
}));

import { GET as genericJobRoute } from "../apps/web/app/api/jobs/[id]/route";

describe("GitHub issue intake job route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;
  let repository: AgenticRepository;
  let selfImprovementDir: string;

  beforeEach(async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-github-issue-job-route-"));
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(tempDir, "runtime-store.json");
    selfImprovementDir = path.join(tempDir, "self-improvement");
    repository = createRouteTestRepository();
    await repository.seedDefaults(SYSTEM_USER_ID);
    Reflect.set(globalThis, "__agenticRepository", repository);
  });

  afterEach(() => {
    if (originalAccessKey === undefined) {
      delete process.env.AGENTIC_ACCESS_KEY;
    } else {
      process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    }

    if (originalRuntimeStorePath === undefined) {
      delete process.env.AGENTIC_RUNTIME_STORE_PATH;
    } else {
      process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    }

    Reflect.deleteProperty(globalThis, "__agenticRepository");
    vi.restoreAllMocks();
  });

  async function enqueueIssueJob(overrides?: {
    userId?: string;
    issueNumber?: number;
    automationMode?: "intake" | "plan" | "work";
  }) {
    return enqueueGitHubIssueIntakeJob({
      repository,
      userId: overrides?.userId ?? SYSTEM_USER_ID,
      actorContext: createSystemActorContext(overrides?.userId ?? SYSTEM_USER_ID),
      payload: {
        automationMode: overrides?.automationMode ?? "work",
        repository: {
          fullName: "leonardwongly/agentic",
          htmlUrl: "https://github.com/leonardwongly/agentic",
          defaultBranch: "main",
          private: true
        },
        issue: {
          number: overrides?.issueNumber ?? 203,
          nodeId: "I_kwDOAgenticIssue203",
          title: "Prove deployed worker durability and live issue sync",
          body: "Use this issue as an untrusted worker-sync canary.",
          url: `https://github.com/leonardwongly/agentic/issues/${overrides?.issueNumber ?? 203}`,
          authorLogin: "issue-author",
          labels: ["agentic:work"],
          assignees: [],
          createdAt: "2026-05-18T09:00:00.000Z",
          updatedAt: "2026-05-18T09:30:00.000Z"
        },
        deliveryId: `delivery-${overrides?.issueNumber ?? 203}`,
        receivedAt: "2026-05-18T10:00:00.000Z",
        senderLogin: "issue-author",
        trigger: {
          event: "issues",
          action: "sync",
          labelName: null,
          command: null,
          triggerId: "github_app:open_issue_sync"
        }
      }
    });
  }

  it("returns a pollable 202 status for queued GitHub issue intake jobs", async () => {
    const queued = await enqueueIssueJob();
    const response = await genericJobRoute(buildAuthorizedGetRequest(`http://localhost/api/jobs/${queued.id}`), {
      params: Promise.resolve({ id: queued.id })
    });
    const payload = await response.json();

    expect(response.status).toBe(202);
    expectNoStoreHeaders(response);
    expect(payload).toMatchObject({
      job: {
        id: queued.id,
        kind: "github_issue_intake",
        status: "queued",
        repository: "leonardwongly/agentic",
        issueNumber: 203,
        automationMode: "work",
        goalId: queued.payload.goalId,
        workflowId: queued.payload.workflowId,
        triggerId: "github_app:open_issue_sync"
      },
      result: null,
      error: null
    });
    expect(JSON.stringify(payload)).not.toContain("Use this issue as an untrusted worker-sync canary.");
  });

  it("returns a completed goal summary after the worker drains a route-enqueued sync job", async () => {
    const queued = await enqueueIssueJob({
      issueNumber: 204
    });
    const result = await runWorkerRuntime({
      repository,
      selfImprovementRepository: createSelfImprovementRepository({
        baseDir: selfImprovementDir
      }),
      runnerId: "github-issue-job-route-worker",
      maxJobs: 1,
      pollIntervalMs: 10,
      claim: {
        kinds: ["github_issue_intake"]
      }
    });

    expect(result).toEqual({
      processedCount: 1,
      stopReason: "max_jobs"
    });

    const response = await genericJobRoute(buildAuthorizedGetRequest(`http://localhost/api/jobs/${queued.id}`), {
      params: Promise.resolve({ id: queued.id })
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      job: {
        id: queued.id,
        kind: "github_issue_intake",
        status: "completed",
        repository: "leonardwongly/agentic",
        issueNumber: 204,
        goalId: queued.payload.goalId
      },
      result: {
        goalId: queued.payload.goalId
      },
      error: null
    });
  });

  it("does not expose GitHub issue intake jobs owned by another user", async () => {
    const queued = await enqueueIssueJob({
      userId: "different-user",
      issueNumber: 205
    });
    const response = await genericJobRoute(buildAuthorizedGetRequest(`http://localhost/api/jobs/${queued.id}`), {
      params: Promise.resolve({ id: queued.id })
    });
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({
      error: `Job ${queued.id} was not found.`
    });
  });
});
