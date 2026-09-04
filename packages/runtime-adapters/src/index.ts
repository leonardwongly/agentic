/**
 * @agentic/runtime-adapters
 * 
 * Runtime abstraction layer for file system and storage operations.
 * Supports Node.js (local/self-hosted) and Cloudflare Workers (edge) environments.
 */

// Core interfaces
export type {
  StorageAdapter,
  LockAdapter,
  RuntimeContext,
  FileStat,
  DirectoryEntry,
  ReadDirOptions
} from "./storage-adapter";

// Node.js implementation
export {
  NodeFsStorageAdapter,
  NodeFsLockAdapter,
  createNodeRuntimeContext
} from "./node-fs-adapter";

// Cloudflare implementation
export {
  CloudflareStorageAdapter,
  CloudflareLockAdapter,
  createCloudflareRuntimeContext,
  type CloudflareBindings
} from "./cloudflare-adapter";

// Runtime detection and context management
export {
  getRuntimeContext,
  getStorageAdapter,
  getLockAdapter,
  resetRuntimeContext,
  setRuntimeContext,
  isCloudflareWorkersEnvironment,
  isNodeEnvironment
} from "./runtime-detection";
