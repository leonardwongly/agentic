/**
 * Storage Adapter Interface
 * 
 * Abstracts file system operations to support multiple runtime environments:
 * - Node.js: Uses node:fs for local development and self-hosted deployments
 * - Cloudflare Workers: Uses R2/KV for edge deployments
 * 
 * This interface provides a unified API for file operations that can be
 * implemented by different storage backends.
 */

export type FileStat = {
  size: number;
  mtimeMs: number;
  birthtimeMs: number;
  isFile: boolean;
  isDirectory: boolean;
};

export type DirectoryEntry = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
};

export type ReadDirOptions = {
  withFileTypes?: boolean;
};

/**
 * Core storage adapter interface for file system operations.
 * Implementations must handle environment-specific storage mechanisms.
 */
export interface StorageAdapter {
  /** Unique identifier for this adapter (e.g., "node-fs", "cloudflare-r2") */
  readonly name: string;

  /** Check if a file or directory exists */
  exists(path: string): Promise<boolean>;

  /** Read file contents - returns string if encoding specified, Uint8Array otherwise */
  readFile(path: string, encoding?: "utf8"): Promise<string | Uint8Array>;

  /** Write file contents atomically (write to temp, then rename) */
  writeFile(path: string, data: string | Uint8Array, options?: { mode?: number }): Promise<void>;

  /** Create directory recursively */
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;

  /** Remove directory (must be empty unless recursive) */
  rmdir(path: string, options?: { recursive?: boolean }): Promise<void>;

  /** Get file/directory statistics */
  stat(path: string): Promise<FileStat>;

  /** List directory contents */
  readdir(path: string, options?: ReadDirOptions): Promise<string[] | DirectoryEntry[]>;

  /** Rename/move file or directory */
  rename(oldPath: string, newPath: string): Promise<void>;

  /** Delete file */
  unlink(path: string): Promise<void>;

  /** Resolve path to absolute form */
  resolve(...paths: string[]): string;

  /** Join path segments */
  join(...paths: string[]): string;

  /** Get relative path from one location to another */
  relative(from: string, to: string): string;

  /** Get directory name from path */
  dirname(path: string): string;

  /** Get base name from path */
  basename(path: string, ext?: string): string;

  /** Check if path is absolute */
  isAbsolute(path: string): boolean;

  /** Get path separator for current platform */
  readonly sep: string;
}

/**
 * Lock adapter interface for distributed locking.
 * Different runtimes may use different locking mechanisms.
 */
export interface LockAdapter {
  /** Acquire a lock, returns release function */
  acquire(lockId: string, options?: { staleMs?: number }): Promise<() => Promise<void>>;
}

/**
 * Runtime context providing access to environment-specific capabilities.
 */
export interface RuntimeContext {
  /** Storage adapter for file operations */
  storage: StorageAdapter;

  /** Lock adapter for distributed coordination */
  locks: LockAdapter;

  /** Whether running in a Workers-like environment (no persistent filesystem) */
  isEdgeRuntime: boolean;

  /** Environment variables accessor */
  env: Record<string, string | undefined>;

  /** Current working directory (may be synthetic in edge runtimes) */
  cwd(): string;

  /** Process ID (may be synthetic in edge runtimes) */
  pid: number;

  /** Generate unique identifier */
  randomUUID(): string;

  /** Get current timestamp in milliseconds */
  now(): number;
}
