import type { IntegrationAccount, ProviderCredential } from "@agentic/contracts";
import {
  assessManagedGoogleCredential,
  googleWorkspaceRequiredScopes,
  type GoogleCredentialAssessment
} from "./google-managed-readiness";
import { getLocalNotesRuntimeConfig, type LocalNotesRuntimeConfig } from "./local-notes";

// ---------------------------------------------------------------------------
// Connector enablement readiness
//
// This module answers the *operator setup* question: "given the current runtime
// configuration, can this connector be enabled, what is still missing, and what
// bounded recovery action repairs it?" It is complementary to
// `describeIntegrationReadiness`, which answers the *execution* question ("given
// a configured account, which execution tier and modes does it support?").
//
// Everything here is a pure assessment over injected configuration. It never
// reads or returns secret values, never performs provider calls, and never
// mutates capability readiness. Tests can therefore exercise every config and
// recovery transition without live secrets by injecting `env`, a managed Google
// credential snapshot, or a local-notes runtime config.
// ---------------------------------------------------------------------------

export const connectorEnablementProviders = ["google", "slack", "telegram", "local-notes", "github"] as const;

export type ConnectorEnablementProvider = (typeof connectorEnablementProviders)[number];

export type ConnectorEnablementCategory = "managed-oauth" | "messaging" | "local" | "ingest";

/**
 * Operator-facing enablement state.
 *
 * - `ready`: configured and healthy; the connector can be enabled now.
 * - `needs_configuration`: required runtime config or an authorization step is
 *   missing before the connector can be enabled.
 * - `blocked`: configured/connected but in a recovery state (revoked, expired,
 *   missing scopes, refresh failure) that must be repaired before safe use.
 * - `disabled`: intentionally gated off by the runtime (for example local notes
 *   in production without the explicit enable + scope flags).
 */
export type ConnectorEnablementState = "ready" | "needs_configuration" | "blocked" | "disabled";

export type ConnectorEnablementRecoveryAction = {
  id: string;
  summary: string;
  operatorSteps: string[];
};

export type ConnectorEnablementAssessment = {
  connector: ConnectorEnablementProvider;
  category: ConnectorEnablementCategory;
  enablementState: ConnectorEnablementState;
  /** Whether the static runtime configuration (env vars) required to enable the connector is present. */
  configured: boolean;
  /** True when the connector is not `ready` and therefore blocks integration graduation. */
  blocking: boolean;
  /** Environment variable names that are present (names only — never values). */
  presentConfig: string[];
  /** Required environment variable names that are still missing. */
  missingConfig: string[];
  /** Optional environment variable names that improve the connector but are not strictly required. */
  optionalConfig: string[];
  /** Scopes or provider permissions an operator must grant for this connector. */
  requiredScopes: string[];
  /** Scopes that are required but not yet present on the live credential (managed connectors only). */
  missingScopes: string[];
  recoveryActions: ConnectorEnablementRecoveryAction[];
  summary: string;
  /** Present for managed Google connectors; mirrors the credential lifecycle assessment. */
  managedCredential: GoogleCredentialAssessment | null;
};

export type ConnectorEnablementEnv = Record<string, string | undefined>;

export type ConnectorEnablementContext = {
  /** Environment to read connector config from. Defaults to `process.env`. */
  env?: ConnectorEnablementEnv;
  /** Managed Google credential snapshot used to assess credential lifecycle and recovery state. */
  google?: {
    account?: Pick<IntegrationAccount, "id" | "name" | "metadata">;
    credential?: Pick<
      ProviderCredential,
      "id" | "status" | "scopes" | "expiresAt" | "lastValidatedAt" | "updatedAt" | "metadata"
    > | null;
    hasRefreshTokenSecret?: boolean;
    now?: number;
  };
  /** Local notes runtime config override. Defaults to `getLocalNotesRuntimeConfig()`. */
  localNotesConfig?: LocalNotesRuntimeConfig;
  localNotesBasePath?: string;
};

// ---------------------------------------------------------------------------
// Required configuration declarations (single source of truth for the runbook).
// ---------------------------------------------------------------------------

export const connectorEnablementConfig: Record<
  ConnectorEnablementProvider,
  { category: ConnectorEnablementCategory; required: readonly string[]; optional: readonly string[] }
