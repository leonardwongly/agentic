import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import { createSystemActorContext, type ProviderCredential } from "@agentic/contracts";
import {
  ConnectorFailureError,
  createCalendarAdapter,
  createGmailAdapter,
  createProviderCredentialSecretStore
} from "@agentic/integrations";
import { createRepository } from "@agentic/repository";
import { resolveGoogleWorkspaceAdapters } from "../apps/web/lib/google-provider-adapters";

const googleApiMocks = vi.hoisted(() => ({
  gmailDraftsList: vi.fn(),
  gmailDraftsGet: vi.fn(),
  gmailDraftsCreate: vi.fn(),
  gmailDraftsSend: vi.fn(),
  gmailMessagesList: vi.fn(),
  calendarEventsList: vi.fn(),
  calendarEventsInsert: vi.fn()
}));

vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials() {}
      }
    },
    gmail: () => ({
      users: {
        drafts: {
          list: googleApiMocks.gmailDraftsList,
          get: googleApiMocks.gmailDraftsGet,
          create: googleApiMocks.gmailDraftsCreate,
          send: googleApiMocks.gmailDraftsSend
        },
        messages: {
          list: googleApiMocks.gmailMessagesList
        }
      }
    }),
    calendar: () => ({
      events: {
        list: googleApiMocks.calendarEventsList,
        insert: googleApiMocks.calendarEventsInsert
      }
    })
  }
}));

function buildGoogleCredential(overrides?: Partial<ProviderCredential>): ProviderCredential {
  return {
    id: overrides?.id ?? "google:workspace-1:acct-1",
    userId: overrides?.userId ?? "user-1",
    workspaceId: overrides?.workspaceId ?? "workspace-1",
    provider: "google",
    accountId: overrides?.accountId ?? "acct-1",
    accountEmail: overrides?.accountEmail ?? "person@example.com",
    displayName: overrides?.displayName ?? "Example Person",
    status: overrides?.status ?? "connected",
    scopes:
      overrides?.scopes ??
      ["https://www.googleapis.com/auth/gmail.modify", "https://www.googleapis.com/auth/calendar"],
    lastValidatedAt: overrides?.lastValidatedAt ?? "2026-04-18T00:00:00.000Z",
    lastRotatedAt: overrides?.lastRotatedAt ?? "2026-04-18T00:00:00.000Z",
    lastRefreshAt: overrides?.lastRefreshAt ?? "2026-04-18T00:00:00.000Z",
    lastRefreshFailureAt: overrides?.lastRefreshFailureAt ?? null,
    reconnectRequiredAt: overrides?.reconnectRequiredAt ?? null,
    revokedAt: overrides?.revokedAt ?? null,
    expiresAt: overrides?.expiresAt ?? null,
    metadata: overrides?.metadata ?? {},
    actorContext: overrides?.actorContext ?? createSystemActorContext("user-1"),
    createdAt: overrides?.createdAt ?? "2026-04-18T00:00:00.000Z",
    updatedAt: overrides?.updatedAt ?? "2026-04-18T00:00:00.000Z"
  };
}

function encryptRefreshTokenForCredential(credential: ProviderCredential, refreshToken: string) {
  return createProviderCredentialSecretStore().encrypt(refreshToken, {
    credentialId: credential.id,
    userId: credential.userId,
    kind: "oauth_refresh_token"
  });
}

async function buildRepository() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-google-provider-adapters-"));
  return createRepository({
    storePath: path.join(tempDir, "runtime-store.json")
  });
}

describe("resolveGoogleWorkspaceAdapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AGENTIC_PROVIDER_SECRET_KEY = "test-provider-secret-key";
    process.env.AGENTIC_PROVIDER_SECRET_KEY_VERSION = "test-v1";
    process.env.GOOGLE_CLIENT_ID = "google-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";
  });

  it("falls back to an older exact-workspace credential when the newest candidate lacks required scopes", async () => {
    const repository = await buildRepository();
    const degraded = buildGoogleCredential({
      id: "google:workspace-1:acct-new",
      scopes: ["https://www.googleapis.com/auth/gmail.modify"],
      updatedAt: "2026-04-18T02:00:00.000Z"
    });
    const healthy = buildGoogleCredential({
      id: "google:workspace-1:acct-old",
      updatedAt: "2026-04-18T01:00:00.000Z"
    });
    await repository.saveProviderCredential(degraded);
    await repository.saveProviderCredential(healthy);
    await repository.saveProviderCredentialSecret({
      credentialId: degraded.id,
      userId: degraded.userId,
      kind: "oauth_refresh_token",
      secret: encryptRefreshTokenForCredential(degraded, "degraded-refresh-token"),
      createdAt: degraded.createdAt,
      updatedAt: degraded.updatedAt
    });
    await repository.saveProviderCredentialSecret({
      credentialId: healthy.id,
      userId: healthy.userId,
      kind: "oauth_refresh_token",
      secret: encryptRefreshTokenForCredential(healthy, "healthy-refresh-token"),
      createdAt: healthy.createdAt,
      updatedAt: healthy.updatedAt
    });

    const adapters = await resolveGoogleWorkspaceAdapters({
      repository,
      userId: "user-1",
      workspaceId: "workspace-1"
    });

    expect(adapters?.credential.id).toBe(healthy.id);
    expect(adapters?.gmail).toBeDefined();
    expect(adapters?.calendar).toBeDefined();
  });

  it("fails closed when no exact-workspace candidate is approval-safe", async () => {
    const repository = await buildRepository();
    const degraded = buildGoogleCredential({
      id: "google:workspace-1:acct-only",
      scopes: ["https://www.googleapis.com/auth/gmail.modify"]
    });
    await repository.saveProviderCredential(degraded);
    await repository.saveProviderCredentialSecret({
      credentialId: degraded.id,
      userId: degraded.userId,
      kind: "oauth_refresh_token",
      secret: encryptRefreshTokenForCredential(degraded, "degraded-refresh-token"),
      createdAt: degraded.createdAt,
      updatedAt: degraded.updatedAt
    });

    await expect(
      resolveGoogleWorkspaceAdapters({
        repository,
        userId: "user-1",
        workspaceId: "workspace-1"
      })
    ).rejects.toThrow(/approval-safe Google credential/);
  });

  it("reuses an existing Gmail draft with the same idempotency key", async () => {
    googleApiMocks.gmailDraftsList.mockResolvedValue({
      data: {
        drafts: [{ id: "draft-existing" }]
      }
    });
    googleApiMocks.gmailDraftsGet.mockResolvedValue({
      data: {
        message: {
          payload: {
            headers: [
              {
                name: "X-Agentic-Idempotency-Key",
                value: "gmail-key-1"
              }
            ]
          }
        }
      }
    });
    const adapter = createGmailAdapter({ refreshToken: "refresh-token" });
    const controller = new AbortController();

    const draft = await adapter.createDraft({
      to: "person@example.com",
      subject: "Follow up",
      body: "Confirming the next action.",
      idempotencyKey: "gmail-key-1",
      signal: controller.signal
    });

    expect(draft.id).toBe("draft-existing");
    expect(googleApiMocks.gmailDraftsCreate).not.toHaveBeenCalled();
    expect(googleApiMocks.gmailDraftsList.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(googleApiMocks.gmailDraftsGet.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("stamps Gmail drafts with idempotency headers and timeout signals", async () => {
    googleApiMocks.gmailDraftsList.mockResolvedValue({
      data: {
        drafts: []
      }
    });
    googleApiMocks.gmailDraftsCreate.mockResolvedValue({
      data: {
        id: "draft-new"
      }
    });
    const adapter = createGmailAdapter({ refreshToken: "refresh-token" });

    await adapter.createDraft({
      to: "person@example.com",
      subject: "Follow up\r\nBcc: injected@example.com",
      body: "Confirming the next action.",
      idempotencyKey: "gmail-key-2"
    });

    const [request, options] = googleApiMocks.gmailDraftsCreate.mock.calls[0]!;
    const raw = Buffer.from(request.requestBody.message.raw, "base64url").toString("utf8");

    expect(raw).toContain("X-Agentic-Idempotency-Key: gmail-key-2");
    expect(raw).toContain("Message-ID: <agentic-");
    expect(raw).toContain("Subject: Follow up Bcc: injected@example.com");
    expect(raw).not.toContain("\r\nBcc: injected@example.com");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("reconciles Gmail send retries after a prior successful send removed the draft", async () => {
    const notFound = new Error("not found");
    Object.assign(notFound, { code: 404 });
    googleApiMocks.gmailDraftsSend.mockRejectedValue(notFound);
    googleApiMocks.gmailMessagesList.mockResolvedValue({
      data: {
        messages: [{ id: "message-existing" }]
      }
    });
    const adapter = createGmailAdapter({ refreshToken: "refresh-token" });

    await expect(adapter.sendDraft("draft-missing", { idempotencyKey: "gmail-key-3" })).resolves.toEqual({
      messageId: "message-existing"
    });
    expect(googleApiMocks.gmailMessagesList).toHaveBeenCalledWith(
      expect.objectContaining({
        q: expect.stringMatching(/^rfc822msgid:agentic-/u)
      }),
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );
  });

  it("reuses a Calendar event with the same idempotency key", async () => {
    googleApiMocks.calendarEventsList.mockResolvedValue({
      data: {
        items: [
          {
            id: "event-existing",
            summary: "Planning",
            start: { dateTime: "2026-05-19T09:00:00.000Z" },
            end: { dateTime: "2026-05-19T09:30:00.000Z" },
            htmlLink: "https://calendar.example.com/event-existing"
          }
        ]
      }
    });
    const adapter = createCalendarAdapter({ refreshToken: "refresh-token" });

    const event = await adapter.createEvent({
      summary: "Planning",
      start: "2026-05-19T09:00:00.000Z",
      end: "2026-05-19T09:30:00.000Z",
      idempotencyKey: "calendar-key-1"
    });

    expect(event.id).toBe("event-existing");
    expect(googleApiMocks.calendarEventsInsert).not.toHaveBeenCalled();
    expect(googleApiMocks.calendarEventsList).toHaveBeenCalledWith(
      expect.objectContaining({
        privateExtendedProperty: ["agenticIdempotencyKey=calendar-key-1"]
      }),
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );
  });

  it("stamps Calendar events with private idempotency metadata and timeout signals", async () => {
    googleApiMocks.calendarEventsList.mockResolvedValue({
      data: {
        items: []
      }
    });
    googleApiMocks.calendarEventsInsert.mockResolvedValue({
      data: {
        id: "event-new",
        summary: "Planning",
        start: { dateTime: "2026-05-19T09:00:00.000Z" },
        end: { dateTime: "2026-05-19T09:30:00.000Z" },
        htmlLink: "https://calendar.example.com/event-new"
      }
    });
    const adapter = createCalendarAdapter({ refreshToken: "refresh-token" });

    await adapter.createEvent({
      summary: "Planning",
      start: "2026-05-19T09:00:00.000Z",
      end: "2026-05-19T09:30:00.000Z",
      idempotencyKey: "calendar-key-2"
    });

    const [request, options] = googleApiMocks.calendarEventsInsert.mock.calls[0]!;

    expect(request.requestBody.extendedProperties.private).toEqual({
      agenticIdempotencyKey: "calendar-key-2"
    });
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("normalizes Google adapter timeouts into retryable connector failures", async () => {
    const timeout = new Error("operation timed out");
    timeout.name = "TimeoutError";
    googleApiMocks.calendarEventsList.mockRejectedValue(timeout);
    const adapter = createCalendarAdapter({ refreshToken: "refresh-token" });

    await expect(
      adapter.createEvent({
        summary: "Planning",
        start: "2026-05-19T09:00:00.000Z",
        end: "2026-05-19T09:30:00.000Z",
        idempotencyKey: "calendar-key-3"
      })
    ).rejects.toMatchObject({
      provider: "google_calendar",
      code: "timeout",
      retryable: true
    });
    await expect(
      adapter.createEvent({
        summary: "Planning",
        start: "2026-05-19T09:00:00.000Z",
        end: "2026-05-19T09:30:00.000Z",
        idempotencyKey: "calendar-key-3"
      })
    ).rejects.toBeInstanceOf(ConnectorFailureError);
  });
});
