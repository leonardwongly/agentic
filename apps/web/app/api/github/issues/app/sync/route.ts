import crypto from "node:crypto";
import { z } from "zod";
import {
  GitHubIssueAutomationModeSchema,
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
} from "../../../../../../lib/api-response";
import { getSeededRepository } from "../../../../../../lib/server";

export const runtime = "nodejs";

const GITHUB_API_VERSION = "2022-11-28";
const DEFAULT_GITHUB_API_BASE_URL = "https://api.github.com";
const DEFAULT_MAX_ISSUES_PER_REPOSITORY = 100;
const MAX_ISSUES_PER_REPOSITORY = 500;
const MAX_GITHUB_ISSUE_BODY_LENGTH = 100_000;
const MAX_JOB_ISSUE_BODY_LENGTH = 10_000;
const GITHUB_REQUEST_TIMEOUT_MS = 10_000;
const GITHUB_REPOSITORY_FULL_NAME_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const GITHUB_INSTALLATION_ID_PATTERN = /^[1-9][0-9]{0,19}$/u;

const GitHubAppInstallationTokenResponseSchema = z
  .object({
    token: z.string().trim().min(1),
    expires_at: z.string().datetime()
  })
  .passthrough();

const GitHubRepositoryResponseSchema = z
  .object({
    full_name: z.string().trim().min(3).max(150).regex(GITHUB_REPOSITORY_FULL_NAME_PATTERN),
    html_url: z.string().url().max(500),
    default_branch: z.string().trim().min(1).max(200),
    private: z.boolean()
  })
  .passthrough();

const GitHubUserSchema = z
  .object({
    login: z.string().trim().min(1).max(120).optional().nullable()
  })
  .passthrough();

const GitHubLabelSchema = z.union([
  z.string().trim().min(1).max(80),
  z
    .object({
      name: z.string().trim().min(1).max(80).optional().nullable()
    })
    .passthrough()
]);

const GitHubIssueResponseSchema = z
  .object({
    number: z.number().int().positive().max(1_000_000_000),
    node_id: z.string().trim().min(1).max(200).optional().nullable(),
    title: z.string().trim().min(1).max(300),
    body: z.string().max(MAX_GITHUB_ISSUE_BODY_LENGTH).optional().nullable(),
    html_url: z.string().url().max(500),
    user: GitHubUserSchema.optional().nullable(),
    labels: z.array(GitHubLabelSchema).max(100).default([]),
    assignees: z.array(GitHubUserSchema).max(100).default([]),
    pull_request: z.unknown().optional(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime()
  })
  .passthrough();

const GitHubIssuesResponseSchema = z.array(GitHubIssueResponseSchema).max(100);

type GitHubRepositoryResponse = z.infer<typeof GitHubRepositoryResponseSchema>;
type GitHubIssueResponse = z.infer<typeof GitHubIssueResponseSchema>;

type GitHubAppIssueSyncConfig = {
  appId: string;
  installationId: string;
  privateKey: string;
  apiBaseUrl: string;
  repositories: string[];
  automationMode: "plan" | "work";
  maxIssuesPerRepository: number;
  userId: string;
  workspaceId: string | null;
};

function readRequiredEnv(name: string, maxLength: number): string {
  const value = process.env[name]?.trim() ?? "";

  if (!value) {
    throw new ApiRouteError(503, `${name} is not configured.`);
  }

  if (value.length > maxLength) {
    throw new ApiRouteError(503, `${name} is too long.`);
  }

  return value;
}

function readOptionalRuntimeId(envName: string, maxLength: number): string | null {
  const value = process.env[envName]?.trim() ?? "";

  if (!value) {
    return null;
  }

  if (value.length > maxLength) {
    throw new ApiRouteError(503, `${envName} is too long.`);
  }

  return value;
}

function readPositiveIntegerEnv(name: string, fallback: number, max: number): number {
  const raw = process.env[name]?.trim() ?? "";

  if (!raw) {
    return fallback;
  }

  const value = Number(raw);

  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new ApiRouteError(503, `${name} must be an integer between 1 and ${max}.`);
  }

  return value;
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

function readAllowedRepositories(): string[] {
  const raw = readRequiredEnv("AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES", 5_000);
  const repositories = Array.from(parseCsvSet(raw, 50));

  if (repositories.length === 0) {
    throw new ApiRouteError(503, "GitHub issue allowed repositories are not configured.");
  }

  for (const repository of repositories) {
    if (!GITHUB_REPOSITORY_FULL_NAME_PATTERN.test(repository)) {
      throw new ApiRouteError(503, "GitHub issue allowed repository configuration is invalid.");
    }
  }

  return repositories;
}

function normalizePrivateKey(value: string): string {
  const normalized = value.replace(/\\n/gu, "\n").trim();

  if (normalized.includes("-----BEGIN")) {
    return normalized;
  }

  try {
    const decoded = Buffer.from(normalized, "base64").toString("utf8").trim();

    if (decoded.includes("-----BEGIN")) {
      return decoded;
    }
  } catch {
    // Fall through to the original value so signing reports a configuration error.
  }

  return normalized;
}

function readGitHubApiBaseUrl(): string {
  const raw = process.env.AGENTIC_GITHUB_APP_API_BASE_URL?.trim() || DEFAULT_GITHUB_API_BASE_URL;
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new ApiRouteError(503, "AGENTIC_GITHUB_APP_API_BASE_URL is invalid.");
  }

  if (url.protocol !== "https:") {
    throw new ApiRouteError(503, "AGENTIC_GITHUB_APP_API_BASE_URL must use https.");
  }

  return url.toString().replace(/\/$/u, "");
}

