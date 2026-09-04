/**
 * Cloudflare Workers Storage Adapter
 * 
 * Implements StorageAdapter using R2 and KV for edge deployments.
 * This is a stub implementation that will be completed when
 * Cloudflare bindings are available in the runtime.
 * 
 * Note: This adapter requires Cloudflare Workers bindings to be
 * injected at runtime. It cannot function in Node.js environments.
 */

import type { StorageAdapter, LockAdapter, RuntimeContext, FileStat, DirectoryEntry, ReadDirOptions } from "./storage-adapter";

// Type definitions for Cloudflare Workers bindings
// These will be provided by the Workers runtime
type R2Bucket = {
  get(key: string): Promise<R2Object | null>;
  put(key: string, value: ReadableStream | ArrayBuffer | string, options?: R2PutOptions): Promise<R2Object>;
  delete(key: string): Promise<void>;
  list(options?: R2ListOptions): Promise<R2Objects>;
};

type R2Object = {
  key: string;
  size: number;
  etag: string;
  uploaded: Date;
  body: ReadableStream;
  bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T>(): Promise<T>;
};

type R2PutOptions = {
  httpMetadata?: Record<string, string>;
  customMetadata?: Record<string, string>;
};

type R2ListOptions = {
  prefix?: string;
  limit?: number;
  cursor?: string;
};

type R2Objects = {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
};

type KVNamespace = {
  get(key: string, options?: { type?: "text" }): Promise<string | null>;
  get(key: string, options: { type: "arrayBuffer" }): Promise<ArrayBuffer | null>;
  get(key: string, options: { type: "json" }): Promise<unknown | null>;
  put(key: string, value: string | ArrayBuffer | ReadableStream, options?: KVPutOptions): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: KVListOptions): Promise<KVListResult>;
};

type KVPutOptions = {
  expiration?: number;
  expirationTtl?: number;
  metadata?: Record<string, unknown>;
};

type KVListOptions = {
  prefix?: string;
  limit?: number;
  cursor?: string;
};

type KVListResult = {
  keys: Array<{ name: string; expiration?: number; metadata?: unknown }>;
  list_complete: boolean;
  cursor?: string;
};

export interface CloudflareBindings {
  STORAGE_BUCKET?: R2Bucket;
  LOCKS_KV?: KVNamespace;
  DATA_KV?: KVNamespace;
}

const CLOUDFLARE_PATH_SEPARATOR = "/";

/**
 * Normalize path for R2/KV storage (always use forward slashes)
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * Join paths for R2/KV storage
 */
function joinPaths(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join("/"));
}

/**
 * Get directory name from path
 */
function dirnamePath(p: string): string {
  const normalized = normalizePath(p);
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash === -1) return "";
  return normalized.slice(0, lastSlash);
}

/**
 * Get base name from path
 */
function basenamePath(p: string, ext?: string): string {
  const normalized = normalizePath(p);
  const lastSlash = normalized.lastIndexOf("/");
  const name = lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
  if (ext && name.endsWith(ext)) {
    return name.slice(0, -ext.length);
  }
  return name;
}

/**
 * Check if path is absolute (for Cloudflare, all paths are relative to bucket root)
 */
function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || p.includes(":");
}

/**
 * Get relative path
 */
function relativePath(from: string, to: string): string {
  const fromParts = normalizePath(from).split("/").filter(Boolean);
  const toParts = normalizePath(to).split("/").filter(Boolean);
  
  let commonLength = 0;
  while (commonLength < fromParts.length && commonLength < toParts.length && fromParts[commonLength] === toParts[commonLength]) {
    commonLength++;
  }
  
  const upCount = fromParts.length - commonLength;
  const ups = Array(upCount).fill("..");
  const remaining = toParts.slice(commonLength);
  
  return [...ups, ...remaining].join("/") || ".";
}

export class CloudflareStorageAdapter implements StorageAdapter {
  readonly name = "cloudflare-r2-kv";
  readonly sep = CLOUDFLARE_PATH_SEPARATOR;

  private bindings: CloudflareBindings;
  private basePath: string;

  constructor(bindings: CloudflareBindings, basePath = "") {
    this.bindings = bindings;
    this.basePath = normalizePath(basePath);
  }

  private getKey(p: string): string {
    const normalized = normalizePath(p);
    return this.basePath ? joinPaths(this.basePath, normalized) : normalized;
  }

  async exists(filePath: string): Promise<boolean> {
    const key = this.getKey(filePath);
    
    // Try R2 first
    if (this.bindings.STORAGE_BUCKET) {
      const object = await this.bindings.STORAGE_BUCKET.get(key);
      if (object) return true;
    }
    
    // Fall back to KV
    if (this.bindings.DATA_KV) {
      const value = await this.bindings.DATA_KV.get(key);
      return value !== null;
    }
    
    return false;
  }

