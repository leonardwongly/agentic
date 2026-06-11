import { getCloudflareContext } from "@opennextjs/cloudflare";

type HyperdriveBinding = {
  connectionString: string;
};

type CloudflareRuntimeEnv = {
  HYPERDRIVE?: HyperdriveBinding;
} & Record<string, unknown>;

// Returns the Cloudflare Worker `env` when running on workerd, otherwise null.
// `getCloudflareContext()` throws when there is no Cloudflare request context
// (the Node.js server, the standalone worker process, `next build`, and tests),
// so callers transparently fall back to Node behavior.
export function getCloudflareEnv(): CloudflareRuntimeEnv | null {
  try {
    return getCloudflareContext().env as CloudflareRuntimeEnv;
  } catch {
    return null;
  }
}

// Resolves the Hyperdrive Postgres connection string from the HYPERDRIVE binding
// when running on Cloudflare Workers. Returns null off-Workers or when the
// binding is not configured, so the caller keeps its existing DATABASE_URL path.
export function getHyperdriveConnectionString(): string | null {
  const connectionString = getCloudflareEnv()?.HYPERDRIVE?.connectionString;
  return typeof connectionString === "string" && connectionString.length > 0 ? connectionString : null;
}

export function getRuntimeEnvValue(name: string): string | undefined {
  const cloudflareValue = getCloudflareEnv()?.[name];

  if (typeof cloudflareValue === "string" && cloudflareValue.length > 0) {
    return cloudflareValue;
  }

  const processValue = process.env[name];
  return typeof processValue === "string" && processValue.length > 0 ? processValue : undefined;
}

// Resolves the Postgres connection string for server-side consumers that read
// process.env.DATABASE_URL directly (readiness checks, shared auth runtime
// state). On Cloudflare Workers pg cannot reach the origin database directly, so
// prefer the Hyperdrive binding's connection string; otherwise fall back to
// process.env.DATABASE_URL for Node/local runtimes.
export function getServerDatabaseUrl(): string | undefined {
  const hyperdrive = getHyperdriveConnectionString();
  if (hyperdrive) {
    return hyperdrive;
  }

  const databaseUrl = getRuntimeEnvValue("DATABASE_URL")?.trim();
  return databaseUrl ? databaseUrl : undefined;
}
