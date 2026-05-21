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

import { POST as githubAppIssueSyncRoute } from "../apps/web/app/api/github/issues/app/sync/route";

const SYNC_SECRET = "github-app-sync-secret-with-at-least-32-chars";

function createTestPrivateKey(): string {
  return crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: "spki",
      format: "pem"
    },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem"
    }
  }).privateKey;
}

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });
}

function buildRepositoryResponse(overrides: Record<string, unknown> = {}) {
  return {
    full_name: "leonardwongly/agentic",
    html_url: "https://github.com/leonardwongly/agentic",
    default_branch: "main",
    private: true,
    ...overrides
  };
}

function buildIssueResponse(overrides: Record<string, unknown> = {}) {
  return {
    number: 134,
    node_id: "I_kwDOAgenticIssue134",
    title: "plan(first-run): remediate first-time user setup and workflow findings",
    body: "Create a comprehensive remediation plan and implement it.",
    html_url: "https://github.com/leonardwongly/agentic/issues/134",
    user: {
      login: "issue-author"
    },
    labels: [
      { name: "priority-critical" },
      { name: "first-time-user-review" }
    ],
    assignees: [],
    created_at: "2026-05-12T14:20:00.000Z",
    updated_at: "2026-05-12T14:29:59.000Z",
    ...overrides
  };
}

function buildSyncRequest(options?: { secret?: string }) {
  return new Request("http://localhost/api/github/issues/app/sync", {
    method: "POST",
    headers: {
      authorization: `Bearer ${options?.secret ?? SYNC_SECRET}`
    }
  });
}

