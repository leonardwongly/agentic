import {
  buildDefaultIntegrationAccounts,
  describeIntegrationReadiness,
  integrationReadinessMeetsTier,
  integrationSupportsExecutionMode
} from "@agentic/integrations";
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
  it("compares readiness tiers monotonically for execution gates", () => {
    expect(integrationReadinessMeetsTier("approval-grade", "draft-grade")).toBe(true);
    expect(integrationReadinessMeetsTier("approval-grade", "approval-grade")).toBe(true);
    expect(integrationReadinessMeetsTier("draft-grade", "approval-grade")).toBe(false);
    expect(integrationReadinessMeetsTier("experimental", "draft-grade")).toBe(false);
    expect(integrationReadinessMeetsTier("autonomous-grade", "approval-grade")).toBe(true);
  });

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
          lastValidatedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
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
          lifecycleState: "healthy",
          repairState: "none",
          hasRefreshToken: true,
          missingScopes: [],
          recoveryActions: [],
          sloGates: expect.arrayContaining([
            expect.objectContaining({
              id: "credential_lifecycle",
              status: "pass"
            }),
            expect.objectContaining({
              id: "scope_coverage",
              status: "pass"
            })
          ])
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
          lifecycleState: "scope_mismatch",
          repairState: "scope_repair_required",
          hasRefreshToken: true,
          missingScopes: ["https://www.googleapis.com/auth/calendar"],
          recoveryActions: expect.arrayContaining([
            expect.objectContaining({
              id: "request_scope_upgrade",
              operation: "open_google_connect"
            })
          ]),
          sloGates: expect.arrayContaining([
            expect.objectContaining({
              id: "scope_coverage",
              status: "fail"
            })
          ])
        })
      })
    );
    expect(readiness.supportedModes.includes("approval")).toBe(false);
  });

  it("models missing managed Google credentials as setup recovery work", () => {
    const gmail = {
      ...buildDefaultIntegrationAccounts("user-1").find((integration) => integration.id === "gmail")!,
      status: "ready" as const,
      metadata: {
        provider: "google",
        managed: true
      }
    };

    const readiness = describeIntegrationReadiness(gmail);

    expect(readiness).toEqual(
      expect.objectContaining({
        tier: "experimental",
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: "provider_credential_missing",
            blocking: true
          })
        ]),
        managedProvider: expect.objectContaining({
          credentialStatus: "missing",
          lifecycleState: "missing",
          repairState: "setup_required",
          recoveryActions: expect.arrayContaining([
            expect.objectContaining({
              id: "connect_google",
              operation: "open_google_connect"
            })
          ])
        })
      })
    );
  });

  it("treats expired credentials as reconnect-required and blocks readiness", () => {
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
          expiresAt: "2026-04-18T00:00:00.000Z",
          scopes: ["https://www.googleapis.com/auth/gmail.modify"]
        }),
        hasRefreshTokenSecret: true
      }
    });

    expect(readiness).toEqual(
      expect.objectContaining({
        tier: "experimental",
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: "provider_credential_expired",
            blocking: true
          })
        ]),
        managedProvider: expect.objectContaining({
          lifecycleState: "expired",
          repairState: "reconnect_required",
          recoveryActions: expect.arrayContaining([
            expect.objectContaining({
              id: "reconnect_google"
            })
          ])
        })
      })
    );
  });

  it("redacts reconciliation cursors while exposing replay readiness", () => {
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
          metadata: {
            reconciliationCursor: "provider-cursor-secret",
            lastReplayJobId: "job-replay-1"
          },
          scopes: ["https://www.googleapis.com/auth/gmail.modify"]
        }),
        hasRefreshTokenSecret: true
      }
    });

    expect(readiness.managedProvider?.reconciliation).toEqual(
      expect.objectContaining({
        cursorPresent: true,
        lastReplayJobId: "job-replay-1",
        replayAvailable: true
      })
    );
    expect(readiness.managedProvider?.reconciliation.cursorRef).not.toBe("provider-cursor-secret");
    expect(readiness.managedProvider?.reconciliation.idempotencyKey).toContain("connector-replay:google:workspace-1:acct-1:");
  });
});
