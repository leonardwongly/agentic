import type { SelfImprovementRepository } from "@agentic/self-improvement-memory";

// The self-improvement (learned-execution) memory is file-backed (node:fs) and
// cannot run on Cloudflare Workers, which have no persistent filesystem. On
// Workers we substitute this no-op repository so routes that read/write learned
// memory keep functioning — learned memory simply is not persisted in this
// runtime (reads return empty, writes are accepted but discarded).
//
// Persisting learned-execution memory on Workers would require a Postgres (or
// KV/D1/R2) backend; tracked as a follow-up to F4 (#979).
export function createNoopSelfImprovementRepository(): SelfImprovementRepository {
  return {
    baseDir: "(unavailable on cloudflare workers)",
    seed: async () => {},
    readSemanticPatterns: async () => ({ version: 1, patterns: {} }),
    getSemanticPattern: async () => null,
    upsertSemanticPattern: async (pattern) => pattern,
    appendEpisode: async (episode) => episode,
    getEpisode: async () => null,
    listEpisodes: async () => [],
    exportLearningEpisodes: async () => [],
    deleteLearningEpisodes: async (params) => ({
      userId: params.userId,
      workspaceId: params.workspaceId ?? null,
      evaluatedAt: params.now ?? new Date().toISOString(),
      deletedEpisodeCount: 0
    }),
    enforceLearningRetention: async (params) => ({
      userId: params.userId,
      workspaceId: params.workspaceId ?? null,
      evaluatedAt: params.now ?? new Date().toISOString(),
      deletedEpisodeCount: 0
    }),
    readWorkingMemory: async () => ({ currentSession: null, lastError: null, sessionEnd: null }),
    writeCurrentSession: async (session) => session,
    writeLastError: async (error) => error,
    writeSessionEnd: async (snapshot) => snapshot,
    clearWorkingMemory: async () => {}
  };
}