function readAutomationMode(): "plan" | "work" {
  const mode = process.env.AGENTIC_GITHUB_APP_SYNC_AUTOMATION_MODE?.trim() || "work";
  const parsed = GitHubIssueAutomationModeSchema.safeParse(mode);

  if (!parsed.success || parsed.data === "intake") {
    throw new ApiRouteError(503, "AGENTIC_GITHUB_APP_SYNC_AUTOMATION_MODE must be plan or work.");
  }

  return parsed.data;
}

function readGitHubAppIssueSyncConfig(): GitHubAppIssueSyncConfig {
  const appId = readRequiredEnv("AGENTIC_GITHUB_APP_ID", 32);
  const installationId = readRequiredEnv("AGENTIC_GITHUB_APP_INSTALLATION_ID", 32);

  if (!GITHUB_INSTALLATION_ID_PATTERN.test(appId)) {
    throw new ApiRouteError(503, "AGENTIC_GITHUB_APP_ID is invalid.");
  }

  if (!GITHUB_INSTALLATION_ID_PATTERN.test(installationId)) {
    throw new ApiRouteError(503, "AGENTIC_GITHUB_APP_INSTALLATION_ID is invalid.");
  }

  return {
    appId,
    installationId,
    privateKey: normalizePrivateKey(readRequiredEnv("AGENTIC_GITHUB_APP_PRIVATE_KEY", 12_000)),
    apiBaseUrl: readGitHubApiBaseUrl(),
    repositories: readAllowedRepositories(),
    automationMode: readAutomationMode(),
    maxIssuesPerRepository: readPositiveIntegerEnv(
      "AGENTIC_GITHUB_APP_SYNC_MAX_ISSUES_PER_REPOSITORY",
      DEFAULT_MAX_ISSUES_PER_REPOSITORY,
      MAX_ISSUES_PER_REPOSITORY
    ),
    userId: readOptionalRuntimeId("AGENTIC_GITHUB_ISSUE_INTAKE_USER_ID", 120) ?? SYSTEM_USER_ID,
    workspaceId: readOptionalRuntimeId("AGENTIC_GITHUB_ISSUE_INTAKE_WORKSPACE_ID", 160)
  };
}

function requireSyncSecret(): string {
  const secret = readRequiredEnv("AGENTIC_GITHUB_APP_SYNC_SECRET", 512);

  if (secret.length < 32) {
    throw new ApiRouteError(503, "AGENTIC_GITHUB_APP_SYNC_SECRET is too short.");
  }

  return secret;
}

function extractBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer[ \t]+(.+)$/iu);
  return match?.[1]?.trim() || null;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftHash = crypto.createHash("sha256").update(left).digest();
  const rightHash = crypto.createHash("sha256").update(right).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

