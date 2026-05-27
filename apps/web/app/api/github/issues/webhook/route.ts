import crypto from "node:crypto";
import { z } from "zod";
import {
  DEFAULT_OWNER_USER_ID,
  createSystemActorContext,
  nowIso
} from "@agentic/contracts";
import { enqueueGitHubIssueIntakeJob } from "@agentic/worker-runtime";
import {
  ApiRouteError,
  handleOperationalApiError,
  operationalJson,
  readBoundedRequestText,
  withApiTelemetry
} from "../../../../../lib/api-response";
import { getSeededRepository } from "../../../../../lib/server";

export const runtime = "nodejs";

const MAX_GITHUB_ISSUE_WEBHOOK_BYTES = 256_000;
const MAX_ISSUE_BODY_LENGTH = 10_000;
const DEFAULT_WORK_LABEL = "agentic:work";
const DEFAULT_PLAN_LABEL = "agentic:plan";
const DEFAULT_COMMAND_AUTHOR_ASSOCIATIONS = "OWNER,MEMBER,COLLABORATOR";
const AGENTIC_COMMAND_PATTERN = /^\/agentic[ \t]+(work|plan)$/iu;
const GITHUB_REPOSITORY_FULL_NAME_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

const GitHubUserSchema = z
  .object({
    login: z.string().trim().min(1).max(120).optional().nullable(),
    type: z.string().trim().min(1).max(80).optional().nullable()
  })
  .passthrough();

const GitHubLabelSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional().nullable()
  })
  .passthrough();

const GitHubIssueSchema = z
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
  .passthrough();

const GitHubRepositorySchema = z
  .object({
    full_name: z.string().trim().min(3).max(150).regex(GITHUB_REPOSITORY_FULL_NAME_PATTERN),
    html_url: z.string().url().max(500),
    default_branch: z.string().trim().min(1).max(200),
    private: z.boolean().default(false)
  })
  .passthrough();

const GitHubIssueEventPayloadSchema = z
  .object({
    action: z.string().trim().min(1).max(80),
    issue: GitHubIssueSchema,
    label: GitHubLabelSchema.optional().nullable(),
    repository: GitHubRepositorySchema,
    sender: GitHubUserSchema.optional().nullable()
  })
  .passthrough();

const GitHubIssueCommentEventPayloadSchema = z
  .object({
    action: z.string().trim().min(1).max(80),
    issue: GitHubIssueSchema,
    comment: z
      .object({
        id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        node_id: z.string().trim().min(1).max(200).optional().nullable(),
        body: z.string().max(10_000).optional().nullable(),
        author_association: z.string().trim().min(1).max(80).optional().nullable(),
        user: GitHubUserSchema.optional().nullable(),
        html_url: z.string().url().max(500).optional().nullable()
      })
      .passthrough(),
    repository: GitHubRepositorySchema,
    sender: GitHubUserSchema.optional().nullable()
  })
  .passthrough();

type GitHubIssueRecord = z.infer<typeof GitHubIssueSchema>;
type GitHubRepositoryRecord = z.infer<typeof GitHubRepositorySchema>;
type GitHubIssueAutomationMode = "intake" | "plan" | "work";
type GitHubIssueTriggerEvent = "issues" | "issue_comment";
type GitHubIssueTriggerAction = "opened" | "reopened" | "labeled" | "created";

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

function normalizeCsvToken(value: string): string {
  return value.trim().toLowerCase();
}

function parseCsvSet(value: string, maxItems: number): Set<string> {
  const result = new Set<string>();

  for (const token of value.split(",")) {
    const normalized = normalizeCsvToken(token);

    if (normalized) {
      result.add(normalized);
    }

    if (result.size > maxItems) {
      throw new ApiRouteError(503, "GitHub issue automation configuration contains too many entries.");
    }
  }

  return result;
}

function requireAllowedRepositories(): Set<string> {
  const raw = process.env.AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES?.trim() ?? "";

  if (!raw) {
    throw new ApiRouteError(503, "GitHub issue allowed repositories are not configured.");
  }

  const repositories = parseCsvSet(raw, 50);

  if (repositories.size === 0) {
    throw new ApiRouteError(503, "GitHub issue allowed repositories are not configured.");
  }

  for (const repository of repositories) {
    if (!GITHUB_REPOSITORY_FULL_NAME_PATTERN.test(repository)) {
      throw new ApiRouteError(503, "GitHub issue allowed repository configuration is invalid.");
    }
  }

  return repositories;
}

function assertRepositoryAllowed(fullName: string) {
  const allowedRepositories = requireAllowedRepositories();

  if (!allowedRepositories.has(fullName.trim().toLowerCase())) {
    throw new ApiRouteError(403, "GitHub repository is not allowed for issue automation.");
  }
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase();
}

function readConfiguredLabel(envName: string, fallback: string): string {
  const value = process.env[envName]?.trim() || fallback;

  if (value.length > 80) {
    throw new ApiRouteError(503, `${envName} is too long.`);
  }

  return normalizeLabel(value);
}