> = {
  google: {
    category: "managed-oauth",
    required: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    optional: ["GOOGLE_REFRESH_TOKEN", "AGENTIC_PROVIDER_SECRET_KEY", "AGENTIC_PROVIDER_SECRET_KEY_VERSION", "AGENTIC_PUBLIC_BASE_URL"]
  },
  slack: {
    category: "messaging",
    required: ["SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET"],
    optional: ["SLACK_DEFAULT_CHANNEL"]
  },
  telegram: {
    category: "messaging",
    required: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET"],
    optional: ["TELEGRAM_DEFAULT_CHAT_ID"]
  },
  "local-notes": {
    category: "local",
    // Production gating is enforced through getLocalNotesRuntimeConfig; these are
    // the production-only requirements an operator must set to enable the connector.
    required: ["AGENTIC_LOCAL_NOTES_ENABLED", "AGENTIC_NOTES_PATH", "AGENTIC_LOCAL_NOTES_ALLOWED_ROOT"],
    optional: []
  },
  github: {
    category: "ingest",
    required: ["AGENTIC_GITHUB_WEBHOOK_SECRET", "AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES"],
    optional: [
      "AGENTIC_GITHUB_ISSUE_INTAKE_USER_ID",
      "AGENTIC_GITHUB_APP_ID",
      "AGENTIC_GITHUB_APP_INSTALLATION_ID",
      "AGENTIC_GITHUB_APP_PRIVATE_KEY",
      "AGENTIC_GITHUB_APP_SYNC_SECRET"
    ]
  }
};

