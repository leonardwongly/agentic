import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import { createSystemActorContext, nowIso, SYSTEM_USER_ID, type ProviderCredential } from "@agentic/contracts";
import { createProviderCredentialSecretStore } from "@agentic/integrations";
import { createRepository, type AgenticRepository } from "@agentic/repository";
import { buildOAuthStateToken, parseAuthorizedOAuthStateToken } from "../apps/web/lib/auth";
import { GET as googleConnectRoute } from "../apps/web/app/api/integrations/google/connect/route";
import { GET as googleCallbackRoute } from "../apps/web/app/api/integrations/google/callback/route";
import { POST as integrationsRoutePost } from "../apps/web/app/api/integrations/route";
import { buildAuthorizedGetRequest, buildAuthorizedJsonRequest, expectNoStoreHeaders } from "./route-test-helpers";

const {
  buildGoogleAuthorizationUrlMock,
  exchangeGoogleAuthorizationCodeMock,
  fetchGoogleAccountProfileMock,
  isGoogleOAuthConfiguredMock
} = vi.hoisted(() => ({
  buildGoogleAuthorizationUrlMock: vi.fn((params: { state: string; loginHint?: string; redirectUri: string }) => {
    const url = new URL("https://accounts.google.test/o/oauth2/v2/auth");
    url.searchParams.set("state", params.state);
    url.searchParams.set("redirect_uri", params.redirectUri);

    if (params.loginHint) {
      url.searchParams.set("login_hint", params.loginHint);
    }

    return url.toString();
  }),
  exchangeGoogleAuthorizationCodeMock: vi.fn(),
  fetchGoogleAccountProfileMock: vi.fn(),
  isGoogleOAuthConfiguredMock: vi.fn(() => true)
}));

vi.mock("@agentic/integrations", async () => {
  const actual = await vi.importActual<typeof import("@agentic/integrations")>("@agentic/integrations");
  return {
    ...actual,
    buildGoogleAuthorizationUrl: buildGoogleAuthorizationUrlMock,
    exchangeGoogleAuthorizationCode: exchangeGoogleAuthorizationCodeMock,
    fetchGoogleAccountProfile: fetchGoogleAccountProfileMock,
    isGoogleOAuthConfigured: isGoogleOAuthConfiguredMock
  };
});

vi.mock("../apps/web/lib/server", () => ({
  getSeededRepository: async () => Reflect.get(globalThis, "__agenticRepository") as AgenticRepository
}));