function assertSyncAuthorized(request: Request, expectedSecret: string) {
  const provided = extractBearerToken(request);

  if (!provided || !constantTimeEqual(provided, expectedSecret)) {
    throw new ApiRouteError(401, "Invalid GitHub App issue sync credentials.");
  }
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function createGitHubAppJwt(config: Pick<GitHubAppIssueSyncConfig, "appId" | "privateKey">): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({
    alg: "RS256",
    typ: "JWT"
  });
  const payload = base64UrlJson({
    iat: nowSeconds - 60,
    exp: nowSeconds + 9 * 60,
    iss: config.appId
  });
  const signingInput = `${header}.${payload}`;

  try {
    const signature = crypto.createSign("RSA-SHA256").update(signingInput).end().sign(config.privateKey, "base64url");
    return `${signingInput}.${signature}`;
  } catch {
    throw new ApiRouteError(503, "AGENTIC_GITHUB_APP_PRIVATE_KEY is invalid.");
  }
}

function githubHeaders(token: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "agentic-github-app-issue-sync",
    "X-GitHub-Api-Version": GITHUB_API_VERSION
  };
}

async function githubRequest<T>(params: {
  url: string;
  method?: "GET" | "POST";
  token: string;
  schema: z.ZodType<T>;
}): Promise<{ data: T; link: string | null }> {
  let response: Response;

  try {
    response = await fetch(params.url, {
      method: params.method ?? "GET",
      headers: githubHeaders(params.token),
      signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS)
    });
  } catch {
    throw new ApiRouteError(502, "GitHub App issue sync request failed.");
  }

  if (!response.ok) {
    throw new ApiRouteError(response.status >= 500 ? 502 : 424, "GitHub App issue sync request failed.");
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw new ApiRouteError(502, "GitHub App issue sync received an invalid GitHub response.");
  }

  const parsed = params.schema.safeParse(payload);

  if (!parsed.success) {
    throw new ApiRouteError(502, "GitHub App issue sync received an invalid GitHub response.");
  }

  return {
    data: parsed.data,
    link: response.headers.get("link")
  };
}

async function createInstallationAccessToken(config: GitHubAppIssueSyncConfig): Promise<string> {
  const jwt = createGitHubAppJwt(config);
  const response = await githubRequest({
    url: `${config.apiBaseUrl}/app/installations/${encodeURIComponent(config.installationId)}/access_tokens`,
    method: "POST",
    token: jwt,
    schema: GitHubAppInstallationTokenResponseSchema
  });

  return response.data.token;
}

function parseNextLink(linkHeader: string | null, apiBaseUrl: string): string | null {
  if (!linkHeader) {
    return null;
  }

  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/u);

    if (match?.[1]) {
      const nextUrl = match[1];

      if (!nextUrl.startsWith(`${apiBaseUrl}/`)) {
        throw new ApiRouteError(502, "GitHub App issue sync received an unsafe pagination link.");
      }

      return nextUrl;
    }
  }

  return null;
}

