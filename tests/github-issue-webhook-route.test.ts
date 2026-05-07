import crypto from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID } from "@agentic/contracts";
import type { AgenticRepository } from "@agentic/repository";
import { expect, vi } from "vitest";
import {
  createRouteTestRepository,
  expectOperationalNoStoreHeaders
} from "./route-test-helpers";

vi.mock("../apps/web/lib/server", () => ({
  getSeededRepository: async () => Reflect.get(globalThis, "__agenticRepository") as AgenticRepository
}));

import { POST as githubIssueWebhookRoute } from "../apps/web/app/api/github/issues/webhook/route";

const WEBHOOK_SECRET = "github-webhook-secret-with-at-least-32-chars";

function buildIssuePayload(overrides: Record<string, unknown> = {}) {
  return {
    action: "opened",
    issue: {
      number: 74,
      node_id: "I_kwDOAgenticIssue74",
      title: "Fix flaky GitHub issue automation",
      body: "The issue intake should enqueue a governed Agentic job.",
      html_url: "https://github.com/leonardwongly/agentic/issues/74",
      user: {
        login: "issue-author"
      },
      labels: [
        { name: "bug" },
        { name: "automation" },
        { name: "bug" }
      ],
      assignees: [
        { login: "agentic-bot" }
      ],
      created_at: "2026-05-07T01:00:00.000Z",
      updated_at: "2026-05-07T01:00:00.000Z"
    },
    repository: {
      full_name: "leonardwongly/agentic",
      html_url: "https://github.com/leonardwongly/agentic",
      default_branch: "main",
      private: true
    },
    sender: {
      login: "issue-author"
    },
    ...overrides
  };
}

function signBody(body: string, secret = WEBHOOK_SECRET): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

function buildSignedRequest(payload: unknown, options?: {
  secret?: string;
  signature?: string;
  event?: string;
  deliveryId?: string;
}): Request {
  const body = JSON.stringify(payload);

  return new Request("http://localhost/api/github/issues/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": options?.event ?? "issues",
      "x-github-delivery": options?.deliveryId ?? "delivery-1",
      "x-hub-signature-256": options?.signature ?? signBody(body, options?.secret ?? WEBHOOK_SECRET)
    },
    body
  });
}