describe("google provider routes", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalProviderSecretKey = process.env.AGENTIC_PROVIDER_SECRET_KEY;
  const originalProviderSecretKeyVersion = process.env.AGENTIC_PROVIDER_SECRET_KEY_VERSION;
  const personalWorkspaceId = `workspace-personal-${SYSTEM_USER_ID}`;

  function createGoogleCredential(params?: Partial<ProviderCredential>): ProviderCredential {
    const timestamp = nowIso();
    return {
      id: params?.id ?? `google:${personalWorkspaceId}:acct-123`,
      userId: params?.userId ?? SYSTEM_USER_ID,
      workspaceId: params?.workspaceId ?? personalWorkspaceId,
      provider: "google",
      accountId: params?.accountId ?? "acct-123",
      accountEmail: params?.accountEmail ?? "person@example.com",
      displayName: params?.displayName ?? "Example Person",
      status: params?.status ?? "connected",
      scopes: params?.scopes ?? ["https://www.googleapis.com/auth/gmail.modify"],
      lastValidatedAt: params?.lastValidatedAt ?? timestamp,
      lastRotatedAt: params?.lastRotatedAt ?? timestamp,
      lastRefreshAt: params?.lastRefreshAt ?? timestamp,
      lastRefreshFailureAt: params?.lastRefreshFailureAt ?? null,
      reconnectRequiredAt: params?.reconnectRequiredAt ?? null,
      revokedAt: params?.revokedAt ?? null,
      expiresAt: params?.expiresAt ?? null,
      metadata: params?.metadata ?? {},
      actorContext: params?.actorContext ?? createSystemActorContext(SYSTEM_USER_ID),
      createdAt: params?.createdAt ?? timestamp,
      updatedAt: params?.updatedAt ?? timestamp
    };
  }

  async function buildRepository() {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-google-provider-routes-"));
    return createRepository({
      storePath: path.join(tempDir, "runtime-store.json")
    });
  }

  beforeEach(() => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.NODE_ENV = "test";
    process.env.AGENTIC_PROVIDER_SECRET_KEY = "test-provider-secret-key";
    process.env.AGENTIC_PROVIDER_SECRET_KEY_VERSION = "test-v1";
    buildGoogleAuthorizationUrlMock.mockClear();
    exchangeGoogleAuthorizationCodeMock.mockReset();
    fetchGoogleAccountProfileMock.mockReset();
    isGoogleOAuthConfiguredMock.mockReset();
    isGoogleOAuthConfiguredMock.mockReturnValue(true);
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.NODE_ENV = originalNodeEnv;
    process.env.AGENTIC_PROVIDER_SECRET_KEY = originalProviderSecretKey;
    process.env.AGENTIC_PROVIDER_SECRET_KEY_VERSION = originalProviderSecretKeyVersion;
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  it("starts Google OAuth with a signed workspace-scoped state and login hint", async () => {
    const repository = await buildRepository();
    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.saveProviderCredential(
      createGoogleCredential({
        accountEmail: "hint@example.com"
      })
    );
    Reflect.set(globalThis, "__agenticRepository", repository);

    const response = await googleConnectRoute(buildAuthorizedGetRequest("http://localhost/api/integrations/google/connect"));
    const location = response.headers.get("location");

    expect(response.status).toBe(302);
    expect(location).toBeTruthy();
    expect(buildGoogleAuthorizationUrlMock).toHaveBeenCalledTimes(1);
    expect(buildGoogleAuthorizationUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        loginHint: "hint@example.com",
        redirectUri: "http://localhost/api/integrations/google/callback"
      })
    );

    const redirectUrl = new URL(location!);
    const state = redirectUrl.searchParams.get("state");
    const parsedState = parseAuthorizedOAuthStateToken(state, SYSTEM_USER_ID);

    expect(parsedState).toMatchObject({
      userId: SYSTEM_USER_ID,
      workspaceId: personalWorkspaceId
    });
  });

  it("persists tenant-scoped Google credentials, the encrypted refresh token, and managed integrations", async () => {
    const repository = await buildRepository();
    await repository.seedDefaults(SYSTEM_USER_ID);
    Reflect.set(globalThis, "__agenticRepository", repository);
    exchangeGoogleAuthorizationCodeMock.mockResolvedValue({
      accessToken: "google-access-token",
      refreshToken: "google-refresh-token",
      expiryDate: "2026-04-16T05:00:00.000Z",
      scopes: [
        "openid",
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/calendar"
      ]
    });
    fetchGoogleAccountProfileMock.mockResolvedValue({
      sub: "acct-123",
      email: "person@example.com",
      name: "Example Person",
      picture: "https://images.example.com/person.png"
    });

    const state = buildOAuthStateToken({
      userId: SYSTEM_USER_ID,
      workspaceId: personalWorkspaceId
    });
    const response = await googleCallbackRoute(
      buildAuthorizedGetRequest(
        `http://localhost/api/integrations/google/callback?state=${encodeURIComponent(state)}&code=oauth-code-123`
      )
    );
    const credential = await repository.getProviderCredential(`google:${personalWorkspaceId}:acct-123`, SYSTEM_USER_ID);
    const secretRecord = await repository.getProviderCredentialSecret(
      `google:${personalWorkspaceId}:acct-123`,
      "oauth_refresh_token",
      SYSTEM_USER_ID
    );
    const integrations = await repository.listIntegrations(SYSTEM_USER_ID);
    const gmail = integrations.find((integration) => integration.id === "gmail");
    const calendar = integrations.find((integration) => integration.id === "google-calendar");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost/?integration=google&status=connected");
    expectNoStoreHeaders(response);
    expect(credential).toMatchObject({
      provider: "google",
      workspaceId: personalWorkspaceId,
      accountEmail: "person@example.com",
      status: "connected"
    });
    expect(secretRecord).not.toBeNull();
    expect(createProviderCredentialSecretStore().decrypt(secretRecord!.secret)).toBe("google-refresh-token");
    expect(gmail).toMatchObject({
      status: "ready",
      metadata: expect.objectContaining({
        provider: "google",
        managed: true,
        providerCredentialId: `google:${personalWorkspaceId}:acct-123`
      })
    });
    expect(calendar).toMatchObject({
      status: "ready",
      metadata: expect.objectContaining({
        provider: "google",
        managed: true,
        providerCredentialId: `google:${personalWorkspaceId}:acct-123`
      })
    });
  });

  it("reuses the previously stored refresh token when Google omits a new one", async () => {
    const repository = await buildRepository();
    await repository.seedDefaults(SYSTEM_USER_ID);
    const existingCredential = createGoogleCredential({
      lastRotatedAt: "2026-04-15T00:00:00.000Z",
      scopes: ["https://www.googleapis.com/auth/gmail.modify"]
    });
    await repository.saveProviderCredential(existingCredential);
    await repository.saveProviderCredentialSecret({
      credentialId: existingCredential.id,
      userId: SYSTEM_USER_ID,
      kind: "oauth_refresh_token",
      secret: createProviderCredentialSecretStore().encrypt("persisted-refresh-token"),
      createdAt: existingCredential.createdAt,
      updatedAt: existingCredential.updatedAt
    });
    Reflect.set(globalThis, "__agenticRepository", repository);
    exchangeGoogleAuthorizationCodeMock.mockResolvedValue({
      accessToken: "google-access-token",
      refreshToken: null,
      expiryDate: null,
      scopes: []
    });
    fetchGoogleAccountProfileMock.mockResolvedValue({
      sub: "acct-123",
      email: "person@example.com",
      name: "Example Person",
      picture: null
    });

    const state = buildOAuthStateToken({
      userId: SYSTEM_USER_ID,
      workspaceId: personalWorkspaceId
    });
    const response = await googleCallbackRoute(
      buildAuthorizedGetRequest(
        `http://localhost/api/integrations/google/callback?state=${encodeURIComponent(state)}&code=oauth-code-123`
      )
    );
    const secretRecord = await repository.getProviderCredentialSecret(
      existingCredential.id,
      "oauth_refresh_token",
      SYSTEM_USER_ID
    );
    const updatedCredential = await repository.getProviderCredential(existingCredential.id, SYSTEM_USER_ID);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost/?integration=google&status=connected");
    expect(createProviderCredentialSecretStore().decrypt(secretRecord!.secret)).toBe("persisted-refresh-token");
    expect(updatedCredential?.lastRotatedAt).toBe("2026-04-15T00:00:00.000Z");
    expect(updatedCredential?.scopes).toEqual(["https://www.googleapis.com/auth/gmail.modify"]);
  });

  it("fails closed when the callback state is invalid", async () => {
    const repository = await buildRepository();
    await repository.seedDefaults(SYSTEM_USER_ID);
    Reflect.set(globalThis, "__agenticRepository", repository);

    const response = await googleCallbackRoute(
      buildAuthorizedGetRequest("http://localhost/api/integrations/google/callback?state=invalid&code=oauth-code-123")
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost/?integration=google&status=error&reason=oauth_failed");
    expectNoStoreHeaders(response);
    expect(exchangeGoogleAuthorizationCodeMock).not.toHaveBeenCalled();
    expect(fetchGoogleAccountProfileMock).not.toHaveBeenCalled();
  });

  it("fails closed when the callback state was signed for another user", async () => {
    const repository = await buildRepository();
    await repository.seedDefaults(SYSTEM_USER_ID);
    Reflect.set(globalThis, "__agenticRepository", repository);

    const state = buildOAuthStateToken({
      userId: "user-secondary",
      workspaceId: personalWorkspaceId
    });
    const response = await googleCallbackRoute(
      buildAuthorizedGetRequest(
        `http://localhost/api/integrations/google/callback?state=${encodeURIComponent(state)}&code=oauth-code-123`
      )
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost/?integration=google&status=error&reason=oauth_failed");
    expectNoStoreHeaders(response);
    expect(exchangeGoogleAuthorizationCodeMock).not.toHaveBeenCalled();
    expect(fetchGoogleAccountProfileMock).not.toHaveBeenCalled();
  });

  it("fails closed when Google omits the refresh token and no stored credential exists", async () => {
    const repository = await buildRepository();
    await repository.seedDefaults(SYSTEM_USER_ID);
    Reflect.set(globalThis, "__agenticRepository", repository);
    exchangeGoogleAuthorizationCodeMock.mockResolvedValue({
      accessToken: "google-access-token",
      refreshToken: null,
      expiryDate: null,
      scopes: []
    });
    fetchGoogleAccountProfileMock.mockResolvedValue({
      sub: "acct-123",
      email: "person@example.com",
      name: "Example Person",
      picture: null
    });

    const state = buildOAuthStateToken({
      userId: SYSTEM_USER_ID,
      workspaceId: personalWorkspaceId
    });
    const response = await googleCallbackRoute(
      buildAuthorizedGetRequest(
        `http://localhost/api/integrations/google/callback?state=${encodeURIComponent(state)}&code=oauth-code-123`
      )
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost/?integration=google&status=error&reason=oauth_failed");
    expectNoStoreHeaders(response);
    expect(
      await repository.getProviderCredential(`google:${personalWorkspaceId}:acct-123`, SYSTEM_USER_ID)
    ).toBeNull();
  });

  it("blocks manual toggles for Google-managed integrations", async () => {
    const repository = await buildRepository();
    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.saveProviderCredential(createGoogleCredential());
    Reflect.set(globalThis, "__agenticRepository", repository);

    const response = await integrationsRoutePost(
      buildAuthorizedJsonRequest("http://localhost/api/integrations", {
        id: "gmail",
        status: "manual"
      })
    );
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(409);
    expect(payload.error).toContain("managed by Google provider credentials");
    expectNoStoreHeaders(response);
  });
});
