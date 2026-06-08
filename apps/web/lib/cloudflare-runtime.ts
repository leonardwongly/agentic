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
