import { DEFAULT_BOOTSTRAP_USER_ID } from "@agentic/contracts";

const RUNTIME_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u;

export function resolveBootstrapOwnerUserId(options?: { requireExplicit?: boolean }): string {
  const configured = process.env.AGENTIC_BOOTSTRAP_USER_ID?.trim();

  if (configured) {
    if (!RUNTIME_ID_PATTERN.test(configured)) {
      throw new Error("AGENTIC_BOOTSTRAP_USER_ID must be 1-120 characters and contain only letters, numbers, '.', '_', ':' or '-'.");
    }

    return configured;
  }

  if (options?.requireExplicit) {
    throw new Error("AGENTIC_BOOTSTRAP_USER_ID must be configured for production owner resolution.");
  }

  return DEFAULT_BOOTSTRAP_USER_ID;
}
