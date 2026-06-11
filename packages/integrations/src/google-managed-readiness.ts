import type { IntegrationAccount, ProviderCredential, ProviderCredentialStatus } from "@agentic/contracts";

export const managedGoogleRequiredScopesByIntegration = {
  gmail: ["https://www.googleapis.com/auth/gmail.modify"],
  "google-calendar": ["https://www.googleapis.com/auth/calendar"]
} as const;

export const googleWorkspaceRequiredScopes = [
  ...new Set(
    Object.values(managedGoogleRequiredScopesByIntegration).flatMap((scopes) => scopes)
  )
] as string[];

export const googleCredentialIssueCodeValues = [
  "provider_credential_missing",
  "provider_credential_expired",
  "provider_refresh_token_missing",
  "provider_scope_missing",
  "provider_reconnect_required",
  "provider_refresh_failed",
  "provider_revoked"
] as const;

export type GoogleCredentialIssueCode = (typeof googleCredentialIssueCodeValues)[number];

export type GoogleCredentialIssue = {
  code: GoogleCredentialIssueCode;
  blocking: boolean;
  message: string;
  missingScopes?: string[];
};

export const googleCredentialLifecycleStateValues = [
  "missing",
  "healthy",
  "degraded",
  "expired",
  "revoked",
  "scope_mismatch"
] as const;

export type GoogleCredentialLifecycleState = (typeof googleCredentialLifecycleStateValues)[number];

export const googleCredentialRepairStateValues = [
  "none",
  "setup_required",
  "reconnect_required",
  "scope_repair_required",
  "refresh_repair_required",
  "validation_required"
] as const;

export type GoogleCredentialRepairState = (typeof googleCredentialRepairStateValues)[number];

export type GoogleCredentialRecoveryAction = {
  id:
    | "connect_google"
    | "reconnect_google"
    | "request_scope_upgrade"
    | "revalidate_credential"
    | "replay_reconciliation";
  label: string;
  description: string;
  operatorSteps: string[];
  operation:
    | "open_google_connect"
    | "mark_connector_reconnect_required"
    | "revalidate_connector_credential"
    | "enqueue_connector_reconciliation_replay";
};

export type GoogleCredentialSloGate = {
  id: "credential_lifecycle" | "scope_coverage" | "refresh_token_presence" | "validation_freshness";
  label: string;
  status: "pass" | "warn" | "fail";
  message: string;
  threshold: string;
};

export type GoogleCredentialReconciliationState = {
  cursorPresent: boolean;
  cursorRef: string | null;
  cursorUpdatedAt: string | null;
  cursorAgeSeconds: number | null;
  cursorStale: boolean;
  lastReplayJobId: string | null;
  replayAvailable: boolean;
  replayJobKind: "connector_reconciliation_replay" | null;
  idempotencyKey: string | null;
};

export type GoogleCredentialAssessment = {
  provider: "google";
  providerCredentialId: string | null;
  credentialStatus: ProviderCredentialStatus | "missing";
  lifecycleState: GoogleCredentialLifecycleState;
  repairState: GoogleCredentialRepairState;
  hasRefreshToken: boolean;
  missingScopes: string[];
  issues: GoogleCredentialIssue[];
  recoveryActions: GoogleCredentialRecoveryAction[];
  sloGates: GoogleCredentialSloGate[];
  reconciliation: GoogleCredentialReconciliationState;
  ready: boolean;
};

const DEFAULT_GOOGLE_VALIDATION_FRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_GOOGLE_RECONCILIATION_CURSOR_STALE_MS = 24 * 60 * 60 * 1000;

function extractProviderCredentialId(account: Pick<IntegrationAccount, "metadata">): string | null {
  const raw = account.metadata.providerCredentialId;
  return typeof raw === "string" && raw.trim().length > 0 ? raw : null;
}

function parseTimestampMs(timestamp: string | null | undefined): number | null {
  if (!timestamp) {
    return null;
  }

  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

function boundedMetadataString(metadata: Record<string, unknown>, key: string, maxLength: number): string | null {
  const raw = metadata[key];

  if (typeof raw !== "string") {
    return null;
  }

  const trimmed = raw.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null;
}

function buildCursorRef(cursor: string | null): string | null {
  if (!cursor) {
    return null;
  }

  // Runtime-agnostic 16-char fingerprint (no node:crypto), so this module is safe
  // to include in client/edge bundles and the OpenNext (webpack) build. Not
  // security-sensitive: it only redacts and references the opaque provider cursor.
  let h1 = 0x811c9dc5;
  let h2 = 0xc2b2ae35;
  for (let i = 0; i < cursor.length; i += 1) {
    const code = cursor.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193);
    h2 = Math.imul(h2 ^ code, 0x85ebca77);
  }
  const toHex = (value: number): string => (value >>> 0).toString(16).padStart(8, "0");
  return `${toHex(h1)}${toHex(h2)}`;
}