function getAutomationLabels() {
  return {
    work: readConfiguredLabel("AGENTIC_GITHUB_ISSUE_WORK_LABEL", DEFAULT_WORK_LABEL),
    plan: readConfiguredLabel("AGENTIC_GITHUB_ISSUE_PLAN_LABEL", DEFAULT_PLAN_LABEL)
  };
}

function findAutomationLabel(labels: Array<{ name?: string | null }>): {
  mode: "work" | "plan" | null;
  labelName: string | null;
} {
  const configured = getAutomationLabels();

  for (const label of labels) {
    const name = label.name?.trim();
    const normalized = name ? normalizeLabel(name) : "";

    if (normalized === configured.work) {
      return { mode: "work", labelName: name ?? null };
    }

    if (normalized === configured.plan) {
      return { mode: "plan", labelName: name ?? null };
    }
  }

  return { mode: null, labelName: null };
}

function readCommandAuthorAssociations(): Set<string> {
  const raw = process.env.AGENTIC_GITHUB_ISSUE_COMMAND_AUTHOR_ASSOCIATIONS?.trim() ||
    DEFAULT_COMMAND_AUTHOR_ASSOCIATIONS;
  return new Set(Array.from(parseCsvSet(raw, 20), (value) => value.toUpperCase()));
}

function readCommandAllowedLogins(): Set<string> | null {
  const raw = process.env.AGENTIC_GITHUB_ISSUE_COMMAND_ALLOWED_LOGINS?.trim() ?? "";

  if (!raw) {
    return null;
  }

  return parseCsvSet(raw, 100);
}

function isBotLogin(login: string | null): boolean {
  const normalized = login?.trim().toLowerCase() ?? "";
  return normalized.endsWith("[bot]") || normalized === "github-actions" || normalized === "agentic-bot";
}

function authorizeCommentCommand(params: {
  senderLogin: string | null;
  senderType: string | null;
  commentAuthorAssociation: string | null;
}): { authorized: true } | { authorized: false; reason: string } {
  const senderLogin = params.senderLogin?.trim() || null;
  const senderType = params.senderType?.trim().toLowerCase() || null;

  if (senderType === "bot" || isBotLogin(senderLogin)) {
    return { authorized: false, reason: "bot_sender" };
  }

  const allowedLogins = readCommandAllowedLogins();

  if (allowedLogins && (!senderLogin || !allowedLogins.has(senderLogin.toLowerCase()))) {
    return { authorized: false, reason: "unauthorized_sender" };
  }

  const allowedAssociations = readCommandAuthorAssociations();
  const authorAssociation = params.commentAuthorAssociation?.trim().toUpperCase() ?? "";

  if (!allowedAssociations.has(authorAssociation)) {
    return { authorized: false, reason: "unauthorized_sender" };
  }

  return { authorized: true };
}

function parseAgenticCommand(value: string | null | undefined): "work" | "plan" | null {
  const match = value?.trim().match(AGENTIC_COMMAND_PATTERN);
  return match?.[1]?.toLowerCase() === "work" ? "work" : match?.[1]?.toLowerCase() === "plan" ? "plan" : null;
}

function parseJson(rawBody: string): unknown | null {
  let payload: unknown;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return null;
  }

  return payload;
}