  async readFile(filePath: string, encoding?: "utf8"): Promise<string | Uint8Array> {
    const key = this.getKey(filePath);
    
    // Try R2 first
    if (this.bindings.STORAGE_BUCKET) {
      const object = await this.bindings.STORAGE_BUCKET.get(key);
      if (object) {
        if (encoding === "utf8") {
          return object.text();
        }
        const buffer = await object.arrayBuffer();
        return new Uint8Array(buffer);
      }
    }
    
    // Fall back to KV
    if (this.bindings.DATA_KV) {
      if (encoding === "utf8") {
        const value = await this.bindings.DATA_KV.get(key, { type: "text" });
        if (value !== null) return value;
      } else {
        const value = await this.bindings.DATA_KV.get(key, { type: "arrayBuffer" });
        if (value !== null) return new Uint8Array(value);
      }
    }
    
    throw new Error(`File not found: ${filePath}`);
  }

  async writeFile(filePath: string, data: string | Uint8Array, _options?: { mode?: number }): Promise<void> {
    const key = this.getKey(filePath);
    
    // Use R2 if available
    if (this.bindings.STORAGE_BUCKET) {
      const putData = data instanceof Uint8Array ? data.buffer as ArrayBuffer : data;
      await this.bindings.STORAGE_BUCKET.put(key, putData);
      return;
    }
    
    // Fall back to KV
    if (this.bindings.DATA_KV) {
      await this.bindings.DATA_KV.put(key, data instanceof Uint8Array ? String.fromCharCode(...data) : data);
      return;
    }
    
    throw new Error("No storage backend configured");
  }

  async mkdir(_dirPath: string, _options?: { recursive?: boolean }): Promise<void> {
    // R2 and KV don't have directories - they're flat key-value stores
    // This is a no-op but we track directory markers if needed
  }

  async rmdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    const key = this.getKey(dirPath);
    
    if (options?.recursive) {
      // List and delete all objects with this prefix
      if (this.bindings.STORAGE_BUCKET) {
        const listed = await this.bindings.STORAGE_BUCKET.list({ prefix: key + "/" });
        for (const object of listed.objects) {
          await this.bindings.STORAGE_BUCKET.delete(object.key);
        }
      }
      
      if (this.bindings.DATA_KV) {
        const listed = await this.bindings.DATA_KV.list({ prefix: key + "/" });
        for (const k of listed.keys) {
          await this.bindings.DATA_KV.delete(k.name);
        }
      }
    }
    