function buildReconciliationState(params: {
  providerCredentialId: string | null;
  credential?: Pick<ProviderCredential, "id" | "metadata"> | null;
  now: number;
}): GoogleCredentialReconciliationState {
  const cursor = params.credential
    ? boundedMetadataString(params.credential.metadata, "reconciliationCursor", 500)
    : null;
  const cursorUpdatedAt = params.credential
    ? boundedMetadataString(params.credential.metadata, "reconciliationCursorUpdatedAt", 80)
    : null;
  const cursorUpdatedAtMs = parseTimestampMs(cursorUpdatedAt);
  const cursorAgeSeconds = cursorUpdatedAtMs !== null ? Math.max(0, Math.floor((params.now - cursorUpdatedAtMs) / 1000)) : null;
  const lastReplayJobId = params.credential
    ? boundedMetadataString(params.credential.metadata, "lastReplayJobId", 200)
    : null;
  const credentialId = params.credential?.id ?? params.providerCredentialId;
  const replayAvailable = Boolean(credentialId && cursor);

  return {
    cursorPresent: Boolean(cursor),
    cursorRef: buildCursorRef(cursor),
    cursorUpdatedAt: cursorUpdatedAtMs !== null ? new Date(cursorUpdatedAtMs).toISOString() : null,
    cursorAgeSeconds,
    cursorStale:
      Boolean(cursor) &&
      cursorUpdatedAtMs !== null &&
      params.now - cursorUpdatedAtMs >= DEFAULT_GOOGLE_RECONCILIATION_CURSOR_STALE_MS,
    lastReplayJobId,
    replayAvailable,
    replayJobKind: replayAvailable ? "connector_reconciliation_replay" : null,
    idempotencyKey: credentialId && cursor ? `connector-replay:${credentialId}:${buildCursorRef(cursor)}` : null
  };
}

function buildRecoveryActions(params: {
  accountName: string;
  lifecycleState: GoogleCredentialLifecycleState;
  repairState: GoogleCredentialRepairState;
  missingScopes: string[];
  reconciliation: GoogleCredentialReconciliationState;
}): GoogleCredentialRecoveryAction[] {
  const actions: GoogleCredentialRecoveryAction[] = [];

  switch (params.repairState) {
    case "setup_required":
      actions.push({
        id: "connect_google",
        label: "Connect Google",
        description: `Start managed Google OAuth setup for ${params.accountName}.`,
        operatorSteps: [
          "Open the Google integration setup flow.",
          "Complete OAuth consent with the expected workspace account.",
          "Verify the connector returns to approval-grade readiness."
        ],
        operation: "open_google_connect"
      });
      break;
    case "reconnect_required":
      actions.push({
        id: "reconnect_google",
        label: "Reconnect Google",
        description: `Reconnect ${params.accountName} before provider actions resume.`,
        operatorSteps: [
          "Open the Google integration setup flow.",
          "Re-authorize the account that owns this connector.",
          "Confirm revoked, expired, or reconnect-required state is cleared."
        ],
        operation: "mark_connector_reconnect_required"
      });
      break;
    case "scope_repair_required":
      actions.push({
        id: "request_scope_upgrade",
        label: "Request scope upgrade",
        description: `Reconnect Google with missing scopes: ${params.missingScopes.join(", ")}.`,
        operatorSteps: [
          "Open the Google integration setup flow.",
          "Approve the missing scopes listed in readiness.",
          "Rerun connector verification before allowing governed execution."
        ],
        operation: "open_google_connect"
      });
      break;
    case "refresh_repair_required":
      actions.push({
        id: "reconnect_google",
        label: "Refresh credential",
        description: `Repair the refresh-token path for ${params.accountName}.`,
        operatorSteps: [
          "Reconnect the Google account to issue a new refresh token.",
          "Verify encrypted secret storage is present.",
          "Revalidate the connector after storage succeeds."
        ],
        operation: "open_google_connect"
      });
      break;
    case "validation_required":
      actions.push({
        id: "revalidate_credential",
        label: "Revalidate credential",
        description: `Refresh validation evidence for ${params.accountName}.`,
        operatorSteps: [
          "Run connector revalidation from the recovery lane.",
          "Confirm provider access still works for the required scopes.",
          "Leave autonomy gated if validation still fails."
        ],
        operation: "revalidate_connector_credential"
      });
      break;
    case "none":
    default:
      break;
  }

  if (params.reconciliation.replayAvailable) {
    actions.push({
      id: "replay_reconciliation",
      label: "Replay reconciliation",
      description: `Replay bounded Google reconciliation for ${params.accountName} from the redacted cursor reference.`,
      operatorSteps: [
        "Enqueue a connector reconciliation replay with the displayed idempotency key.",
        "Resume from the redacted cursor reference instead of a full provider rescan.",
        "Confirm the replay job id is recorded before retrying webhook or sync recovery."
      ],
      operation: "enqueue_connector_reconciliation_replay"
    });
  }

  return actions;
}

