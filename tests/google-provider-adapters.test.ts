import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSystemActorContext, type ProviderCredential } from "@agentic/contracts";
import { createProviderCredentialSecretStore } from "@agentic/integrations";
import { createRepository } from "@agentic/repository";
import { resolveGoogleWorkspaceAdapters } from "../apps/web/lib/google-provider-adapters";

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

async function buildRepository() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-google-provider-adapters-"));
  return createRepository({
    storePath: path.join(tempDir, "runtime-store.json")
  });
}

describe("resolveGoogleWorkspaceAdapters", () => {
  beforeEach(() => {
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
      secret: createProviderCredentialSecretStore().encrypt("degraded-refresh-token"),
      createdAt: degraded.createdAt,
      updatedAt: degraded.updatedAt
    });
    await repository.saveProviderCredentialSecret({
      credentialId: healthy.id,
      userId: healthy.userId,
      kind: "oauth_refresh_token",
      secret: createProviderCredentialSecretStore().encrypt("healthy-refresh-token"),
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
      secret: createProviderCredentialSecretStore().encrypt("degraded-refresh-token"),
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
});
