function isTrue(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

export function shouldUseSharedAuthState(): boolean {
  if (!process.env.DATABASE_URL?.trim()) {
    return false;
  }

  if (isTrue(process.env.AGENTIC_SHARED_AUTH_STATE)) {
    return true;
  }

  return process.env.NODE_ENV === "production";
}