    // Delete the directory marker if it exists
    if (this.bindings.STORAGE_BUCKET) {
      await this.bindings.STORAGE_BUCKET.delete(key);
    }
    if (this.bindings.DATA_KV) {
      await this.bindings.DATA_KV.delete(key);
    }
  }

  async stat(filePath: string): Promise<FileStat> {
    const key = this.getKey(filePath);
    
    // Try R2 first
    if (this.bindings.STORAGE_BUCKET) {
      const object = await this.bindings.STORAGE_BUCKET.get(key);
      if (object) {
        return {
          size: object.size,
          mtimeMs: object.uploaded.getTime(),
          birthtimeMs: object.uploaded.getTime(),
          isFile: true,
          isDirectory: false
        };
      }
      
      // Check if it's a directory prefix
      const listed = await this.bindings.STORAGE_BUCKET.list({ prefix: key + "/", limit: 1 });
      if (listed.objects.length > 0) {
        return {
          size: 0,
          mtimeMs: Date.now(),
          birthtimeMs: Date.now(),
          isFile: false,
          isDirectory: true
        };
      }
    }
    
    // Fall back to KV
    if (this.bindings.DATA_KV) {
      const value = await this.bindings.DATA_KV.get(key);
      if (value !== null) {
        return {
          size: value.length,
          mtimeMs: Date.now(),
          birthtimeMs: Date.now(),
          isFile: true,
          isDirectory: false
        };
      }
    }
    
    throw new Error(`File not found: ${filePath}`);
  }

  async readdir(dirPath: string, options?: ReadDirOptions): Promise<string[] | DirectoryEntry[]> {
    const key = this.getKey(dirPath);
    const prefix = key ? key + "/" : "";
    const entries: Map<string, DirectoryEntry> = new Map();
    
    // Collect from R2
    if (this.bindings.STORAGE_BUCKET) {
      const listed = await this.bindings.STORAGE_BUCKET.list({ prefix });
      for (const object of listed.objects) {
        const relativeKey = object.key.slice(prefix.length);
        const firstSlash = relativeKey.indexOf("/");
        
        if (firstSlash === -1) {
          // Direct file
          entries.set(relativeKey, {
            name: relativeKey,
            isFile: true,
            isDirectory: false
          });
        } else {
          // Subdirectory
          const dirName = relativeKey.slice(0, firstSlash);
          if (!entries.has(dirName)) {
            entries.set(dirName, {
              name: dirName,
              isFile: false,
              isDirectory: true
            });
          }
        }
      }
    }
    
    // Collect from KV
    if (this.bindings.DATA_KV) {
      const listed = await this.bindings.DATA_KV.list({ prefix });
      for (const k of listed.keys) {
        const relativeKey = k.name.slice(prefix.length);
        const firstSlash = relativeKey.indexOf("/");
        
        if (firstSlash === -1) {
          entries.set(relativeKey, {
            name: relativeKey,
            isFile: true,
            isDirectory: false
          });
        } else {
          const dirName = relativeKey.slice(0, firstSlash);
          if (!entries.has(dirName)) {
            entries.set(dirName, {
              name: dirName,
              isFile: false,
              isDirectory: true
            });
          }
        }
      }
    }
    
    const result = Array.from(entries.values());
    
    if (options?.withFileTypes) {
      return result;
    }
    
    return result.map((entry) => entry.name);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    // R2/KV don't support atomic rename - copy then delete
    const content = await this.readFile(oldPath);
    await this.writeFile(newPath, content);
    await this.unlink(oldPath);
  }

  async unlink(filePath: string): Promise<void> {
    const key = this.getKey(filePath);
    
    if (this.bindings.STORAGE_BUCKET) {
      await this.bindings.STORAGE_BUCKET.delete(key);
    }
    
    if (this.bindings.DATA_KV) {
      await this.bindings.DATA_KV.delete(key);
    }
  }

  resolve(...paths: string[]): string {
    // In Cloudflare, we treat everything as relative to bucket root
    let resolved = "";
    for (const p of paths) {
      if (isAbsolutePath(p)) {
        resolved = normalizePath(p);
      } else {
        resolved = joinPaths(resolved, p);
      }
    }
    return resolved || "/";
  }

  join(...paths: string[]): string {
    return joinPaths(...paths);
  }

  relative(from: string, to: string): string {
    return relativePath(from, to);
  }

  dirname(filePath: string): string {
    return dirnamePath(filePath);
  }

  basename(filePath: string, ext?: string): string {
    return basenamePath(filePath, ext);
  }

  isAbsolute(filePath: string): boolean {
    return isAbsolutePath(filePath);
  }
}

export class CloudflareLockAdapter implements LockAdapter {
  private kv: KVNamespace | undefined;
  private staleMs: number;

  constructor(kv: KVNamespace | undefined, staleMs = 60_000) {
    this.kv = kv;
    this.staleMs = staleMs;
  }

  async acquire(lockId: string, options?: { staleMs?: number }): Promise<() => Promise<void>> {
    if (!this.kv) {
      // No lock backend - return no-op release
      console.warn("CloudflareLockAdapter: No KV namespace configured for locks");
      return async () => {};
    }

    const staleMs = options?.staleMs ?? this.staleMs;
    const lockKey = `locks:${lockId}`;
    
    for (;;) {
      const existing = await this.kv.get(lockKey, { type: "json" }) as { timestamp: number; holder: string } | null;
      
      if (!existing) {
        // Try to acquire
        const holder = crypto.randomUUID();
        await this.kv.put(lockKey, JSON.stringify({ timestamp: Date.now(), holder }), {
          expirationTtl: Math.ceil(staleMs / 1000)
        });
        
        // Verify we got it (optimistic locking)
        const verify = await this.kv.get(lockKey, { type: "json" }) as { timestamp: number; holder: string } | null;
        if (verify?.holder === holder) {
          return async () => {
            await this.kv!.delete(lockKey);
          };
        }
      } else if (Date.now() - existing.timestamp > staleMs) {
        // Stale lock - try to take over
        const holder = crypto.randomUUID();
        await this.kv.put(lockKey, JSON.stringify({ timestamp: Date.now(), holder }), {
          expirationTtl: Math.ceil(staleMs / 1000)
        });
        
        const verify = await this.kv.get(lockKey, { type: "json" }) as { timestamp: number; holder: string } | null;
        if (verify?.holder === holder) {
          return async () => {
            await this.kv!.delete(lockKey);
          };
        }
      }
      
      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

/**
 * Create a Cloudflare runtime context with R2/KV adapters.
 */
export function createCloudflareRuntimeContext(bindings: CloudflareBindings): RuntimeContext {
  const storage = new CloudflareStorageAdapter(bindings);
  const locks = new CloudflareLockAdapter(bindings.LOCKS_KV);

  return {
    storage,
    locks,
    isEdgeRuntime: true,
    env: {}, // Will be populated from Workers env
    cwd: () => "/",
    pid: 0, // Synthetic PID for edge runtime
    randomUUID: () => crypto.randomUUID(),
    now: () => Date.now()
  };
}