describe("GitHub App issue sync route", () => {
  let repository: AgenticRepository;
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalEnv = {
    runtimeStorePath: process.env.AGENTIC_RUNTIME_STORE_PATH,
    syncSecret: process.env.AGENTIC_GITHUB_APP_SYNC_SECRET,
    appId: process.env.AGENTIC_GITHUB_APP_ID,
    installationId: process.env.AGENTIC_GITHUB_APP_INSTALLATION_ID,
    privateKey: process.env.AGENTIC_GITHUB_APP_PRIVATE_KEY,
    apiBaseUrl: process.env.AGENTIC_GITHUB_APP_API_BASE_URL,
    allowedRepositories: process.env.AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES,
    mode: process.env.AGENTIC_GITHUB_APP_SYNC_AUTOMATION_MODE,
    maxIssues: process.env.AGENTIC_GITHUB_APP_SYNC_MAX_ISSUES_PER_REPOSITORY,
    userId: process.env.AGENTIC_GITHUB_ISSUE_INTAKE_USER_ID,
    workspaceId: process.env.AGENTIC_GITHUB_ISSUE_INTAKE_WORKSPACE_ID
  };

  beforeEach(async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-github-app-issue-sync-"));
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(tempDir, "runtime-store.json");
    process.env.AGENTIC_GITHUB_APP_SYNC_SECRET = SYNC_SECRET;
    process.env.AGENTIC_GITHUB_APP_ID = "12345";
    process.env.AGENTIC_GITHUB_APP_INSTALLATION_ID = "98765";
    process.env.AGENTIC_GITHUB_APP_PRIVATE_KEY = createTestPrivateKey();
    process.env.AGENTIC_GITHUB_APP_API_BASE_URL = "https://github.test";
    process.env.AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES = "leonardwongly/agentic";
    process.env.AGENTIC_GITHUB_APP_SYNC_AUTOMATION_MODE = "work";
    delete process.env.AGENTIC_GITHUB_APP_SYNC_MAX_ISSUES_PER_REPOSITORY;
    delete process.env.AGENTIC_GITHUB_ISSUE_INTAKE_USER_ID;
    delete process.env.AGENTIC_GITHUB_ISSUE_INTAKE_WORKSPACE_ID;

    repository = createRouteTestRepository();
    await repository.seedDefaults(SYSTEM_USER_ID);
    Reflect.set(globalThis, "__agenticRepository", repository);

    fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      const authorization = new Headers(init?.headers).get("authorization") ?? "";

      if (url === "https://github.test/app/installations/98765/access_tokens") {
        expect(init?.method).toBe("POST");
        expect(authorization).toMatch(/^Bearer [^.]+\.[^.]+\.[^.]+$/u);
        return jsonResponse({
          token: "github-installation-token",
          expires_at: "2026-05-13T04:00:00.000Z"
        });
      }

      expect(authorization).toBe("Bearer github-installation-token");

      if (url === "https://github.test/repos/leonardwongly/agentic") {
        return jsonResponse(buildRepositoryResponse());
      }

      if (url.startsWith("https://github.test/repos/leonardwongly/agentic/issues?")) {
        return jsonResponse([
          buildIssueResponse(),
          buildIssueResponse({
            number: 135,
            node_id: "PR_kwDOAgentic135",
            title: "PR should not be treated as an issue",
            html_url: "https://github.com/leonardwongly/agentic/pull/135",
            pull_request: {
              url: "https://api.github.com/repos/leonardwongly/agentic/pulls/135"
            }
          })
        ]);
      }

      return jsonResponse({ message: "not found" }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    if (originalEnv.runtimeStorePath === undefined) {
      delete process.env.AGENTIC_RUNTIME_STORE_PATH;
    } else {
      process.env.AGENTIC_RUNTIME_STORE_PATH = originalEnv.runtimeStorePath;
    }

    if (originalEnv.syncSecret === undefined) {
      delete process.env.AGENTIC_GITHUB_APP_SYNC_SECRET;
    } else {
      process.env.AGENTIC_GITHUB_APP_SYNC_SECRET = originalEnv.syncSecret;
    }

    if (originalEnv.appId === undefined) {
      delete process.env.AGENTIC_GITHUB_APP_ID;
    } else {
      process.env.AGENTIC_GITHUB_APP_ID = originalEnv.appId;
    }

    if (originalEnv.installationId === undefined) {
      delete process.env.AGENTIC_GITHUB_APP_INSTALLATION_ID;
    } else {
      process.env.AGENTIC_GITHUB_APP_INSTALLATION_ID = originalEnv.installationId;
    }

    if (originalEnv.privateKey === undefined) {
      delete process.env.AGENTIC_GITHUB_APP_PRIVATE_KEY;
    } else {
      process.env.AGENTIC_GITHUB_APP_PRIVATE_KEY = originalEnv.privateKey;
    }

    if (originalEnv.apiBaseUrl === undefined) {
      delete process.env.AGENTIC_GITHUB_APP_API_BASE_URL;
    } else {
      process.env.AGENTIC_GITHUB_APP_API_BASE_URL = originalEnv.apiBaseUrl;
    }

    if (originalEnv.allowedRepositories === undefined) {
      delete process.env.AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES;
    } else {
      process.env.AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES = originalEnv.allowedRepositories;
    }

    if (originalEnv.mode === undefined) {
      delete process.env.AGENTIC_GITHUB_APP_SYNC_AUTOMATION_MODE;
    } else {
      process.env.AGENTIC_GITHUB_APP_SYNC_AUTOMATION_MODE = originalEnv.mode;
    }

    if (originalEnv.maxIssues === undefined) {
      delete process.env.AGENTIC_GITHUB_APP_SYNC_MAX_ISSUES_PER_REPOSITORY;
    } else {
      process.env.AGENTIC_GITHUB_APP_SYNC_MAX_ISSUES_PER_REPOSITORY = originalEnv.maxIssues;
    }

    if (originalEnv.userId === undefined) {
      delete process.env.AGENTIC_GITHUB_ISSUE_INTAKE_USER_ID;
    } else {
      process.env.AGENTIC_GITHUB_ISSUE_INTAKE_USER_ID = originalEnv.userId;
    }

    if (originalEnv.workspaceId === undefined) {
      delete process.env.AGENTIC_GITHUB_ISSUE_INTAKE_WORKSPACE_ID;
    } else {
      process.env.AGENTIC_GITHUB_ISSUE_INTAKE_WORKSPACE_ID = originalEnv.workspaceId;
    }

    Reflect.deleteProperty(globalThis, "__agenticRepository");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lists open GitHub App issues and enqueues governed work jobs", async () => {
    const response = await githubAppIssueSyncRoute(buildSyncRequest());
    const payload = await response.json();
    const jobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["github_issue_intake"]
    });

    expect(response.status).toBe(202);
    expectOperationalNoStoreHeaders(response);
    expect(payload).toMatchObject({
      ok: true,
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
          kind: "github_issue_intake",
          status: "queued",
          statusUrl: expect.stringMatching(/^\/api\/jobs\/[^/?#]+$/u),
          repository: "leonardwongly/agentic",
          issueNumber: 134,
          automationMode: "work"
        }
      ]
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload).toMatchObject({
      type: "github_issue_intake",
      automationMode: "work",
      repository: {
        fullName: "leonardwongly/agentic",
        private: true
      },
      issue: {
        number: 134,
        labels: ["priority-critical", "first-time-user-review"]
      },
      deliveryId: expect.stringMatching(/^github-app-sync:[a-f0-9]{32}$/u),
      metadata: {
        event: "issues",
        action: "sync",
        triggerId: "github_app:open_issue_sync",
        riskTags: ["untrusted_external_input", "github_issue", "github_issue_work"]
      }
    });
  });

  it("accepts large GitHub issue bodies and truncates the queued job payload", async () => {
    const largeBody = ` ${"a".repeat(10_190)} `;

    fetchMock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();

      if (url === "https://github.test/app/installations/98765/access_tokens") {
        return jsonResponse({
          token: "github-installation-token",
          expires_at: "2026-05-13T04:00:00.000Z"
        });
      }

      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer github-installation-token");

      if (url === "https://github.test/repos/leonardwongly/agentic") {
        return jsonResponse(buildRepositoryResponse());
      }

      if (url.startsWith("https://github.test/repos/leonardwongly/agentic/issues?")) {
        return jsonResponse([
          buildIssueResponse({
            body: largeBody
          })
        ]);
      }

      return jsonResponse({ message: "not found" }, { status: 404 });
    });

    const response = await githubAppIssueSyncRoute(buildSyncRequest());
    const jobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["github_issue_intake"]
    });

    expect(response.status).toBe(202);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload.issue.body).toHaveLength(10_000);
    expect(jobs[0]?.payload.issue.body).toBe("a".repeat(10_000));
  });

  it("deduplicates repeat syncs by repository, issue, mode, and sync trigger", async () => {
    const first = await githubAppIssueSyncRoute(buildSyncRequest());
    const second = await githubAppIssueSyncRoute(buildSyncRequest());
    const firstPayload = await first.json();
    const secondPayload = await second.json();
    const jobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["github_issue_intake"]
    });

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(secondPayload.jobs[0]?.id).toBe(firstPayload.jobs[0]?.id);
    expect(secondPayload.jobs[0]?.statusUrl).toBe(firstPayload.jobs[0]?.statusUrl);
    expect(secondPayload.jobs[0]?.statusUrl).toBe(`/api/jobs/${encodeURIComponent(firstPayload.jobs[0]?.id)}`);
    expect(jobs).toHaveLength(1);
  });

  it("rejects requests without the sync bearer secret before contacting GitHub", async () => {
    const response = await githubAppIssueSyncRoute(
      new Request("http://localhost/api/github/issues/app/sync", {
        method: "POST"
      })
    );
    const jobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["github_issue_intake"]
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Invalid GitHub App issue sync credentials."
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(jobs).toHaveLength(0);
  });

  it("rejects declared request bodies before reading GitHub App runtime config", async () => {
    delete process.env.AGENTIC_GITHUB_APP_PRIVATE_KEY;

    const response = await githubAppIssueSyncRoute(
      new Request("http://localhost/api/github/issues/app/sync", {
        method: "POST",
        headers: {
          authorization: `Bearer ${SYNC_SECRET}`,
          "content-length": "2"
        },
        body: "{}"
      })
    );
    const jobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["github_issue_intake"]
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "GitHub App issue sync requests must not include a body."
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(jobs).toHaveLength(0);
  });

  it("rejects streamed request bodies without declared content length", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("{}"));
        controller.close();
      }
    });

    const response = await githubAppIssueSyncRoute(
      new Request("http://localhost/api/github/issues/app/sync", {
        method: "POST",
        headers: {
          authorization: `Bearer ${SYNC_SECRET}`
        },
        body: stream,
        duplex: "half"
      } as RequestInit & { duplex: "half" })
    );
    const jobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["github_issue_intake"]
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "GitHub App issue sync requests must not include a body."
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(jobs).toHaveLength(0);
  });

  it("fails closed when the runtime GitHub App private key is missing", async () => {
    delete process.env.AGENTIC_GITHUB_APP_PRIVATE_KEY;

    const response = await githubAppIssueSyncRoute(buildSyncRequest());
    const jobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["github_issue_intake"]
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "AGENTIC_GITHUB_APP_PRIVATE_KEY is not configured."
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(jobs).toHaveLength(0);
  });

  it("fails closed when the sync secret runtime configuration is too short", async () => {
    process.env.AGENTIC_GITHUB_APP_SYNC_SECRET = "too-short";

    const response = await githubAppIssueSyncRoute(buildSyncRequest({
      secret: "too-short"
    }));
    const jobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["github_issue_intake"]
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "AGENTIC_GITHUB_APP_SYNC_SECRET is too short."
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(jobs).toHaveLength(0);
  });

  it("fails closed when the allowed repository runtime configuration is malformed", async () => {
    process.env.AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES = "not-a-full-name";

    const response = await githubAppIssueSyncRoute(buildSyncRequest());
    const jobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["github_issue_intake"]
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "GitHub issue allowed repository configuration is invalid."
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(jobs).toHaveLength(0);
  });

  it("fails closed when the configured GitHub API base URL is not HTTPS", async () => {
    process.env.AGENTIC_GITHUB_APP_API_BASE_URL = "http://github.test";

    const response = await githubAppIssueSyncRoute(buildSyncRequest());
    const jobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["github_issue_intake"]
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "AGENTIC_GITHUB_APP_API_BASE_URL must use https."
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(jobs).toHaveLength(0);
  });

  it("fails closed when the sync automation mode is not plan or work", async () => {
    process.env.AGENTIC_GITHUB_APP_SYNC_AUTOMATION_MODE = "intake";

    const response = await githubAppIssueSyncRoute(buildSyncRequest());
    const jobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["github_issue_intake"]
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "AGENTIC_GITHUB_APP_SYNC_AUTOMATION_MODE must be plan or work."
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(jobs).toHaveLength(0);
  });

  it("fails closed when GitHub returns a repository outside the allowlist", async () => {
    fetchMock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();

      if (url === "https://github.test/app/installations/98765/access_tokens") {
        return jsonResponse({
          token: "github-installation-token",
          expires_at: "2026-05-13T04:00:00.000Z"
        });
      }

      if (url === "https://github.test/repos/leonardwongly/agentic") {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer github-installation-token");
        return jsonResponse(buildRepositoryResponse({
          full_name: "other-owner/other-repo"
        }));
      }

      return jsonResponse({ message: "not found" }, { status: 404 });
    });

    const response = await githubAppIssueSyncRoute(buildSyncRequest());
    const jobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["github_issue_intake"]
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "GitHub App issue sync returned a repository outside the allowlist."
    });
    expect(jobs).toHaveLength(0);
  });

  it("rejects unsafe GitHub pagination links", async () => {
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString();

      if (url === "https://github.test/app/installations/98765/access_tokens") {
        return jsonResponse({
          token: "github-installation-token",
          expires_at: "2026-05-13T04:00:00.000Z"
        });
      }

      if (url === "https://github.test/repos/leonardwongly/agentic") {
        return jsonResponse(buildRepositoryResponse());
      }

      if (url.startsWith("https://github.test/repos/leonardwongly/agentic/issues?")) {
        return jsonResponse([buildIssueResponse()], {
          headers: {
            link: '<https://metadata.internal/repos/leonardwongly/agentic/issues?page=2>; rel="next"'
          }
        });
      }

      return jsonResponse({ message: "not found" }, { status: 404 });
    });

    const response = await githubAppIssueSyncRoute(buildSyncRequest());
    const jobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["github_issue_intake"]
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "GitHub App issue sync received an unsafe pagination link."
    });
    expect(jobs).toHaveLength(0);
  });

  it("returns a dependency failure when GitHub requests fail before a response", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network unavailable"));

    const response = await githubAppIssueSyncRoute(buildSyncRequest());
    const jobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["github_issue_intake"]
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "GitHub App issue sync request failed."
    });
    expect(jobs).toHaveLength(0);
  });

  it("returns a dependency failure when GitHub returns malformed JSON", async () => {
    fetchMock.mockImplementationOnce(async () =>
      new Response("{", {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      })
    );

    const response = await githubAppIssueSyncRoute(buildSyncRequest());
    const jobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["github_issue_intake"]
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "GitHub App issue sync received an invalid GitHub response."
    });
    expect(jobs).toHaveLength(0);
  });

  it("does not enqueue partial work when a later repository sync fails", async () => {
    process.env.AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES = "leonardwongly/agentic,leonardwongly/agentic-docs";
    fetchMock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();

      if (url === "https://github.test/app/installations/98765/access_tokens") {
        return jsonResponse({
          token: "github-installation-token",
          expires_at: "2026-05-13T04:00:00.000Z"
        });
      }

      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer github-installation-token");

      if (url === "https://github.test/repos/leonardwongly/agentic") {
        return jsonResponse(buildRepositoryResponse());
      }

      if (url.startsWith("https://github.test/repos/leonardwongly/agentic/issues?")) {
        return jsonResponse([buildIssueResponse()]);
      }

      if (url === "https://github.test/repos/leonardwongly/agentic-docs") {
        return jsonResponse(buildRepositoryResponse({
          full_name: "leonardwongly/agentic-docs",
          html_url: "https://github.com/leonardwongly/agentic-docs"
        }));
      }

      if (url.startsWith("https://github.test/repos/leonardwongly/agentic-docs/issues?")) {
        return jsonResponse({ message: "upstream unavailable" }, { status: 502 });
      }

      return jsonResponse({ message: "not found" }, { status: 404 });
    });

    const response = await githubAppIssueSyncRoute(buildSyncRequest());
    const jobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["github_issue_intake"]
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "GitHub App issue sync request failed."
    });
    expect(jobs).toHaveLength(0);
  });

  it("honors the configured per-repository issue cap", async () => {
    process.env.AGENTIC_GITHUB_APP_SYNC_MAX_ISSUES_PER_REPOSITORY = "1";

    const response = await githubAppIssueSyncRoute(buildSyncRequest());
    const payload = await response.json();
    const issueListUrl = fetchMock.mock.calls
      .map((call) => call[0] instanceof Request ? call[0].url : call[0].toString())
      .find((url) => url.startsWith("https://github.test/repos/leonardwongly/agentic/issues?"));
    const jobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["github_issue_intake"]
    });

    expect(response.status).toBe(202);
    expect(issueListUrl).toContain("per_page=1");
    expect(payload.jobs).toHaveLength(1);
    expect(jobs).toHaveLength(1);
  });
});
