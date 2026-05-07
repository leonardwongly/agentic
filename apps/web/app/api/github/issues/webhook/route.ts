import crypto from "node:crypto";
import { z } from "zod";
import {
  SYSTEM_USER_ID,
  createSystemActorContext,
  nowIso
} from "@agentic/contracts";
import { enqueueGitHubIssueIntakeJob } from "@agentic/worker-runtime";
import {
  ApiRouteError,
  handleOperationalApiError,
  operationalJson,
  withApiTelemetry
} from "../../../../../lib/api-response";
import { getSeededRepository } from "../../../../../lib/server";

export const runtime = "nodejs";

const MAX_GITHUB_ISSUE_WEBHOOK_BYTES = 256_000;
const MAX_ISSUE_BODY_LENGTH = 10_000;

const GitHubUserSchema = z
  .object({
    login: z.string().trim().min(1).max(120).optional().nullable()
  })
  .passthrough();

const GitHubLabelSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional().nullable()
  })
  .passthrough();

const GitHubIssueWebhookPayloadSchema = z
  .object({
    action: z.string().trim().min(1).max(80),
    issue: z
      .object({
        number: z.number().int().positive().max(1_000_000_000),
        node_id: z.string().trim().min(1).max(200).optional().nullable(),
        title: z.string().trim().min(1).max(300),
        body: z.string().optional().nullable(),
        html_url: z.string().url().max(500),
        user: GitHubUserSchema.optional().nullable(),
        labels: z.array(GitHubLabelSchema).max(100).default([]),
        assignees: z.array(GitHubUserSchema).max(100).default([]),
        pull_request: z.unknown().optional(),
        created_at: z.string().datetime(),
        updated_at: z.string().datetime()
      })
      .passthrough(),
    repository: z
      .object({
        full_name: z.string().trim().min(3).max(150).regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u),
        html_url: z.string().url().max(500),
        default_branch: z.string().trim().min(1).max(200),
        private: z.boolean().default(false)
      })
      .passthrough(),
    sender: GitHubUserSchema.optional().nullable()
  })
  .passthrough();

function readBoundedRuntimeId(envName: string, maxLength: number): string | null {
  const value = process.env[envName]?.trim() ?? "";

  if (!value) {
    return null;
  }

  if (value.length > maxLength) {
    throw new ApiRouteError(503, `${envName} is too long.`);
  }

  return value;
}

function requireWebhookSecret(): string {
  const secret = process.env.AGENTIC_GITHUB_WEBHOOK_SECRET?.trim() ?? "";

  if (!secret) {
    throw new ApiRouteError(503, "GitHub issue webhook is not configured.");
  }

  if (secret.length < 32) {
    throw new ApiRouteError(503, "GitHub issue webhook secret is too short.");
  }

  return secret;
}

function hasJsonContentType(request: Request): boolean {
  return (request.headers.get("content-type") ?? "").toLowerCase().includes("application/json");
}

function hasOversizedDeclaredBody(request: Request): boolean {
  const header = request.headers.get("content-length");

  if (!header) {
    return false;
  }

  const contentLength = Number(header);
  return Number.isFinite(contentLength) && contentLength > MAX_GITHUB_ISSUE_WEBHOOK_BYTES;
}