function buildRepoUrl(apiBaseUrl: string, repositoryFullName: string): string {
  const [owner, repo] = repositoryFullName.split("/");
  return `${apiBaseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

async function fetchGitHubRepository(config: GitHubAppIssueSyncConfig, token: string, repositoryFullName: string) {
  const result = await githubRequest({
    url: buildRepoUrl(config.apiBaseUrl, repositoryFullName),
    token,
    schema: GitHubRepositoryResponseSchema
  });

  if (result.data.full_name.trim().toLowerCase() !== repositoryFullName) {
    throw new ApiRouteError(403, "GitHub App issue sync returned a repository outside the allowlist.");
  }

  return result.data;
}

async function fetchOpenIssues(config: GitHubAppIssueSyncConfig, token: string, repositoryFullName: string) {
  const collected: GitHubIssueResponse[] = [];
  const perPage = Math.min(100, config.maxIssuesPerRepository);
  let nextUrl: string | null =
    `${buildRepoUrl(config.apiBaseUrl, repositoryFullName)}/issues?state=open&sort=updated&direction=desc&per_page=${perPage}`;

  while (nextUrl && collected.length < config.maxIssuesPerRepository) {
    const response = await githubRequest({
      url: nextUrl,
      token,
      schema: GitHubIssuesResponseSchema
    });

    collected.push(...response.data.slice(0, config.maxIssuesPerRepository - collected.length));
    nextUrl = parseNextLink(response.link, config.apiBaseUrl);
  }

  return collected;
}

function extractLabelName(label: z.infer<typeof GitHubLabelSchema>): string | null {
  if (typeof label === "string") {
    return label.trim() || null;
  }

  return label.name?.trim() || null;
}

function uniqueBoundedLabels(labels: z.infer<typeof GitHubLabelSchema>[], maxItems: number): string[] {
  const names = new Set<string>();

  for (const label of labels) {
    const name = extractLabelName(label);

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

function normalizeIssueBody(body: string | null | undefined): string | null {
  const normalized = body?.trim();

  if (!normalized) {
    return null;
  }

  return normalized.length > MAX_JOB_ISSUE_BODY_LENGTH
    ? normalized.slice(0, MAX_JOB_ISSUE_BODY_LENGTH)
    : normalized;
}

function buildSyntheticDeliveryId(params: {
  installationId: string;
  repositoryFullName: string;
  issueNumber: number;
}): string {
  const digest = crypto
    .createHash("sha256")
    .update(`${params.installationId}:${params.repositoryFullName}:${params.issueNumber}`)
    .digest("hex")
    .slice(0, 32);
  return `github-app-sync:${digest}`;
}

export async function POST(request: Request) {
  return withApiTelemetry(request, "api.github.issues.app.sync", async () => {
    try {
      const syncSecret = requireSyncSecret();
      assertSyncAuthorized(request, syncSecret);

      const config = readGitHubAppIssueSyncConfig();
      const installationToken = await createInstallationAccessToken(config);
      const repository = await getSeededRepository();
      const actorContext = createSystemActorContext(config.userId);
      const synchronizedAt = nowIso();
      const repositories = [];
      const jobs = [];

      for (const repositoryFullName of config.repositories) {
        const githubRepository = await fetchGitHubRepository(config, installationToken, repositoryFullName);
        const githubIssues = await fetchOpenIssues(config, installationToken, repositoryFullName);
        let skippedPullRequests = 0;
        let openIssueCount = 0;

        for (const issue of githubIssues) {
          if (issue.pull_request) {
            skippedPullRequests += 1;
            continue;
          }

          openIssueCount += 1;
          const job = await enqueueGitHubIssueIntakeJob({
            repository,
            userId: config.userId,
            actorContext,
            payload: {
              automationMode: config.automationMode,
              repository: {
                fullName: githubRepository.full_name,
                htmlUrl: githubRepository.html_url,
                defaultBranch: githubRepository.default_branch,
                private: githubRepository.private
              },
              issue: {
                number: issue.number,
                nodeId: issue.node_id?.trim() || null,
                title: issue.title,
                body: normalizeIssueBody(issue.body),
                url: issue.html_url,
                authorLogin: issue.user?.login?.trim() || null,
                labels: uniqueBoundedLabels(issue.labels, 50),
                assignees: uniqueBoundedLogins(issue.assignees, 20),
                createdAt: issue.created_at,
                updatedAt: issue.updated_at
              },
              deliveryId: buildSyntheticDeliveryId({
                installationId: config.installationId,
                repositoryFullName,
                issueNumber: issue.number
              }),
              receivedAt: synchronizedAt,
              senderLogin: null,
              trigger: {
                event: "issues",
                action: "sync",
                labelName: null,
                command: null,
                triggerId: "github_app:open_issue_sync"
              },
              workspaceId: config.workspaceId,
              agentId: null
            }
          });

          jobs.push({
            id: job.id,
            kind: job.kind,
            status: job.status,
            statusUrl: `/api/jobs/${encodeURIComponent(job.id)}`,
            repository: job.payload.repository.fullName,
            issueNumber: job.payload.issue.number,
            automationMode: job.payload.automationMode,
            goalId: job.payload.goalId,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt
          });
        }

        repositories.push({
          fullName: githubRepository.full_name,
          openIssuesSeen: openIssueCount,
          skippedPullRequests
        });
      }

      return operationalJson(
        {
          ok: true,
          synchronizedAt,
          automationMode: config.automationMode,
          repositories,
          jobs
        },
        { status: 202 }
      );
    } catch (error) {
      return handleOperationalApiError(error, "Failed to synchronize GitHub App issues.");
    }
  });
}