export const connectorEnablementScopeRequirements: Record<ConnectorEnablementProvider, readonly string[]> = {
  google: googleWorkspaceRequiredScopes,
  // Slack bot must be granted chat:write to post and update governed approval messages.
  slack: ["chat:write"],
  // Telegram bots authorize through the bot token; there is no granular scope model.
  telegram: [],
  // Local notes access is bounded by AGENTIC_LOCAL_NOTES_ALLOWED_ROOT rather than provider scopes.
  "local-notes": [],
  // GitHub App permissions required for governed issue intake and sync.
  github: ["issues:write", "metadata:read"]
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasEnvValue(env: ConnectorEnablementEnv, key: string): boolean {
  const raw = env[key];
  return typeof raw === "string" && raw.trim().length > 0;
}

function partitionConfig(
  env: ConnectorEnablementEnv,
  keys: readonly string[]
): { present: string[]; missing: string[] } {
  const present: string[] = [];
  const missing: string[] = [];

  for (const key of keys) {
    if (hasEnvValue(env, key)) {
      present.push(key);
    } else {
      missing.push(key);
    }
  }

  return { present, missing };
}

function mapCredentialRecoveryActions(
  assessment: GoogleCredentialAssessment
): ConnectorEnablementRecoveryAction[] {
  return assessment.recoveryActions.map((action) => ({
    id: action.id,
    summary: action.description,
    operatorSteps: action.operatorSteps
  }));
}

// ---------------------------------------------------------------------------
// Per-connector assessment
// ---------------------------------------------------------------------------

function assessGoogleEnablement(
  env: ConnectorEnablementEnv,
  context: ConnectorEnablementContext
): ConnectorEnablementAssessment {
  const declared = connectorEnablementConfig.google;
  const requiredPartition = partitionConfig(env, declared.required);
  const optionalPartition = partitionConfig(env, declared.optional);
  const oauthAppConfigured = requiredPartition.missing.length === 0;

  const account =
    context.google?.account ??
    ({
      id: "gmail",
      name: "Gmail Adapter",
      metadata: { provider: "google", managed: true }
    } satisfies Pick<IntegrationAccount, "id" | "name" | "metadata">);

  const assessment = assessManagedGoogleCredential({
    account,
    credential: context.google?.credential ?? null,
    hasRefreshTokenSecret: context.google?.hasRefreshTokenSecret ?? false,
    now: context.google?.now
  });

  // `account` is a managed Google integration, so the assessment is never null.
  const credentialAssessment = assessment as GoogleCredentialAssessment;
  const requiredScopes = [...connectorEnablementScopeRequirements.google];

  let enablementState: ConnectorEnablementState;
  let summary: string;

  if (!oauthAppConfigured) {
    enablementState = "needs_configuration";
    summary = `Set the managed Google OAuth app credentials (${requiredPartition.missing.join(", ")}) before connecting accounts.`;
  } else if (credentialAssessment.lifecycleState === "missing") {
    enablementState = "needs_configuration";
    summary = "Google OAuth app is configured; connect a workspace account to issue a managed provider credential.";
  } else if (credentialAssessment.ready) {
    enablementState = "ready";
    summary = "Managed Google connector is configured with a healthy credential and the required scopes.";
  } else {
    enablementState = "blocked";
    summary =
      credentialAssessment.issues[0]?.message ??
      "Managed Google credential requires recovery before governed execution can resume.";
  }

  const recoveryActions =
    enablementState === "ready" ? [] : mapCredentialRecoveryActions(credentialAssessment);

  return {
    connector: "google",
    category: declared.category,
    enablementState,
    configured: oauthAppConfigured,
    blocking: enablementState !== "ready",
    presentConfig: requiredPartition.present,
    missingConfig: requiredPartition.missing,
    optionalConfig: optionalPartition.missing,
    requiredScopes,
    missingScopes: credentialAssessment.missingScopes,
    recoveryActions,
    summary,
    managedCredential: credentialAssessment
  };
}

function assessMessagingEnablement(
  connector: "slack" | "telegram",
  env: ConnectorEnablementEnv
): ConnectorEnablementAssessment {
  const declared = connectorEnablementConfig[connector];
  const requiredPartition = partitionConfig(env, declared.required);
  const optionalPartition = partitionConfig(env, declared.optional);
  const configured = requiredPartition.missing.length === 0;
  const label = connector === "slack" ? "Slack" : "Telegram";

  return {
    connector,
    category: declared.category,
    enablementState: configured ? "ready" : "needs_configuration",
    configured,
    blocking: !configured,
    presentConfig: requiredPartition.present,
    missingConfig: requiredPartition.missing,
    optionalConfig: optionalPartition.missing,
    requiredScopes: [...connectorEnablementScopeRequirements[connector]],
    missingScopes: [],
    recoveryActions: configured
      ? []
      : [
          {
            id: `configure_${connector}`,
            summary: `Set the required ${label} runtime secrets before enabling governed ${label} messaging.`,
            operatorSteps: [
              `Set ${declared.required.join(" and ")} in the deployment provider secret store.`,
              `Restart the web and worker processes so the ${label} adapter re-reads its configuration.`,
              `Confirm the ${label} connector reports ready before routing approvals or notifications to it.`
            ]
          }
        ],
    summary: configured
      ? `${label} runtime secrets are present; the connector can be enabled for governed messaging.`
      : `${label} is not configured. Missing: ${requiredPartition.missing.join(", ")}.`,
    managedCredential: null
  };
}

function assessLocalNotesEnablement(context: ConnectorEnablementContext): ConnectorEnablementAssessment {
  const declared = connectorEnablementConfig["local-notes"];
  const config = context.localNotesConfig ?? getLocalNotesRuntimeConfig(context.localNotesBasePath);

  const missingConfig: string[] = [];
  if (config.production) {
    if (!config.explicitlyEnabled) {
      missingConfig.push("AGENTIC_LOCAL_NOTES_ENABLED");
    }
    if (!config.notesPathConfigured) {
      missingConfig.push("AGENTIC_NOTES_PATH");
    }
    if (!config.allowedRootConfigured) {
      missingConfig.push("AGENTIC_LOCAL_NOTES_ALLOWED_ROOT");
    }
  }

  const presentConfig = declared.required.filter((key) => !missingConfig.includes(key));

  let enablementState: ConnectorEnablementState;
  let summary: string;
  const recoveryActions: ConnectorEnablementRecoveryAction[] = [];

  if (config.enabled) {
    enablementState = "ready";
    summary = config.production
      ? "Local notes are explicitly enabled and scoped under the allowed root for production."
      : "Local notes are enabled for development and ready for autonomous local knowledge capture.";
  } else if (config.production && config.allowedRootConfigured && config.notesPathConfigured && !config.scoped) {
    enablementState = "blocked";
    summary = "Local notes path is configured but falls outside AGENTIC_LOCAL_NOTES_ALLOWED_ROOT, so the connector stays disabled.";
    recoveryActions.push({
      id: "scope_local_notes_path",
      summary: "Move the notes path under the allowed root so the production scope check passes.",
      operatorSteps: [
        "Set AGENTIC_NOTES_PATH to a directory inside AGENTIC_LOCAL_NOTES_ALLOWED_ROOT.",
        "Restart the web and worker processes.",
        "Confirm local notes report enabled before relying on local knowledge capture."
      ]
    });
  } else {
    enablementState = "disabled";
    summary = "Local notes are disabled in production until the explicit enable, path, and allowed-root flags are set.";
    recoveryActions.push({
      id: "enable_local_notes",
      summary: "Enable and scope local notes for production.",
      operatorSteps: [
        "Set AGENTIC_LOCAL_NOTES_ENABLED=true.",
        "Set AGENTIC_NOTES_PATH to the notes directory and AGENTIC_LOCAL_NOTES_ALLOWED_ROOT to its parent allowed root.",
        "Restart the web and worker processes and confirm local notes report enabled."
      ]
    });
  }

  return {
    connector: "local-notes",
    category: declared.category,
    enablementState,
    configured: config.enabled,
    blocking: enablementState !== "ready",
    presentConfig,
    missingConfig,
    optionalConfig: [],
    requiredScopes: [...connectorEnablementScopeRequirements["local-notes"]],
    missingScopes: [],
    recoveryActions,
    summary,
    managedCredential: null
  };
}

function assessGithubEnablement(env: ConnectorEnablementEnv): ConnectorEnablementAssessment {
  const declared = connectorEnablementConfig.github;
  const requiredPartition = partitionConfig(env, declared.required);
  const optionalPartition = partitionConfig(env, declared.optional);
  const intakeConfigured = requiredPartition.missing.length === 0;

  // GitHub App sync is an optional layer on top of issue intake. Track whether the
  // operator has started configuring it so partial setups surface as recovery work.
  const appSyncKeys = [
    "AGENTIC_GITHUB_APP_ID",
    "AGENTIC_GITHUB_APP_INSTALLATION_ID",
    "AGENTIC_GITHUB_APP_PRIVATE_KEY",
    "AGENTIC_GITHUB_APP_SYNC_SECRET"
  ];
  const appSyncPartition = partitionConfig(env, appSyncKeys);
  const appSyncStarted = appSyncPartition.present.length > 0;
  const appSyncComplete = appSyncPartition.missing.length === 0;

  const recoveryActions: ConnectorEnablementRecoveryAction[] = [];
  let enablementState: ConnectorEnablementState;
  let summary: string;

  if (!intakeConfigured) {
    enablementState = "needs_configuration";
    summary = `GitHub issue intake is not configured. Missing: ${requiredPartition.missing.join(", ")}.`;
    recoveryActions.push({
      id: "configure_github_intake",
      summary: "Configure the governed GitHub issue intake webhook.",
      operatorSteps: [
        "Set AGENTIC_GITHUB_WEBHOOK_SECRET to the shared webhook signing secret.",
        "Set AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES to the owner/repo allowlist.",
        "Register the webhook for issues and issue_comment events and confirm signature verification passes."
      ]
    });
  } else if (appSyncStarted && !appSyncComplete) {
    enablementState = "blocked";
    summary = `GitHub issue intake is configured, but GitHub App sync is partially configured. Missing: ${appSyncPartition.missing.join(", ")}.`;
    recoveryActions.push({
      id: "complete_github_app_sync",
      summary: "Finish GitHub App sync configuration or remove the partial values.",
      operatorSteps: [
        `Set the remaining GitHub App sync values (${appSyncPartition.missing.join(", ")}).`,
        "Keep AGENTIC_GITHUB_APP_SYNC_SECRET in the deployment provider, not in repository CI secrets.",
        "Re-run the GitHub App sync preflight before enabling sync."
      ]
    });
  } else {
    enablementState = "ready";
    summary = appSyncComplete
      ? "GitHub issue intake and GitHub App sync are both configured."
      : "GitHub issue intake is configured; GitHub App sync remains optional.";
  }

  return {
    connector: "github",
    category: declared.category,
    enablementState,
    configured: intakeConfigured,
    blocking: enablementState !== "ready",
    presentConfig: requiredPartition.present,
    missingConfig: requiredPartition.missing,
    optionalConfig: optionalPartition.missing,
    requiredScopes: [...connectorEnablementScopeRequirements.github],
    missingScopes: [],
    recoveryActions,
    summary,
    managedCredential: null
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function assessConnectorEnablement(
  connector: ConnectorEnablementProvider,
  context: ConnectorEnablementContext = {}
): ConnectorEnablementAssessment {
  const env = context.env ?? process.env;

  switch (connector) {
    case "google":
      return assessGoogleEnablement(env, context);
    case "slack":
    case "telegram":
      return assessMessagingEnablement(connector, env);
    case "local-notes":
      return assessLocalNotesEnablement(context);
    case "github":
      return assessGithubEnablement(env);
    default: {
      // Exhaustiveness guard: every provider must be handled above.
      const unreachable: never = connector;
      throw new Error(`Unsupported connector enablement provider: ${String(unreachable)}`);
    }
  }
}

export type ConnectorEnablementSummary = {
  connectors: ConnectorEnablementAssessment[];
  ready: number;
  needsConfiguration: number;
  blocked: number;
  disabled: number;
  /** At least one connector is enablable now. */
  anyReady: boolean;
  /** Every connector reports `ready`. */
  allReady: boolean;
  /** No connector is in a `blocked` recovery state. */
  recoveryClear: boolean;
};

export function summarizeConnectorEnablement(
  context: ConnectorEnablementContext = {}
): ConnectorEnablementSummary {
  const connectors = connectorEnablementProviders.map((provider) =>
    assessConnectorEnablement(provider, context)
  );

  const ready = connectors.filter((item) => item.enablementState === "ready").length;
  const needsConfiguration = connectors.filter((item) => item.enablementState === "needs_configuration").length;
  const blocked = connectors.filter((item) => item.enablementState === "blocked").length;
  const disabled = connectors.filter((item) => item.enablementState === "disabled").length;

  return {
    connectors,
    ready,
    needsConfiguration,
    blocked,
    disabled,
    anyReady: ready > 0,
    allReady: ready === connectors.length,
    recoveryClear: blocked === 0
  };
}
