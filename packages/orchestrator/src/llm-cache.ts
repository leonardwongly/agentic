import crypto from "node:crypto";
import type { AgenticRepository } from "@agentic/repository";

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

export class LlmCache {
  private cache = new Map<string, CacheEntry<any>>();
  private readonly defaultTtlMs = 1000 * 60 * 60; // 1 hour
  private repository: AgenticRepository | null = null;

  private static instance: LlmCache;

  private constructor() {}

  public static getInstance(): LlmCache {
    if (!LlmCache.instance) {
      LlmCache.instance = new LlmCache();
    }
    return LlmCache.instance;
  }

  public setRepository(repository: AgenticRepository): void {
    this.repository = repository;
  }

  private generateKey(prompt: string, options: any): string {
    const hash = crypto.createHash("sha256");
    hash.update(prompt);
    hash.update(JSON.stringify(options));
    return hash.digest("hex");
  }

  public async get<T>(prompt: string, options: any): Promise<T | null> {
    const key = this.generateKey(prompt, options);

    // Check memory cache first
    const entry = this.cache.get(key);
    if (entry) {
      if (Date.now() > entry.expiresAt) {
        this.cache.delete(key);
      } else {
        return entry.value;
      }
    }

    // Check repository cache
    if (this.repository) {
      try {
        const dbEntry = await this.repository.getLlmCache(key);
        if (dbEntry) {
          const value = JSON.parse(dbEntry.value) as T;
          const expiresAt = new Date(dbEntry.expiresAt).getTime();

          if (Date.now() <= expiresAt) {
            // Backfill memory cache
            this.cache.set(key, { value, expiresAt });
            return value;
          }
        }
      } catch (error) {
        console.error("[LlmCache] Failed to get from repository", error);
      }
    }

    return null;
  }

  public async set<T>(prompt: string, options: any, value: T, ttlMs?: number): Promise<void> {
    const key = this.generateKey(prompt, options);
    const expiresAt = Date.now() + (ttlMs ?? this.defaultTtlMs);

    // Set memory cache
    this.cache.set(key, {
      value,
      expiresAt
    });

    // Set repository cache
    if (this.repository) {
      try {
        await this.repository.setLlmCache({
          key,
          value: JSON.stringify(value),
          expiresAt: new Date(expiresAt).toISOString(),
          createdAt: new Date().toISOString()
        });
      } catch (error) {
        console.error("[LlmCache] Failed to set in repository", error);
      }
    }
  }

  public clear(): void {
    this.cache.clear();
  }
}
