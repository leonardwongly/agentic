import { afterEach, describe, expect, it } from "vitest";
import {
  assessConnectorEnablement,
  connectorEnablementConfig,
  connectorEnablementProviders,
  connectorEnablementScopeRequirements,
  getLocalNotesRuntimeConfig,
  googleWorkspaceRequiredScopes,
  isSlackReady,
  isTelegramReady,
  summarizeConnectorEnablement,
  type ConnectorEnablementContext,
  type ConnectorEnablementEnv
} from "@agentic/integrations";
import type { LocalNotesRuntimeConfig, ProviderCredential } from "@agentic/integrations";

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
    scopes: overrides?.scopes ?? ["https://www.googleapis.com/auth/gmail.modify"],
    lastValidatedAt: overrides?.lastValidatedAt ?? new Date().toISOString(),
    lastRotatedAt: overrides?.lastRotatedAt ?? null,
    lastRefreshAt: overrides?.lastRefreshAt ?? null,
    lastRefreshFailureAt: overrides?.lastRefreshFailureAt ?? null,
    reconnectRequiredAt: overrides?.reconnectRequiredAt ?? null,
    revokedAt: overrides?.revokedAt ?? null,
    expiresAt: overrides?.expiresAt ?? null,
    metadata: overrides?.metadata ?? {},
    actorContext: overrides?.actorContext ?? null,
    createdAt: overrides?.createdAt ?? "2026-04-18T00:00:00.000Z",
    updatedAt: overrides?.updatedAt ?? new Date().toISOString()
  };
}

const googleOAuthEnv: ConnectorEnablementEnv = {
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret"
};

function devLocalNotesConfig(overrides?: Partial<LocalNotesRuntimeConfig>): LocalNotesRuntimeConfig {
  return {
    enabled: true,
    production: false,
    explicitlyEnabled: false,
    notesPathConfigured: false,
    allowedRootConfigured: false,
    scoped: true,
    ...overrides
  };
}

