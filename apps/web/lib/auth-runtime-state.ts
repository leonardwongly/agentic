import { getAuthSessionStateStore } from "./auth-session-store";
import { getSessionUnlockStateStore } from "./session-unlock-store";

export type AuthRuntimeStateStatus = {
  production: boolean;
  requiresSharedState: boolean;
  sessionStateScope: "process-local" | "shared";
  unlockStateScope: "process-local" | "shared";
  sharedStateConfigured: boolean;
  allowsProcessLocalStateException: boolean;
  warnings: string[];
};

let warnedAboutProcessLocalAuthState = false;

export class AuthRuntimeStateConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthRuntimeStateConfigurationError";
  }
}

function buildWarnings(status: Omit<AuthRuntimeStateStatus, "warnings">): string[] {
  const warnings: string[] = [];

  if (status.sessionStateScope === "process-local") {
    warnings.push("Session revocation and rate limiting are still process-local.");
  }

  if (status.unlockStateScope === "process-local") {
    warnings.push("Session unlock throttling is still process-local.");
  }

  return warnings;
}

function allowsProcessLocalStateException(): boolean {
  return process.env.AGENTIC_ALLOW_PROCESS_LOCAL_AUTH_STATE?.trim().toLowerCase() === "true";
}

export function getAuthRuntimeStateStatus(): AuthRuntimeStateStatus {
  const production = process.env.NODE_ENV === "production";
  const processLocalException = allowsProcessLocalStateException();
  const requiresSharedState = production
    ? !processLocalException
    : process.env.AGENTIC_REQUIRE_SHARED_AUTH_STATE === "true";
  const sessionStateScope = getAuthSessionStateStore().scope;
  const unlockStateScope = getSessionUnlockStateStore().scope;
  const sharedStateConfigured = sessionStateScope === "shared" && unlockStateScope === "shared";

  return {
    production,
    requiresSharedState,
    sessionStateScope,
    unlockStateScope,
    sharedStateConfigured,
    allowsProcessLocalStateException: processLocalException,
    warnings: buildWarnings({
      production,
      requiresSharedState,
      sessionStateScope,
      unlockStateScope,
      sharedStateConfigured,
      allowsProcessLocalStateException: processLocalException
    })
  };
}

function buildProductionGuidanceMessage(status: AuthRuntimeStateStatus): string {
  return [
    "Shared auth state is not configured for production.",
    ...status.warnings,
    "Configure shared stores for auth session state and session unlock throttling,",
    "or set AGENTIC_ALLOW_PROCESS_LOCAL_AUTH_STATE=true only for audited single-instance deployments."
  ].join(" ");
}

export function validateAuthRuntimeState(): AuthRuntimeStateStatus {
  const status = getAuthRuntimeStateStatus();

  if (!status.production || status.sharedStateConfigured) {
    return status;
  }

  const guidance = buildProductionGuidanceMessage(status);

  if (status.requiresSharedState) {
    throw new AuthRuntimeStateConfigurationError(guidance);
  }

  if (!warnedAboutProcessLocalAuthState) {
    console.warn(`[agentic] ${guidance}`);
    warnedAboutProcessLocalAuthState = true;
  }

  return status;
}

export function resetAuthRuntimeStateWarningsForTesting(): void {
  warnedAboutProcessLocalAuthState = false;
}