function verifyGitHubSignature(params: {
  rawBody: string;
  signature: string;
  secret: string;
}): boolean {
  const provided = params.signature.trim().toLowerCase();

  if (!/^sha256=[a-f0-9]{64}$/u.test(provided)) {
    return false;
  }

  const expected = `sha256=${crypto
    .createHmac("sha256", params.secret)
    .update(params.rawBody)
    .digest("hex")}`;
  const providedBuffer = Buffer.from(provided, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  return providedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

function uniqueBoundedNames(values: Array<{ name?: string | null }>, maxItems: number): string[] {
  const names = new Set<string>();

  for (const value of values) {
    const name = value.name?.trim();

    if (name) {
      names.add(name);
    }

    if (names.size >= maxItems) {
      break;
    }
  }

  return Array.from(names);
}

function uniqueBoundedLogins(values: Array<{ login?: string | null }>, maxItems: number): string[] {
  const logins = new Set<string>();

  for (const value of values) {
    const login = value.login?.trim();

    if (login) {
      logins.add(login);
    }

    if (logins.size >= maxItems) {
      break;
    }
  }

  return Array.from(logins);
}

function normalizeIssueBody(value: string | null | undefined): string | null {
  const body = value?.trim() ?? "";

  if (!body) {
    return null;
  }

  return body.length > MAX_ISSUE_BODY_LENGTH ? body.slice(0, MAX_ISSUE_BODY_LENGTH) : body;
}

function parseGitHubJsonPayload(rawBody: string): z.infer<typeof GitHubIssueWebhookPayloadSchema> | null {
  let payload: unknown;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return null;
  }

  const parsed = GitHubIssueWebhookPayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

export async function POST(request: Request) {
  return withApiTelemetry(request, "api.github.issues.webhook", async () => {
    try {
      const secret = requireWebhookSecret();

      if (!hasJsonContentType(request)) {
        return operationalJson({ error: "Content-Type must be application/json." }, { status: 415 });
      }

      if (hasOversizedDeclaredBody(request)) {
        return operationalJson({ error: "GitHub issue webhook payload is too large." }, { status: 413 });
      }

      const rawBody = await request.text();

      if (Buffer.byteLength(rawBody, "utf8") > MAX_GITHUB_ISSUE_WEBHOOK_BYTES) {
        return operationalJson({ error: "GitHub issue webhook payload is too large." }, { status: 413 });
      }

      const signature = request.headers.get("x-hub-signature-256") ?? "";

      if (!signature) {
        return operationalJson({ error: "Missing GitHub signature header." }, { status: 401 });
      }

      if (!verifyGitHubSignature({ rawBody, signature, secret })) {
        return operationalJson({ error: "Invalid GitHub signature." }, { status: 401 });
      }

      const eventName = request.headers.get("x-github-event")?.trim() ?? "";
      const deliveryId = request.headers.get("x-github-delivery")?.trim() ?? "";

      if (eventName !== "issues") {
        return operationalJson({ ok: true, skipped: true, reason: "unsupported_event" }, { status: 202 });
      }

      if (!/^[A-Za-z0-9_.:-]{1,120}$/u.test(deliveryId)) {
        return operationalJson({ error: "Invalid GitHub delivery id." }, { status: 400 });
      }

      const payload = parseGitHubJsonPayload(rawBody);

      if (!payload) {
        return operationalJson({ error: "Invalid GitHub issue payload." }, { status: 400 });
      }

      if (payload.action !== "opened") {
        return operationalJson({ ok: true, skipped: true, reason: "unsupported_action" }, { status: 202 });
      }

      if (payload.issue.pull_request) {
        return operationalJson({ ok: true, skipped: true, reason: "pull_request_event" }, { status: 202 });
      }

      const userId = readBoundedRuntimeId("AGENTIC_GITHUB_ISSUE_INTAKE_USER_ID", 120) ?? SYSTEM_USER_ID;
      const workspaceId = readBoundedRuntimeId("AGENTIC_GITHUB_ISSUE_INTAKE_WORKSPACE_ID", 160);
      const repository = await getSeededRepository();
      const job = await enqueueGitHubIssueIntakeJob({
        repository,
        userId,
        actorContext: createSystemActorContext(userId),
        payload: {
          repository: {
            fullName: payload.repository.full_name,
            htmlUrl: payload.repository.html_url,
            defaultBranch: payload.repository.default_branch,
            private: payload.repository.private
          },
          issue: {
            number: payload.issue.number,
            nodeId: payload.issue.node_id?.trim() || null,
            title: payload.issue.title,
            body: normalizeIssueBody(payload.issue.body),
            url: payload.issue.html_url,
            authorLogin: payload.issue.user?.login?.trim() || null,
            labels: uniqueBoundedNames(payload.issue.labels, 50),
            assignees: uniqueBoundedLogins(payload.issue.assignees, 20),
            createdAt: payload.issue.created_at,
            updatedAt: payload.issue.updated_at
          },
          deliveryId,
          receivedAt: nowIso(),
          senderLogin: payload.sender?.login?.trim() || null,
          workspaceId,
          agentId: null
        }
      });

      return operationalJson(
        {
          ok: true,
          job: {
            id: job.id,
            kind: job.kind,
            status: job.status,
            repository: job.payload.repository.fullName,
            issueNumber: job.payload.issue.number,
            goalId: job.payload.goalId,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt
          },
          statusUrl: `/api/jobs/${job.id}`
        },
        { status: 202 }
      );
    } catch (error) {
      return handleOperationalApiError(error, "Failed to enqueue GitHub issue intake job.");
    }
  });
}
