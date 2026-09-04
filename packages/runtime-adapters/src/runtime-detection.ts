/**
 * Runtime Detection
 * 
 * Detects the current runtime environment and returns the appropriate adapter.
 */

import type { RuntimeContext } from "./storage-adapter";
import { createNodeRuntimeContext } from "./node-fs-adapter";
import { createCloudflareRuntimeContext, type CloudflareBindings } from "./cloudflare-adapter";

// Global cache for the runtime context
let cachedContext: RuntimeContext | null = null;

/**
 * Check if running in a Cloudflare Workers environment.
 * Workers have specific globals that distinguish them from Node.js.
 */
export function isCloudflareWorkersEnvironment(): boolean {
  // Check for Workers-specific globals
  return (
    typeof globalThis !== "undefined" &&
    ("caches" in globalThis || "WebSocketPair" in globalThis || "DurableObjectState" in globalThis)
  );
}

/**
 * Check if running in a Node.js environment.
 */
export function isNodeEnvironment(): boolean {
  return (
    typeof process !== "undefined" &&
    typeof process.versions !== "undefined" &&
    typeof process.versions.node === "string"
  );
}

/**
 * Get or create the runtime context for the current environment.
 * 
 * @param cloudflareBindings - Optional Cloudflare bindings (required for Workers)
 * @returns The appropriate runtime context for the current environment
 */
export function getRuntimeContext(cloudflareBindings?: CloudflareBindings): RuntimeContext {
  // Return cached context if available and no new bindings provided
  if (cachedContext && !cloudflareBindings) {
    return cachedContext;
  }

  // Check for explicit runtime override via environment variable
  const explicitRuntime = typeof process !== "undefined" 
    ? process.env?.AGENTIC_RUNTIME?.toLowerCase()
    : undefined;

  if (explicitRuntime === "cloudflare") {
    if (!cloudflareBindings) {
      throw new Error(
        "AGENTIC_RUNTIME=cloudflare requires Cloudflare bindings to be provided"
      );
    }
    cachedContext = createCloudflareRuntimeContext(cloudflareBindings);
    return cachedContext;
  }

  if (explicitRuntime === "node") {
    cachedContext = createNodeRuntimeContext();
    return cachedContext;
  }

  // Auto-detect based on environment
  if (isCloudflareWorkersEnvironment()) {
    if (!cloudflareBindings) {
      throw new Error(
        "Running in Cloudflare Workers environment but no bindings provided. " +
        "Pass Cloudflare bindings to getRuntimeContext()."
      );
    }
    cachedContext = createCloudflareRuntimeContext(cloudflareBindings);
    return cachedContext;
  }

  // Default to Node.js
  cachedContext = createNodeRuntimeContext();
  return cachedContext;
}

/**
 * Reset the cached runtime context.
 * Useful for testing or when switching environments.
 */
export function resetRuntimeContext(): void {
  cachedContext = null;
}

/**
 * Set a custom runtime context.
 * Useful for testing with mock adapters.
 */
export function setRuntimeContext(context: RuntimeContext): void {
  cachedContext = context;
}

/**
 * Get the storage adapter for the current runtime.
 * Convenience function that delegates to getRuntimeContext().
 */
export function getStorageAdapter(cloudflareBindings?: CloudflareBindings) {
  return getRuntimeContext(cloudflareBindings).storage;
}

/**
 * Get the lock adapter for the current runtime.
 * Convenience function that delegates to getRuntimeContext().
 */
export function getLockAdapter(cloudflareBindings?: CloudflareBindings) {
  return getRuntimeContext(cloudflareBindings).locks;
}