describe("connector enablement readiness", () => {
  describe("provider config presence", () => {
    it("declares the required and optional env for every provider without overlap", () => {
      for (const provider of connectorEnablementProviders) {
        const declared = connectorEnablementConfig[provider];
        expect(declared.required.length + declared.optional.length).toBeGreaterThan(0);

        const overlap = declared.required.filter((key) => declared.optional.includes(key));
        expect(overlap).toEqual([]);
      }
    });

    it("reports Slack as needs_configuration until both required secrets are present", () => {
      const empty = assessConnectorEnablement("slack", { env: {} });
      expect(empty).toMatchObject({
        connector: "slack",
        category: "messaging",
        enablementState: "needs_configuration",
        configured: false,
        blocking: true
      });
      expect(empty.missingConfig).toEqual(["SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET"]);
      expect(empty.recoveryActions).toHaveLength(1);

      const partial = assessConnectorEnablement("slack", { env: { SLACK_BOT_TOKEN: "xoxb-test" } });
      expect(partial.enablementState).toBe("needs_configuration");
      expect(partial.presentConfig).toEqual(["SLACK_BOT_TOKEN"]);
      expect(partial.missingConfig).toEqual(["SLACK_SIGNING_SECRET"]);

      const ready = assessConnectorEnablement("slack", {
        env: { SLACK_BOT_TOKEN: "xoxb-test", SLACK_SIGNING_SECRET: "secret" }
      });
      expect(ready).toMatchObject({
        enablementState: "ready",
        configured: true,
        blocking: false
      });
      expect(ready.missingConfig).toEqual([]);
      expect(ready.recoveryActions).toEqual([]);
    });

    it("reports Telegram as needs_configuration until both required secrets are present", () => {
      const partial = assessConnectorEnablement("telegram", { env: { TELEGRAM_BOT_TOKEN: "bot-token" } });
      expect(partial.enablementState).toBe("needs_configuration");
      expect(partial.missingConfig).toEqual(["TELEGRAM_WEBHOOK_SECRET"]);

      const ready = assessConnectorEnablement("telegram", {
        env: { TELEGRAM_BOT_TOKEN: "bot-token", TELEGRAM_WEBHOOK_SECRET: "secret" }
      });
      expect(ready.enablementState).toBe("ready");
      expect(ready.blocking).toBe(false);
    });

    it("treats whitespace-only env values as missing config", () => {
      const blank = assessConnectorEnablement("slack", {
        env: { SLACK_BOT_TOKEN: "   ", SLACK_SIGNING_SECRET: "" }
      });
      expect(blank.enablementState).toBe("needs_configuration");
      expect(blank.missingConfig).toEqual(["SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET"]);
    });

    it("reports GitHub issue intake as needs_configuration until secret and allowlist are present", () => {
      const empty = assessConnectorEnablement("github", { env: {} });
      expect(empty).toMatchObject({
        connector: "github",
        category: "ingest",
        enablementState: "needs_configuration",
        configured: false
      });
      expect(empty.missingConfig).toEqual([
        "AGENTIC_GITHUB_WEBHOOK_SECRET",
        "AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES"
      ]);
      expect(empty.recoveryActions[0]?.id).toBe("configure_github_intake");

      const intakeReady = assessConnectorEnablement("github", {
        env: {
          AGENTIC_GITHUB_WEBHOOK_SECRET: "webhook-secret",
          AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES: "leonardwongly/agentic"
        }
      });
      expect(intakeReady.enablementState).toBe("ready");
      expect(intakeReady.configured).toBe(true);
      expect(intakeReady.summary).toContain("GitHub App sync remains optional");
    });
  });

  describe("scope and permission validation", () => {
    it("exposes the operator-facing scope requirements per connector", () => {
      expect(connectorEnablementScopeRequirements.google).toEqual(googleWorkspaceRequiredScopes);
      expect(connectorEnablementScopeRequirements.slack).toContain("chat:write");
      expect(connectorEnablementScopeRequirements.github).toEqual(["issues:write", "metadata:read"]);

      const slack = assessConnectorEnablement("slack", {
        env: { SLACK_BOT_TOKEN: "xoxb", SLACK_SIGNING_SECRET: "secret" }
      });
      expect(slack.requiredScopes).toEqual(["chat:write"]);
    });

    it("blocks managed Google when required scopes are missing on the credential", () => {
      const assessment = assessConnectorEnablement("google", {
        env: googleOAuthEnv,
        google: {
          account: { id: "google-calendar", name: "Google Calendar Adapter", metadata: { provider: "google", managed: true } },
          credential: buildGoogleCredential({
            scopes: ["https://www.googleapis.com/auth/gmail.modify"]
          }),
          hasRefreshTokenSecret: true
        }
      });

      expect(assessment.enablementState).toBe("blocked");
      expect(assessment.blocking).toBe(true);
      expect(assessment.missingScopes).toEqual(["https://www.googleapis.com/auth/calendar"]);
      expect(assessment.recoveryActions.map((action) => action.id)).toContain("request_scope_upgrade");
      expect(assessment.managedCredential?.lifecycleState).toBe("scope_mismatch");
    });

    it("marks managed Google ready when the credential is healthy with required scopes", () => {
      const assessment = assessConnectorEnablement("google", {
        env: googleOAuthEnv,
        google: {
          credential: buildGoogleCredential({
            scopes: ["https://www.googleapis.com/auth/gmail.modify"]
          }),
          hasRefreshTokenSecret: true
        }
      });

      expect(assessment.enablementState).toBe("ready");
      expect(assessment.configured).toBe(true);
      expect(assessment.blocking).toBe(false);
      expect(assessment.missingScopes).toEqual([]);
      expect(assessment.recoveryActions).toEqual([]);
      expect(assessment.managedCredential?.lifecycleState).toBe("healthy");
    });
  });

  describe("managed Google recovery-state transitions", () => {
    it("requires OAuth app configuration before connecting accounts", () => {
      const assessment = assessConnectorEnablement("google", { env: {} });
      expect(assessment.enablementState).toBe("needs_configuration");
      expect(assessment.configured).toBe(false);
      expect(assessment.missingConfig).toEqual(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]);
    });

    it("requests an account connection once the OAuth app is configured but no credential exists", () => {
      const assessment = assessConnectorEnablement("google", { env: googleOAuthEnv, google: { credential: null } });
      expect(assessment.enablementState).toBe("needs_configuration");
      expect(assessment.configured).toBe(true);
      expect(assessment.managedCredential?.lifecycleState).toBe("missing");
      expect(assessment.recoveryActions.map((action) => action.id)).toContain("connect_google");
    });

    it("blocks and requests reconnect when the credential is revoked", () => {
      const assessment = assessConnectorEnablement("google", {
        env: googleOAuthEnv,
        google: {
          credential: buildGoogleCredential({ status: "revoked" }),
          hasRefreshTokenSecret: true
        }
      });
      expect(assessment.enablementState).toBe("blocked");
      expect(assessment.managedCredential?.lifecycleState).toBe("revoked");
      expect(assessment.managedCredential?.repairState).toBe("reconnect_required");
      expect(assessment.recoveryActions.map((action) => action.id)).toContain("reconnect_google");
    });

    it("blocks and requests reconnect when the credential is expired", () => {
      const assessment = assessConnectorEnablement("google", {
        env: googleOAuthEnv,
        google: {
          credential: buildGoogleCredential({ expiresAt: "2020-01-01T00:00:00.000Z" }),
          hasRefreshTokenSecret: true,
          now: Date.parse("2026-06-15T00:00:00.000Z")
        }
      });
      expect(assessment.enablementState).toBe("blocked");
      expect(assessment.managedCredential?.lifecycleState).toBe("expired");
      expect(assessment.managedCredential?.repairState).toBe("reconnect_required");
    });

    it("blocks when the credential is in a reconnect_required status", () => {
      const assessment = assessConnectorEnablement("google", {
        env: googleOAuthEnv,
        google: {
          credential: buildGoogleCredential({ status: "reconnect_required" }),
          hasRefreshTokenSecret: true
        }
      });
      expect(assessment.enablementState).toBe("blocked");
      expect(assessment.managedCredential?.repairState).toBe("reconnect_required");
    });

    it("blocks and requests a refresh repair when the encrypted refresh token is missing", () => {
      const assessment = assessConnectorEnablement("google", {
        env: googleOAuthEnv,
        google: {
          credential: buildGoogleCredential(),
          hasRefreshTokenSecret: false
        }
      });
      expect(assessment.enablementState).toBe("blocked");
      expect(assessment.managedCredential?.repairState).toBe("refresh_repair_required");
    });
  });

  describe("local notes runtime gating", () => {
    it("is ready in development", () => {
      const assessment = assessConnectorEnablement("local-notes", { localNotesConfig: devLocalNotesConfig() });
      expect(assessment).toMatchObject({
        connector: "local-notes",
        category: "local",
        enablementState: "ready",
        configured: true,
        blocking: false
      });
    });

    it("is disabled in production until the explicit enable and scope flags are set", () => {
      const assessment = assessConnectorEnablement("local-notes", {
        localNotesConfig: {
          enabled: false,
          production: true,
          explicitlyEnabled: false,
          notesPathConfigured: false,
          allowedRootConfigured: false,
          scoped: false
        }
      });
      expect(assessment.enablementState).toBe("disabled");
      expect(assessment.blocking).toBe(true);
      expect(assessment.missingConfig).toEqual([
        "AGENTIC_LOCAL_NOTES_ENABLED",
        "AGENTIC_NOTES_PATH",
        "AGENTIC_LOCAL_NOTES_ALLOWED_ROOT"
      ]);
      expect(assessment.recoveryActions[0]?.id).toBe("enable_local_notes");
    });

    it("is ready in production when explicitly enabled and scoped", () => {
      const assessment = assessConnectorEnablement("local-notes", {
        localNotesConfig: {
          enabled: true,
          production: true,
          explicitlyEnabled: true,
          notesPathConfigured: true,
          allowedRootConfigured: true,
          scoped: true
        }
      });
      expect(assessment.enablementState).toBe("ready");
      expect(assessment.missingConfig).toEqual([]);
    });

    it("is blocked in production when the notes path falls outside the allowed root", () => {
      const assessment = assessConnectorEnablement("local-notes", {
        localNotesConfig: {
          enabled: false,
          production: true,
          explicitlyEnabled: true,
          notesPathConfigured: true,
          allowedRootConfigured: true,
          scoped: false
        }
      });
      expect(assessment.enablementState).toBe("blocked");
      expect(assessment.recoveryActions[0]?.id).toBe("scope_local_notes_path");
    });
  });

  describe("github app sync layering", () => {
    it("blocks when GitHub App sync is partially configured", () => {
      const assessment = assessConnectorEnablement("github", {
        env: {
          AGENTIC_GITHUB_WEBHOOK_SECRET: "webhook-secret",
          AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES: "leonardwongly/agentic",
          AGENTIC_GITHUB_APP_ID: "12345"
        }
      });
      expect(assessment.enablementState).toBe("blocked");
      expect(assessment.summary).toContain("partially configured");
      expect(assessment.recoveryActions[0]?.id).toBe("complete_github_app_sync");
    });

    it("is ready when intake and full app sync are configured", () => {
      const assessment = assessConnectorEnablement("github", {
        env: {
          AGENTIC_GITHUB_WEBHOOK_SECRET: "webhook-secret",
          AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES: "leonardwongly/agentic",
          AGENTIC_GITHUB_APP_ID: "12345",
          AGENTIC_GITHUB_APP_INSTALLATION_ID: "67890",
          AGENTIC_GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----",
          AGENTIC_GITHUB_APP_SYNC_SECRET: "sync-secret"
        }
      });
      expect(assessment.enablementState).toBe("ready");
      expect(assessment.summary).toContain("both configured");
    });
  });

  describe("summary aggregation", () => {
    it("summarizes a fully unconfigured runtime as needing configuration with no blocked recovery", () => {
      const summary = summarizeConnectorEnablement({
        env: {},
        localNotesConfig: devLocalNotesConfig()
      });

      expect(summary.connectors.map((item) => item.connector)).toEqual([
        "google",
        "slack",
        "telegram",
        "local-notes",
        "github"
      ]);
      // local-notes is ready in dev; google/slack/telegram/github need configuration.
      expect(summary.ready).toBe(1);
      expect(summary.needsConfiguration).toBe(4);
      expect(summary.blocked).toBe(0);
      expect(summary.anyReady).toBe(true);
      expect(summary.allReady).toBe(false);
      expect(summary.recoveryClear).toBe(true);
    });

    it("flags recovery work in the summary when a managed credential is blocked", () => {
      const summary = summarizeConnectorEnablement({
        env: {
          ...googleOAuthEnv,
          SLACK_BOT_TOKEN: "xoxb",
          SLACK_SIGNING_SECRET: "secret",
          TELEGRAM_BOT_TOKEN: "bot",
          TELEGRAM_WEBHOOK_SECRET: "secret",
          AGENTIC_GITHUB_WEBHOOK_SECRET: "webhook-secret",
          AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES: "leonardwongly/agentic"
        },
        localNotesConfig: devLocalNotesConfig(),
        google: {
          credential: buildGoogleCredential({ status: "revoked" }),
          hasRefreshTokenSecret: true
        }
      });

      expect(summary.blocked).toBe(1);
      expect(summary.recoveryClear).toBe(false);
      const google = summary.connectors.find((item) => item.connector === "google");
      expect(google?.enablementState).toBe("blocked");
    });
  });

  describe("live runtime helper parity", () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it("matches isSlackReady and isTelegramReady when reading the live environment", () => {
      process.env.SLACK_BOT_TOKEN = "xoxb-live";
      process.env.SLACK_SIGNING_SECRET = "slack-secret";
      process.env.TELEGRAM_BOT_TOKEN = "telegram-live";
      process.env.TELEGRAM_WEBHOOK_SECRET = "telegram-secret";

      const context: ConnectorEnablementContext = {};
      expect(assessConnectorEnablement("slack", context).configured).toBe(isSlackReady());
      expect(assessConnectorEnablement("telegram", context).configured).toBe(isTelegramReady());
    });

    it("matches getLocalNotesRuntimeConfig.enabled when no override is supplied", () => {
      const assessment = assessConnectorEnablement("local-notes", {});
      expect(assessment.configured).toBe(getLocalNotesRuntimeConfig().enabled);
    });
  });
});
