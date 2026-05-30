export const STALLED_WORKFLOW_MS = 30 * 60 * 1000;
export const APPROVAL_WAIT_SLA_MS = 6 * 60 * 60 * 1000;
export const DASHBOARD_GOAL_LIMIT = 40;
export const DASHBOARD_AUTOPILOT_EVENT_LIMIT = 24;
export const DASHBOARD_MEMORY_LIMIT = 40;
export const DASHBOARD_INTEGRATION_LIMIT = 24;
export const SHARED_APPROVAL_OWNER_MESSAGE = "Only the workspace owner can respond to shared approvals.";

const RUNTIME_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u;

export function resolveBootstrapOwnerUserId(fallbackUserId: string): string {
  const configured = process.env.AGENTIC_BOOTSTRAP_USER_ID?.trim();

  if (!configured) {
    return fallbackUserId;
  }

  if (!RUNTIME_ID_PATTERN.test(configured)) {
    throw new Error("AGENTIC_BOOTSTRAP_USER_ID must be 1-120 characters and contain only letters, numbers, '.', '_', ':' or '-'.");
  }

  return configured;
}

export function resolveBootstrapDisplayName(): string {
  return process.env.AGENTIC_BOOTSTRAP_DISPLAY_NAME?.trim() || "Instance Owner";
}

export function resolveDefaultTimezone(): string {
  return process.env.AGENTIC_DEFAULT_TIMEZONE?.trim() || process.env.TZ?.trim() || "UTC";
}
