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

function buildIssueCommentPayload(overrides: Record<string, unknown> = {}) {
  return {
    action: "created",
    issue: {
      ...buildIssuePayload().issue,
      labels: [
        { name: "bug" }
      ]
    },
    comment: {
      id: 9901,
      node_id: "IC_kwDOAgenticComment9901",
      body: "/agentic work",
      author_association: "MEMBER",
      user: {
        login: "repo-member",
        type: "User"
      },
      html_url: "https://github.com/leonardwongly/agentic/issues/74#issuecomment-9901"
    },
    repository: buildIssuePayload().repository,
    sender: {
      login: "repo-member",
      type: "User"
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

function buildSignedStreamRequest(payload: unknown, options?: {
  secret?: string;
  signature?: string;
  event?: string;
  deliveryId?: string;
}): Request {
  const body = JSON.stringify(payload);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < body.length; offset += 16_384) {
        controller.enqueue(encoder.encode(body.slice(offset, offset + 16_384)));
      }

      controller.close();
    }
  });

  return new Request("http://localhost/api/github/issues/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": options?.event ?? "issues",
      "x-github-delivery": options?.deliveryId ?? "delivery-1",
      "x-hub-signature-256": options?.signature ?? signBody(body, options?.secret ?? WEBHOOK_SECRET)
    },
    body: stream,
    duplex: "half"
  } as RequestInit & { duplex: "half" });
}