function buildSloGates(params: {
  credential?: Pick<ProviderCredential, "status" | "lastValidatedAt" | "updatedAt"> | null;
  lifecycleState: GoogleCredentialLifecycleState;
  hasRefreshToken: boolean;
  missingScopes: string[];
  now: number;
}): GoogleCredentialSloGate[] {
  const validationReferenceMs =
    parseTimestampMs(params.credential?.lastValidatedAt) ?? parseTimestampMs(params.credential?.updatedAt);
  const validationStale =
    params.credential?.status === "connected" &&
    validationReferenceMs !== null &&
    params.now - validationReferenceMs >= DEFAULT_GOOGLE_VALIDATION_FRESH_AFTER_MS;

  return [
    {
      id: "credential_lifecycle",
      label: "Credential lifecycle",
      status: params.lifecycleState === "healthy" ? "pass" : "fail",
      message:
        params.lifecycleState === "healthy"
          ? "Credential lifecycle is healthy."
          : `Credential lifecycle is ${params.lifecycleState.replace("_", " ")}.`,
      threshold: "Must be healthy for approval-grade managed execution."
    },
    {
      id: "scope_coverage",
      label: "Scope coverage",
      status: params.missingScopes.length === 0 ? "pass" : "fail",
      message:
        params.missingScopes.length === 0
          ? "Required Google scopes are present."
          : `Missing scopes: ${params.missingScopes.join(", ")}.`,
      threshold: "No required connector scopes may be missing."
    },
    {
      id: "refresh_token_presence",
      label: "Refresh token",
      status: params.hasRefreshToken ? "pass" : "fail",
      message: params.hasRefreshToken
        ? "Encrypted refresh token is present."
        : "Encrypted refresh token is missing.",
      threshold: "Managed connectors require an encrypted refresh token."
    },
    {
      id: "validation_freshness",
      label: "Validation freshness",
      status: validationStale ? "warn" : "pass",
      message: validationStale
        ? "Credential validation evidence is stale."
        : "Credential validation evidence is fresh enough.",
      threshold: "Credential validation should be refreshed at least every 7 days."
    }
  ];
}

function deriveLifecycleState(params: {
  credential?: Pick<ProviderCredential, "status" | "expiresAt"> | null;
  hasRefreshToken: boolean;
  missingScopes: string[];
  now: number;
}): GoogleCredentialLifecycleState {
  const credential = params.credential ?? null;

  if (!credential) {
    return "missing";
  }

  if (credential.status === "revoked") {
    return "revoked";
  }

  const expiresAtMs = parseTimestampMs(credential.expiresAt);

  if (expiresAtMs !== null && expiresAtMs <= params.now) {
    return "expired";
  }

  if (params.missingScopes.length > 0) {
    return "scope_mismatch";
  }

  if (credential.status !== "connected" || !params.hasRefreshToken) {
    return "degraded";
  }

  return "healthy";
}

function deriveRepairState(params: {
  lifecycleState: GoogleCredentialLifecycleState;
  credentialStatus: ProviderCredentialStatus | "missing";
  hasRefreshToken: boolean;
  validationStale: boolean;
}): GoogleCredentialRepairState {
  if (params.lifecycleState === "missing") {
    return "setup_required";
  }

  if (params.lifecycleState === "revoked" || params.lifecycleState === "expired" || params.credentialStatus === "reconnect_required") {
    return "reconnect_required";
  }

  if (params.lifecycleState === "scope_mismatch") {
    return "scope_repair_required";
  }

  if (params.credentialStatus === "refresh_failed" || !params.hasRefreshToken) {
    return "refresh_repair_required";
  }

  if (params.validationStale) {
    return "validation_required";
  }

  return "none";
}