function parseGitHubIssueEventPayload(rawBody: string): z.infer<typeof GitHubIssueEventPayloadSchema> | null {
  const payload = parseJson(rawBody);
  const parsed = GitHubIssueEventPayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

function parseGitHubIssueCommentEventPayload(rawBody: string): z.infer<typeof GitHubIssueCommentEventPayloadSchema> | null {
  const payload = parseJson(rawBody);
  const parsed = GitHubIssueCommentEventPayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

export async function POST(request: Request) {
  return withApiTelemetry(request, "api.github.issues.webhook", async () => {
    try {
      const secret = requireWebhookSecret();

      if (!hasJsonContentType(request)) {
        return operationalJson({ error: "Content-Type must be application/json." }, { status: 415 });
      }

      const signature = request.headers.get("x-hub-signature-256") ?? "";

      if (!signature) {
        return operationalJson({ error: "Missing GitHub signature header." }, { status: 401 });
      }

      const rawBody = await readBoundedRequestText(request, {
        maxBytes: MAX_GITHUB_ISSUE_WEBHOOK_BYTES,
        tooLargeMessage: "GitHub issue webhook payload is too large."
      });

      if (!verifyGitHubSignature({ rawBody, signature, secret })) {
        return operationalJson({ error: "Invalid GitHub signature." }, { status: 401 });
      }

      const eventName = request.headers.get("x-github-event")?.trim() ?? "";
      const deliveryId = request.headers.get("x-github-delivery")?.trim() ?? "";

      if (eventName !== "issues" && eventName !== "issue_comment") {
        return operationalJson({ ok: true, skipped: true, reason: "unsupported_event" }, { status: 202 });
      }

      if (!/^[A-Za-z0-9_.:-]{1,120}$/u.test(deliveryId)) {
        return operationalJson({ error: "Invalid GitHub delivery id." }, { status: 400 });
      }

      let selected: {
        event: GitHubIssueTriggerEvent;
        action: GitHubIssueTriggerAction;
        automationMode: GitHubIssueAutomationMode;
        issue: GitHubIssueRecord;
        repository: GitHubRepositoryRecord;
        senderLogin: string | null;
        triggerLabel: string | null;
        command: string | null;
        triggerId: string | null;
      } | null = null;

      if (eventName === "issues") {
        const payload = parseGitHubIssueEventPayload(rawBody);

        if (!payload) {
          return operationalJson({ error: "Invalid GitHub issue payload." }, { status: 400 });
        }

        if (payload.issue.pull_request) {
          return operationalJson({ ok: true, skipped: true, reason: "pull_request_event" }, { status: 202 });
        }

        if (payload.action === "opened" || payload.action === "reopened") {
          selected = {
            event: "issues",
            action: payload.action,
            automationMode: "intake",
            issue: payload.issue,
            repository: payload.repository,
            senderLogin: payload.sender?.login?.trim() || null,
            triggerLabel: null,
            command: null,
            triggerId: `issues:${payload.action}`
          };
        } else if (payload.action === "labeled") {
          const labelAutomation = findAutomationLabel(payload.label ? [payload.label] : []);

          if (!labelAutomation.mode) {
            return operationalJson({ ok: true, skipped: true, reason: "unsupported_label" }, { status: 202 });
          }

          selected = {
            event: "issues",
            action: "labeled",
            automationMode: labelAutomation.mode,
            issue: payload.issue,
            repository: payload.repository,
            senderLogin: payload.sender?.login?.trim() || null,
            triggerLabel: labelAutomation.labelName,
            command: null,
            triggerId: `issues:labeled:${normalizeLabel(labelAutomation.labelName ?? labelAutomation.mode)}`
          };
        } else {
          return operationalJson({ ok: true, skipped: true, reason: "unsupported_action" }, { status: 202 });
        }
      }

      if (eventName === "issue_comment") {
        const payload = parseGitHubIssueCommentEventPayload(rawBody);

        if (!payload) {
          return operationalJson({ error: "Invalid GitHub issue comment payload." }, { status: 400 });
        }

        if (payload.action !== "created") {
          return operationalJson({ ok: true, skipped: true, reason: "unsupported_action" }, { status: 202 });
        }

        if (payload.issue.pull_request) {
          return operationalJson({ ok: true, skipped: true, reason: "pull_request_event" }, { status: 202 });
        }

        const command = parseAgenticCommand(payload.comment.body);

        if (!command) {
          return operationalJson({ ok: true, skipped: true, reason: "no_agentic_command" }, { status: 202 });
        }

        const senderLogin = payload.sender?.login?.trim() || payload.comment.user?.login?.trim() || null;
        const authorization = authorizeCommentCommand({
          senderLogin,
          senderType: payload.sender?.type?.trim() || payload.comment.user?.type?.trim() || null,
          commentAuthorAssociation: payload.comment.author_association?.trim() || null
        });

        if (!authorization.authorized) {
          return operationalJson({ ok: true, skipped: true, reason: authorization.reason }, { status: 202 });
        }

        selected = {
          event: "issue_comment",
          action: "created",
          automationMode: command,
          issue: payload.issue,
          repository: payload.repository,
          senderLogin,
          triggerLabel: null,
          command: `/agentic ${command}`,
          triggerId: `issue_comment:created:${payload.comment.id}`
        };
      }

      if (!selected) {
        return operationalJson({ ok: true, skipped: true, reason: "unsupported_event" }, { status: 202 });
      }

      assertRepositoryAllowed(selected.repository.full_name);

      const userId = readBoundedRuntimeId("AGENTIC_GITHUB_ISSUE_INTAKE_USER_ID", 120) ?? DEFAULT_OWNER_USER_ID;
      const workspaceId = readBoundedRuntimeId("AGENTIC_GITHUB_ISSUE_INTAKE_WORKSPACE_ID", 160);
      const repository = await getSeededRepository();
      const job = await enqueueGitHubIssueIntakeJob({
        repository,
        userId,
        actorContext: createSystemActorContext(userId),
        payload: {
          automationMode: selected.automationMode,
          repository: {
            fullName: selected.repository.full_name,
            htmlUrl: selected.repository.html_url,
            defaultBranch: selected.repository.default_branch,
            private: selected.repository.private
          },
          issue: {
            number: selected.issue.number,
            nodeId: selected.issue.node_id?.trim() || null,
            title: selected.issue.title,
            body: normalizeIssueBody(selected.issue.body),
            url: selected.issue.html_url,
            authorLogin: selected.issue.user?.login?.trim() || null,
            labels: uniqueBoundedNames(selected.issue.labels, 50),
            assignees: uniqueBoundedLogins(selected.issue.assignees, 20),
            createdAt: selected.issue.created_at,
            updatedAt: selected.issue.updated_at
          },
          deliveryId,
          receivedAt: nowIso(),
          senderLogin: selected.senderLogin,
          trigger: {
            event: selected.event,
            action: selected.action,
            labelName: selected.triggerLabel,
            command: selected.command,
            triggerId: selected.triggerId
          },
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
            automationMode: job.payload.automationMode,
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
