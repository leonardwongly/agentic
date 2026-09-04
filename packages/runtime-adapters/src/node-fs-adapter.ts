/**
 * Node.js File System Adapter
 * 
 * Implements StorageAdapter using node:fs for local development
 * and self-hosted deployments.
 */

import { mkdir, rmdir, stat, readFile as fsReadFile, writeFile as fsWriteFile, readdir as fsReaddir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { StorageAdapter, LockAdapter, RuntimeContext, FileStat, DirectoryEntry, ReadDirOptions } from "./storage-adapter";

const FILE_STORE_LOCK_STALE_MS = 60_000;
const FILE_STORE_LOCK_RETRY_MS = 25;

function isErrnoException(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code;
}

export class NodeFsStorageAdapter implements StorageAdapter {
  readonly name = "node-fs";
  readonly sep = path.sep;

  async exists(filePath: string): Promise<boolean> {
    try {
      await stat(filePath);
      return true;
    } catch (error) {
      if (isErrnoException(error, "ENOENT")) {
        return false;
      }
      throw error;
    }
  }

  async readFile(filePath: string, encoding?: "utf8"): Promise<string | Uint8Array> {
    if (encoding === "utf8") {
      return fsReadFile(filePath, "utf8");
    }
    const buffer = await fsReadFile(filePath);
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  async writeFile(filePath: string, data: string | Uint8Array, options?: { mode?: number }): Promise<void> {
    const dirPath = path.dirname(filePath);
    await mkdir(dirPath, { recursive: true });
    
    // Atomic write: write to temp file then rename
    const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fsWriteFile(tempPath, data, { mode: options?.mode ?? 0o644 });
    await rename(tempPath, filePath);
  }

  async mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    await mkdir(dirPath, { recursive: options?.recursive ?? false });
  }

  async rmdir(dirPath: string, _options?: { recursive?: boolean }): Promise<void> {
    // Note: recursive rmdir is deprecated in favor of rm in newer Node versions
    // For now, we just remove empty directories
    await rmdir(dirPath);
  }

  async stat(filePath: string): Promise<FileStat> {
    const stats = await stat(filePath);
    return {
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      birthtimeMs: stats.birthtimeMs,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory()
    };
  }

  async readdir(dirPath: string, options?: ReadDirOptions): Promise<string[] | DirectoryEntry[]> {
    if (options?.withFileTypes) {
      const entries = await fsReaddir(dirPath, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        isFile: entry.isFile(),
        isDirectory: entry.isDirectory()
      }));
    }
    return fsReaddir(dirPath);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await rename(oldPath, newPath);
  }

  async unlink(filePath: string): Promise<void> {
    await unlink(filePath);
  }

  resolve(...paths: string[]): string {
    return path.resolve(...paths);
  }

  join(...paths: string[]): string {
    return path.join(...paths);
  }

  relative(from: string, to: string): string {
    return path.relative(from, to);
  }

  dirname(filePath: string): string {
    return path.dirname(filePath);
  }

  basename(filePath: string, ext?: string): string {
    return path.basename(filePath, ext);
  }

  isAbsolute(filePath: string): boolean {
    return path.isAbsolute(filePath);
  }
}

export class NodeFsLockAdapter implements LockAdapter {
  private storage: NodeFsStorageAdapter;

  constructor(storage: NodeFsStorageAdapter) {
    this.storage = storage;
  }

  async acquire(lockId: string, options?: { staleMs?: number }): Promise<() => Promise<void>> {
    const lockPath = `${lockId}.lock`;
    const staleMs = options?.staleMs ?? FILE_STORE_LOCK_STALE_MS;

    // Ensure parent directory exists
    await this.storage.mkdir(this.storage.dirname(lockPath), { recursive: true });

    for (;;) {
      try {
        await this.storage.mkdir(lockPath);
        return async () => {
          await this.storage.rmdir(lockPath).catch(() => {});
        };
      } catch (error) {
        if (!isErrnoException(error, "EEXIST")) {
          throw error;
        }

        // Try to remove stale lock
        if (await this.tryRemoveStaleLock(lockPath, staleMs)) {
          continue;
        }

        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, FILE_STORE_LOCK_RETRY_MS));
      }
    }
  }

  private async tryRemoveStaleLock(lockPath: string, staleMs: number): Promise<boolean> {
    try {
      const lockStat = await this.storage.stat(lockPath);
      const now = Date.now();

      if (now - lockStat.mtimeMs < staleMs) {
        return false;
      }

      await this.storage.rmdir(lockPath);
      return true;
    } catch (error) {
      if (isErrnoException(error, "ENOENT")) {
        return true;
      }
      return false;
    }
  }
}

/**
 * Create a Node.js runtime context with file system adapters.
 */
export function createNodeRuntimeContext(): RuntimeContext {
  const storage = new NodeFsStorageAdapter();
  const locks = new NodeFsLockAdapter(storage);

  return {
    storage,
    locks,
    isEdgeRuntime: false,
    env: process.env as Record<string, string | undefined>,
    cwd: () => process.cwd(),
    pid: process.pid,
    randomUUID: () => crypto.randomUUID(),
    now: () => Date.now()
  };
}