describe("GitHub issue webhook route", () => {
  let repository: AgenticRepository;
  const originalSecret = process.env.AGENTIC_GITHUB_WEBHOOK_SECRET;
  const originalStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;
  const originalUserId = process.env.AGENTIC_GITHUB_ISSUE_INTAKE_USER_ID;
  const originalWorkspaceId = process.env.AGENTIC_GITHUB_ISSUE_INTAKE_WORKSPACE_ID;

  beforeEach(async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-github-issue-webhook-"));
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(tempDir, "runtime-store.json");
    process.env.AGENTIC_GITHUB_WEBHOOK_SECRET = WEBHOOK_SECRET;
    delete process.env.AGENTIC_GITHUB_ISSUE_INTAKE_USER_ID;
    delete process.env.AGENTIC_GITHUB_ISSUE_INTAKE_WORKSPACE_ID;

    repository = createRouteTestRepository();
    await repository.seedDefaults(SYSTEM_USER_ID);
    Reflect.set(globalThis, "__agenticRepository", repository);
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.AGENTIC_GITHUB_WEBHOOK_SECRET;
    } else {
      process.env.AGENTIC_GITHUB_WEBHOOK_SECRET = originalSecret;
    }

    if (originalStorePath === undefined) {
      delete process.env.AGENTIC_RUNTIME_STORE_PATH;
    } else {
      process.env.AGENTIC_RUNTIME_STORE_PATH = originalStorePath;
    }

    if (originalUserId === undefined) {
      delete process.env.AGENTIC_GITHUB_ISSUE_INTAKE_USER_ID;
    } else {
      process.env.AGENTIC_GITHUB_ISSUE_INTAKE_USER_ID = originalUserId;
    }

    if (originalWorkspaceId === undefined) {
      delete process.env.AGENTIC_GITHUB_ISSUE_INTAKE_WORKSPACE_ID;
    } else {
      process.env.AGENTIC_GITHUB_ISSUE_INTAKE_WORKSPACE_ID = originalWorkspaceId;
    }

    Reflect.deleteProperty(globalThis, "__agenticRepository");
    vi.restoreAllMocks();
  });

  it("verifies a signed opened issue payload and enqueues a governed intake job", async () => {
    const response = await githubIssueWebhookRoute(buildSignedRequest(buildIssuePayload()));
    const payload = await response.json();
    const jobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["github_issue_intake"]
    });

    expect(response.status).toBe(202);
    expectOperationalNoStoreHeaders(response);
    expect(payload).toMatchObject({
      ok: true,
      job: {
        kind: "github_issue_intake",
        status: "queued",
        repository: "leonardwongly/agentic",
        issueNumber: 74
      }
    });
    expect(payload.statusUrl).toBe(`/api/jobs/${payload.job.id}`);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.priority).toBe("high");
    expect(jobs[0]?.queue).toBe("github-issue-intake");
    expect(jobs[0]?.actorContext?.initiator.kind).toBe("system");
    expect(jobs[0]?.payload).toMatchObject({
      type: "github_issue_intake",
      repository: {
        fullName: "leonardwongly/agentic",
        private: true
      },
      issue: {
        number: 74,
        title: "Fix flaky GitHub issue automation",
        labels: ["bug", "automation"],
        assignees: ["agentic-bot"]
      },
      deliveryId: "delivery-1"
    });
  });

  it("deduplicates duplicate issue-open deliveries by repository and issue number", async () => {
    const first = await githubIssueWebhookRoute(buildSignedRequest(buildIssuePayload(), { deliveryId: "delivery-1" }));
    const second = await githubIssueWebhookRoute(buildSignedRequest(buildIssuePayload(), { deliveryId: "delivery-2" }));
    const firstPayload = await first.json();
    const secondPayload = await second.json();
    const jobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["github_issue_intake"]
    });

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(secondPayload.job.id).toBe(firstPayload.job.id);
    expect(jobs).toHaveLength(1);
  });

  it("rejects unsigned or incorrectly signed issue payloads", async () => {
    const response = await githubIssueWebhookRoute(
      buildSignedRequest(buildIssuePayload(), {
        signature: signBody(JSON.stringify(buildIssuePayload()), "wrong-secret")
      })
    );
    const jobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["github_issue_intake"]
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Invalid GitHub signature." });
    expect(jobs).toHaveLength(0);
  });

  it("acknowledges non-opened issue actions without enqueueing work", async () => {
    const response = await githubIssueWebhookRoute(buildSignedRequest(buildIssuePayload({ action: "edited" })));
    const jobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["github_issue_intake"]
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      ok: true,
      skipped: true,
      reason: "unsupported_action"
    });
    expect(jobs).toHaveLength(0);
  });

  it("rejects oversized issue payloads before parsing JSON", async () => {
    const response = await githubIssueWebhookRoute(
      buildSignedRequest(buildIssuePayload({
        issue: {
          ...buildIssuePayload().issue,
          body: "x".repeat(300_000)
        }
      }))
    );
    const jobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["github_issue_intake"]
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "GitHub issue webhook payload is too large." });
    expect(jobs).toHaveLength(0);
  });

  it("fails closed when the webhook secret is not configured", async () => {
    delete process.env.AGENTIC_GITHUB_WEBHOOK_SECRET;

    const response = await githubIssueWebhookRoute(buildSignedRequest(buildIssuePayload()));
    const jobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["github_issue_intake"]
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "GitHub issue webhook is not configured." });
    expect(jobs).toHaveLength(0);
  });
});