describe("GitHub issue webhook route", () => {
  let repository: AgenticRepository;
  const originalSecret = process.env.AGENTIC_GITHUB_WEBHOOK_SECRET;
  const originalStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;
  const originalUserId = process.env.AGENTIC_GITHUB_ISSUE_INTAKE_USER_ID;
  const originalWorkspaceId = process.env.AGENTIC_GITHUB_ISSUE_INTAKE_WORKSPACE_ID;
  const originalAllowedRepositories = process.env.AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES;
  const originalAuthorAssociations = process.env.AGENTIC_GITHUB_ISSUE_COMMAND_AUTHOR_ASSOCIATIONS;
  const originalAllowedLogins = process.env.AGENTIC_GITHUB_ISSUE_COMMAND_ALLOWED_LOGINS;
  const originalWorkLabel = process.env.AGENTIC_GITHUB_ISSUE_WORK_LABEL;
  const originalPlanLabel = process.env.AGENTIC_GITHUB_ISSUE_PLAN_LABEL;

  beforeEach(async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-github-issue-webhook-"));
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(tempDir, "runtime-store.json");
    process.env.AGENTIC_GITHUB_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES = "leonardwongly/agentic";
    delete process.env.AGENTIC_GITHUB_ISSUE_INTAKE_USER_ID;
    delete process.env.AGENTIC_GITHUB_ISSUE_INTAKE_WORKSPACE_ID;
    delete process.env.AGENTIC_GITHUB_ISSUE_COMMAND_AUTHOR_ASSOCIATIONS;
    delete process.env.AGENTIC_GITHUB_ISSUE_COMMAND_ALLOWED_LOGINS;
    delete process.env.AGENTIC_GITHUB_ISSUE_WORK_LABEL;
    delete process.env.AGENTIC_GITHUB_ISSUE_PLAN_LABEL;

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

    if (originalAllowedRepositories === undefined) {
      delete process.env.AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES;
    } else {
      process.env.AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES = originalAllowedRepositories;
    }

    if (originalAuthorAssociations === undefined) {
      delete process.env.AGENTIC_GITHUB_ISSUE_COMMAND_AUTHOR_ASSOCIATIONS;
    } else {
      process.env.AGENTIC_GITHUB_ISSUE_COMMAND_AUTHOR_ASSOCIATIONS = originalAuthorAssociations;
    }

    if (originalAllowedLogins === undefined) {
      delete process.env.AGENTIC_GITHUB_ISSUE_COMMAND_ALLOWED_LOGINS;
    } else {
      process.env.AGENTIC_GITHUB_ISSUE_COMMAND_ALLOWED_LOGINS = originalAllowedLogins;
    }

    if (originalWorkLabel === undefined) {
      delete process.env.AGENTIC_GITHUB_ISSUE_WORK_LABEL;
    } else {
      process.env.AGENTIC_GITHUB_ISSUE_WORK_LABEL = originalWorkLabel;
    }

    if (originalPlanLabel === undefined) {
      delete process.env.AGENTIC_GITHUB_ISSUE_PLAN_LABEL;
    } else {
      process.env.AGENTIC_GITHUB_ISSUE_PLAN_LABEL = originalPlanLabel;
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
        issueNumber: 74,
        automationMode: "intake"
      }
    });
    expect(payload.statusUrl).toBe(`/api/jobs/${payload.job.id}`);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.priority).toBe("high");
    expect(jobs[0]?.queue).toBe("github-issue-intake");
    expect(jobs[0]?.actorContext?.initiator.kind).toBe("system");
    expect(jobs[0]?.payload).toMatchObject({
      type: "github_issue_intake",
      automationMode: "intake",
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
      deliveryId: "delivery-1",
      metadata: {
        event: "issues",
        action: "opened",
        triggerId: "issues:opened"
      }
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

  it("rejects non-JSON payloads before signature verification", async () => {
    const response = await githubIssueWebhookRoute(
      new Request("http://localhost/api/github/issues/webhook", {
        method: "POST",
        headers: {
          "content-type": "text/plain",
          "x-github-event": "issues",
          "x-github-delivery": "delivery-plain",
          "x-hub-signature-256": signBody("not-json")
        },
        body: "not-json"
      })
    );
    const jobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["github_issue_intake"]
    });

    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ error: "Content-Type must be application/json." });
    expect(jobs).toHaveLength(0);
  });

  it("rejects missing signature headers", async () => {
    const body = JSON.stringify(buildIssuePayload());
    const request = new Request("http://localhost/api/github/issues/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "issues",
        "x-github-delivery": "delivery-missing-signature"
      },
      body
    });

    const response = await githubIssueWebhookRoute(request);
    const jobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["github_issue_intake"]
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Missing GitHub signature header." });
    expect(await request.text()).toBe(body);
    expect(jobs).toHaveLength(0);
  });

  it("rejects signed payloads with invalid delivery identifiers", async () => {
    const response = await githubIssueWebhookRoute(
      buildSignedRequest(buildIssuePayload(), {
        deliveryId: "delivery id with spaces"
      })
    );
    const jobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["github_issue_intake"]
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid GitHub delivery id." });
    expect(jobs).toHaveLength(0);
  });

  it("acknowledges unsupported signed GitHub events without enqueueing work", async () => {
    const response = await githubIssueWebhookRoute(
      buildSignedRequest(buildIssuePayload(), {
        event: "pull_request",
        deliveryId: "delivery-unsupported-event"
      })
    );
    const jobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["github_issue_intake"]
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      ok: true,
      skipped: true,
      reason: "unsupported_event"
    });
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

  it("enqueues explicit work mode when an authorized repository label is added", async () => {
    const response = await githubIssueWebhookRoute(
      buildSignedRequest(buildIssuePayload({
        action: "labeled",
        label: { name: "agentic:work" },
        issue: {
          ...buildIssuePayload().issue,
          labels: [
            { name: "agentic:work" },
            { name: "bug" }
          ]
        }
      }))
    );
    const payload = await response.json();
    const jobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["github_issue_intake"]
    });

    expect(response.status).toBe(202);
    expect(payload.job).toMatchObject({
      kind: "github_issue_intake",
      repository: "leonardwongly/agentic",
      issueNumber: 74,
      automationMode: "work"
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload).toMatchObject({
      automationMode: "work",
      metadata: {
        event: "issues",
        action: "labeled",
        triggerLabel: "agentic:work",
        command: null,
        triggerId: "issues:labeled:agentic:work"
      }
    });
  });

  it("skips labeled events when the new top-level label is not an Agentic trigger", async () => {
    const response = await githubIssueWebhookRoute(
      buildSignedRequest(buildIssuePayload({
        action: "labeled",
        label: { name: "bug" },
        issue: {
          ...buildIssuePayload().issue,
          labels: [
            { name: "agentic:work" },
            { name: "bug" }
          ]
        }
      }))
    );
    const jobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["github_issue_intake"]
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      ok: true,
      skipped: true,
      reason: "unsupported_label"
    });
    expect(jobs).toHaveLength(0);
  });

  it("enqueues explicit work mode from an authorized exact issue comment command", async () => {
    const response = await githubIssueWebhookRoute(
      buildSignedRequest(buildIssueCommentPayload(), { event: "issue_comment" })
    );
    const payload = await response.json();
    const jobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["github_issue_intake"]
    });

    expect(response.status).toBe(202);
    expect(payload.job).toMatchObject({
      kind: "github_issue_intake",
      repository: "leonardwongly/agentic",
      issueNumber: 74,
      automationMode: "work"
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.idempotencyKey).toContain(":work:");
    expect(jobs[0]?.payload).toMatchObject({
      automationMode: "work",
      metadata: {
        event: "issue_comment",
        action: "created",
        triggerLabel: null,
        command: "/agentic work",
        triggerId: "issue_comment:created:9901"
      }
    });
  });

  it("skips ambiguous command mentions and unauthorized issue comments", async () => {
    const ambiguous = await githubIssueWebhookRoute(
      buildSignedRequest(buildIssueCommentPayload({
        comment: {
          ...buildIssueCommentPayload().comment,
          body: "Please run `/agentic work` after triage."
        }
      }), { event: "issue_comment", deliveryId: "ambiguous-comment" })
    );
    const unauthorized = await githubIssueWebhookRoute(
      buildSignedRequest(buildIssueCommentPayload({
        comment: {
          ...buildIssueCommentPayload().comment,
          id: 9902,
          body: "/agentic work",
          author_association: "NONE",
          user: {
            login: "drive-by-user",
            type: "User"
          }
        },
        sender: {
          login: "drive-by-user",
          type: "User"
        }
      }), { event: "issue_comment", deliveryId: "unauthorized-comment" })
    );
    const bot = await githubIssueWebhookRoute(
      buildSignedRequest(buildIssueCommentPayload({
        comment: {
          ...buildIssueCommentPayload().comment,
          id: 9903,
          body: "/agentic work",
          author_association: "MEMBER",
          user: {
            login: "github-actions[bot]",
            type: "Bot"
          }
        },
        sender: {
          login: "github-actions[bot]",
          type: "Bot"
        }
      }), { event: "issue_comment", deliveryId: "bot-comment" })
    );
    const jobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["github_issue_intake"]
    });

    expect(ambiguous.status).toBe(202);
    expect(await ambiguous.json()).toEqual({
      ok: true,
      skipped: true,
      reason: "no_agentic_command"
    });
    expect(unauthorized.status).toBe(202);
    expect(await unauthorized.json()).toEqual({
      ok: true,
      skipped: true,
      reason: "unauthorized_sender"
    });
    expect(bot.status).toBe(202);
    expect(await bot.json()).toEqual({
      ok: true,
      skipped: true,
      reason: "bot_sender"
    });
    expect(jobs).toHaveLength(0);
  });

  it("skips pull request comments before enqueueing work", async () => {
    const response = await githubIssueWebhookRoute(
      buildSignedRequest(buildIssueCommentPayload({
        issue: {
          ...buildIssueCommentPayload().issue,
          pull_request: {
            url: "https://api.github.com/repos/leonardwongly/agentic/pulls/74"
          }
        }
      }), { event: "issue_comment" })
    );
    const jobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["github_issue_intake"]
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      ok: true,
      skipped: true,
      reason: "pull_request_event"
    });
    expect(jobs).toHaveLength(0);
  });

  it("rejects signed events from repositories outside the allowlist", async () => {
    const response = await githubIssueWebhookRoute(
      buildSignedRequest(buildIssuePayload({
        repository: {
          full_name: "unknown/repo",
          html_url: "https://github.com/unknown/repo",
          default_branch: "main",
          private: true
        }
      }))
    );
    const jobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["github_issue_intake"]
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "GitHub repository is not allowed for issue automation." });
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

  it("rejects streamed oversized issue payloads without declared content length", async () => {
    const response = await githubIssueWebhookRoute(
      buildSignedStreamRequest(buildIssuePayload({
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
