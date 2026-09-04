import { getRuntimeContext, type RuntimeContext } from "@agentic/runtime-adapters";

const FILE_STORE_LOCK_STALE_MS = 60_000;

/**
 * Acquire a file store lock using the runtime-appropriate lock adapter.
 * 
 * In Node.js environments, uses filesystem-based directory locks.
 * In Cloudflare Workers, uses KV-based distributed locks.
 * 
 * @param storePath - The path/identifier for the lock
 * @param context - Optional runtime context (auto-detected if not provided)
 * @returns A release function that must be called when done
 */
export async function acquireFileStoreLock(
  storePath: string,
  context?: RuntimeContext
): Promise<() => Promise<void>> {
  const runtime = context ?? getRuntimeContext();
  return runtime.locks.acquire(storePath, { staleMs: FILE_STORE_LOCK_STALE_MS });
}