export function isManagedGoogleIntegration(account: Pick<IntegrationAccount, "metadata">): boolean {
  return account.metadata.provider === "google" && account.metadata.managed === true;
}

export function getManagedGoogleRequiredScopes(integrationId: string): readonly string[] {
  return managedGoogleRequiredScopesByIntegration[
    integrationId as keyof typeof managedGoogleRequiredScopesByIntegration
  ] ?? [];
}

export function assessManagedGoogleCredential(params: {
  account: Pick<IntegrationAccount, "id" | "name" | "metadata">;
  credential?: Pick<
    ProviderCredential,
    "id" | "status" | "scopes" | "expiresAt" | "lastValidatedAt" | "updatedAt" | "metadata"
  > | null;
  hasRefreshTokenSecret?: boolean;
  now?: number;
}): GoogleCredentialAssessment | null {
  if (!isManagedGoogleIntegration(params.account)) {
    return null;
  }

  const now = params.now ?? Date.now();
  const requiredScopes = getManagedGoogleRequiredScopes(params.account.id);
  const credential = params.credential ?? null;
  const issues: GoogleCredentialIssue[] = [];

  if (!credential) {
    issues.push({
      code: "provider_credential_missing",
      blocking: true,
      message: `${params.account.name} is managed by Google, but no connected provider credential is available.`
    });
  }

  const credentialStatus = credential?.status ?? "missing";
  const expiresAtMs = parseTimestampMs(credential?.expiresAt);

  if (credential && credential.status === "reconnect_required") {
    issues.push({
      code: "provider_reconnect_required",
      blocking: true,
      message: `${params.account.name} requires Google re-authentication before governed execution can continue.`
    });
  }

  if (credential && credential.status === "refresh_failed") {
    issues.push({
      code: "provider_refresh_failed",
      blocking: true,
      message: `${params.account.name} last failed to refresh its Google credential and should not be treated as approval-safe.`
    });
  }

  if (credential && credential.status === "revoked") {
    issues.push({
      code: "provider_revoked",
      blocking: true,
      message: `${params.account.name} lost Google access because the provider credential was revoked.`
    });
  }

  if (credential && expiresAtMs !== null && expiresAtMs <= now) {
    issues.push({
      code: "provider_credential_expired",
      blocking: true,
      message: `${params.account.name} has an expired Google credential and requires reconnect before governed execution can continue.`
    });
  }

  if (credential && !params.hasRefreshTokenSecret) {
    issues.push({
      code: "provider_refresh_token_missing",
      blocking: true,
      message: `${params.account.name} is missing its encrypted Google refresh token, so the managed connector cannot refresh safely.`
    });
  }

  const missingScopes = credential
    ? requiredScopes.filter((scope) => !credential.scopes.includes(scope))
    : [...requiredScopes];

  if (missingScopes.length > 0) {
    issues.push({
      code: "provider_scope_missing",
      blocking: true,
      missingScopes,
      message: `${params.account.name} is missing required Google scopes: ${missingScopes.join(", ")}.`
    });
  }

  const hasRefreshToken = Boolean(credential && params.hasRefreshTokenSecret);
  const lifecycleState = deriveLifecycleState({
    credential,
    hasRefreshToken,
    missingScopes,
    now
  });
  const validationReferenceMs =
    parseTimestampMs(credential?.lastValidatedAt) ?? parseTimestampMs(credential?.updatedAt);
  const validationStale =
    credential?.status === "connected" &&
    validationReferenceMs !== null &&
    now - validationReferenceMs >= DEFAULT_GOOGLE_VALIDATION_FRESH_AFTER_MS;
  const repairState = deriveRepairState({
    lifecycleState,
    credentialStatus,
    hasRefreshToken,
    validationStale
  });
  const reconciliation = buildReconciliationState({
    providerCredentialId: credential?.id ?? extractProviderCredentialId(params.account),
    credential,
    now
  });

  return {
    provider: "google",
    providerCredentialId: credential?.id ?? extractProviderCredentialId(params.account),
    credentialStatus,
    lifecycleState,
    repairState,
    hasRefreshToken,
    missingScopes,
    issues,
    recoveryActions: buildRecoveryActions({
      accountName: params.account.name,
      lifecycleState,
      repairState,
      missingScopes,
      reconciliation
    }),
    sloGates: buildSloGates({
      credential,
      lifecycleState,
      hasRefreshToken,
      missingScopes,
      now
    }),
    reconciliation,
    ready: issues.every((issue) => !issue.blocking)
  };
}
