import { buildDefaultIntegrationAccounts, describeIntegrationReadiness, integrationSupportsExecutionMode } from "@agentic/integrations";
import type { ProviderCredential } from "@agentic/contracts";

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
    scopes: overrides?.scopes ?? [],
    lastValidatedAt: overrides?.lastValidatedAt ?? null,
    lastRotatedAt: overrides?.lastRotatedAt ?? null,
    lastRefreshAt: overrides?.lastRefreshAt ?? null,
    lastRefreshFailureAt: overrides?.lastRefreshFailureAt ?? null,
    reconnectRequiredAt: overrides?.reconnectRequiredAt ?? null,
    revokedAt: overrides?.revokedAt ?? null,
    expiresAt: overrides?.expiresAt ?? null,
    metadata: overrides?.metadata ?? {},
    actorContext: overrides?.actorContext ?? null,
    createdAt: overrides?.createdAt ?? "2026-04-18T00:00:00.000Z",
    updatedAt: overrides?.updatedAt ?? "2026-04-18T00:00:00.000Z"
  };
}

describe("describeIntegrationReadiness", () => {
  it("marks live notes as autonomous-grade", () => {
    const notes = buildDefaultIntegrationAccounts("user-1").find((integration) => integration.system === "notes");

    expect(notes).toBeDefined();
    expect(describeIntegrationReadiness(notes!)).toEqual(
      expect.objectContaining({
        tier: "autonomous-grade",
        supportedModes: ["draft", "approval", "autonomous"]
      })
    );
    expect(integrationSupportsExecutionMode(notes!, "autonomous")).toBe(true);
  });

  it("keeps manual email at draft-grade", () => {
    const email = {
      ...buildDefaultIntegrationAccounts("user-1").find((integration) => integration.system === "email")!,
      status: "manual" as const
    };

    expect(describeIntegrationReadiness(email)).toEqual(
      expect.objectContaining({
        tier: "draft-grade",
        supportedModes: ["draft"]
      })
    );
    expect(integrationSupportsExecutionMode(email, "approval")).toBe(false);
  });

  it("treats mock adapters as experimental", () => {
    const tasks = buildDefaultIntegrationAccounts("user-1").find((integration) => integration.system === "tasks");

    expect(tasks).toBeDefined();
    expect(describeIntegrationReadiness(tasks!)).toEqual(
      expect.objectContaining({
        tier: "experimental",
        supportedModes: []
      })
    );
  });

  it("keeps managed Google Gmail at approval-grade when the provider credential is healthy", () => {
    const gmail = {
      ...buildDefaultIntegrationAccounts("user-1").find((integration) => integration.id === "gmail")!,
      status: "ready" as const,
      metadata: {
        provider: "google",
        managed: true,
        providerCredentialId: "google:workspace-1:acct-1"
      }
    };

    const readiness = describeIntegrationReadiness(gmail, {
      providerCredential: {
        credential: buildGoogleCredential({
          scopes: ["https://www.googleapis.com/auth/gmail.modify"]
        }),
        hasRefreshTokenSecret: true
      }
    });

    expect(readiness).toEqual(
      expect.objectContaining({
        tier: "approval-grade",
        issues: [],
        managedProvider: expect.objectContaining({
          provider: "google",
          credentialStatus: "connected",
          hasRefreshToken: true,
          missingScopes: []
        }),
        modeSupport: {
          draft: true,
          approval: true,
          autonomous: false
        }
      })
    );
  });

  it("downgrades managed Google calendar when required scopes are missing", () => {
    const calendar = {
      ...buildDefaultIntegrationAccounts("user-1").find((integration) => integration.id === "google-calendar")!,
      status: "ready" as const,
      metadata: {
        provider: "google",
        managed: true,
        providerCredentialId: "google:workspace-1:acct-1"
      }
    };

    const readiness = describeIntegrationReadiness(calendar, {
      providerCredential: {
        credential: buildGoogleCredential({
          scopes: ["https://www.googleapis.com/auth/gmail.modify"]
        }),
        hasRefreshTokenSecret: true
      }
    });

    expect(readiness).toEqual(
      expect.objectContaining({
        tier: "experimental",
        supportedModes: [],
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: "provider_scope_missing",
            blocking: true,
            missingScopes: ["https://www.googleapis.com/auth/calendar"]
          })
        ]),
        managedProvider: expect.objectContaining({
          provider: "google",
          credentialStatus: "connected",
          hasRefreshToken: true,
          missingScopes: ["https://www.googleapis.com/auth/calendar"]
        })
      })
    );
    expect(readiness.supportedModes.includes("approval")).toBe(false);
  });
});
