const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1", ""]);

function isLocalDatabaseHost(databaseUrl: string): boolean {
  try {
    return LOCAL_DATABASE_HOSTS.has(new URL(databaseUrl).hostname);
  } catch {
    // An unparseable connection string is refused by the driver anyway; do not block on it here.
    return true;
  }
}

export function resolveRepositoryDatabaseUrl(options?: {
  storePath?: string;
  databaseUrl?: string;
}): string | undefined {
  // Explicit file-backed test stores must win over an ambient DATABASE_URL so
  // unrelated Postgres-backed suites do not leak pools and state into file mode.
  const explicitDatabaseUrl = options?.databaseUrl;
  const ambientDatabaseUrl = options?.storePath === undefined ? process.env.DATABASE_URL : undefined;

  // A non-production runtime silently picking up an ambient remote Postgres URL is how live
  // production databases get written during local development (e.g. a `next dev` server auto-
  // loading a .env.local that holds a live URL). Refuse non-localhost ambient URLs outside
  // production unless the operator explicitly opts in; explicitly-passed URLs (tests, the parity
  // suite, Cloudflare bindings) are never touched.
  if (explicitDatabaseUrl === undefined && ambientDatabaseUrl && process.env.NODE_ENV !== "production") {
    if (!isLocalDatabaseHost(ambientDatabaseUrl) && process.env.AGENTIC_ALLOW_REMOTE_DEV_DATABASE_URL !== "true") {
      throw new Error(
        "DATABASE_URL points to a remote (non-localhost) database while NODE_ENV is not production. " +
          "Refusing to connect so a live production database cannot be modified from local development. " +
          "Remove the variable, point it at a local Postgres, or set AGENTIC_ALLOW_REMOTE_DEV_DATABASE_URL=true to opt in."
      );
    }
  }

  return explicitDatabaseUrl ?? ambientDatabaseUrl;
}
