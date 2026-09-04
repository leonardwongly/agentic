import { getRuntimeContext, type RuntimeContext } from "@agentic/runtime-adapters";
import { nowIso, type WorkerRuntimeHealthSnapshot } from "@agentic/contracts";

const MAX_HEALTH_FILE_BYTES = 16 * 1024;

export type { WorkerRuntimeHealthSnapshot };

export type WorkerRuntimeHealthSink = {
  write(snapshot: WorkerRuntimeHealthSnapshot): Promise<void>;
};

export type WorkerRuntimeHealthUpdate = Parameters<typeof updateWorkerRuntimeHealthSnapshot>[1];

export type WorkerRuntimeHealthReporter = {
  write(updates: WorkerRuntimeHealthUpdate): void;
  flush(): Promise<void>;
  close(): void;
  getSnapshot(): WorkerRuntimeHealthSnapshot | null;
};

export function createWorkerRuntimeHealthSnapshot(params: {
  runnerId: string;
  status?: WorkerRuntimeHealthSnapshot["status"];
  startedAt?: string;
  now?: string;
}): WorkerRuntimeHealthSnapshot {
  const now = params.now ?? nowIso();

  return {
    version: 1,
    runnerId: params.runnerId,
    pid: typeof process !== "undefined" ? process.pid : 0,
    status: params.status ?? "starting",
    startedAt: params.startedAt ?? now,
    updatedAt: now,
    processedCount: 0,
    lastProcessedAt: null,
    lastErrorAt: null,
    lastErrorClass: null,
    scheduler: {
      enabled: false,
      lastRunAt: null,
      lastCompletedAt: null,
      lastDecisionCount: null,
      lastErrorAt: null,
      lastErrorClass: null
    }
  };
}

export function updateWorkerRuntimeHealthSnapshot(
  snapshot: WorkerRuntimeHealthSnapshot,
  updates: Partial<Omit<WorkerRuntimeHealthSnapshot, "version" | "runnerId" | "pid" | "startedAt" | "scheduler">> & {
    scheduler?: Partial<WorkerRuntimeHealthSnapshot["scheduler"]>;
    now?: string;
  }
): WorkerRuntimeHealthSnapshot {
  const now = updates.now ?? nowIso();
  const { now: _now, ...snapshotUpdates } = updates;

  return {
    ...snapshot,
    ...snapshotUpdates,
    version: 1,
    runnerId: snapshot.runnerId,
    pid: snapshot.pid,
    startedAt: snapshot.startedAt,
    updatedAt: now,
    scheduler: {
      ...snapshot.scheduler,
      ...(updates.scheduler ?? {})
    }
  };
}

export function createWorkerRuntimeHealthReporter(params: {
  runnerId: string;
  health?: {
    sink: WorkerRuntimeHealthSink;
    intervalMs?: number;
    schedulerEnabled?: boolean;
  };
  getProcessedCount(): number;
  onWriteError?(error: unknown): void;
}): WorkerRuntimeHealthReporter {
  const health = params.health;
  let healthSnapshot: WorkerRuntimeHealthSnapshot | null = health
    ? createWorkerRuntimeHealthSnapshot({
        runnerId: params.runnerId,
        status: "starting"
      })
    : null;
  let lastHealthWrite: Promise<void> = Promise.resolve();

  const write = (updates: WorkerRuntimeHealthUpdate) => {
    if (!health || !healthSnapshot) {
      return;
    }

    healthSnapshot = updateWorkerRuntimeHealthSnapshot(healthSnapshot, updates);
    lastHealthWrite = lastHealthWrite
      .catch(() => undefined)
      .then(() => health.sink.write(healthSnapshot as WorkerRuntimeHealthSnapshot))
      .then(() => undefined, params.onWriteError);
  };
  
  // Use globalThis.setInterval for compatibility across runtimes
  const heartbeatTimer = health
    ? globalThis.setInterval(() => {
        const processedCount = params.getProcessedCount();
        write({
          status: processedCount > 0 ? "running" : "idle",
          processedCount
        });
      }, Math.max(250, health.intervalMs ?? 5_000))
    : null;

  return {
    write,
    flush: () => lastHealthWrite,
    close() {
      if (heartbeatTimer) {
        globalThis.clearInterval(heartbeatTimer);
      }
    },
    getSnapshot: () => healthSnapshot
  };
}

/**
 * Create a file-based health sink using the runtime adapter.
 * Works in both Node.js and Cloudflare Workers environments.
 */
export function createFileWorkerRuntimeHealthSink(
  filePath: string,
  context?: RuntimeContext
): WorkerRuntimeHealthSink {
  const runtime = context ?? getRuntimeContext();
  const resolvedPath = runtime.storage.resolve(filePath);

  return {
    async write(snapshot) {
      const payload = `${JSON.stringify(snapshot)}\n`;

      // Check size limit
      const encoder = new TextEncoder();
      const encoded = encoder.encode(payload);
      if (encoded.byteLength > MAX_HEALTH_FILE_BYTES) {
        throw new Error("Worker health snapshot exceeded the bounded file size.");
      }

      await runtime.storage.writeFile(resolvedPath, payload, { mode: 0o600 });
    }
  };
}

export function createRepositoryWorkerRuntimeHealthSink(repository: {
  recordWorkerRuntimeHealth(snapshot: WorkerRuntimeHealthSnapshot): Promise<void>;
}): WorkerRuntimeHealthSink {
  return {
    async write(snapshot) {
      await repository.recordWorkerRuntimeHealth(snapshot);
    }
  };
}

function isWorkerRuntimeHealthSnapshot(value: unknown): value is WorkerRuntimeHealthSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<WorkerRuntimeHealthSnapshot>;
  return (
    candidate.version === 1 &&
    typeof candidate.runnerId === "string" &&
    typeof candidate.pid === "number" &&
    typeof candidate.status === "string" &&
    typeof candidate.startedAt === "string" &&
    typeof candidate.updatedAt === "string" &&
    typeof candidate.processedCount === "number" &&
    typeof candidate.scheduler === "object" &&
    candidate.scheduler !== null
  );
}

/**
 * Read a worker runtime health snapshot from file using the runtime adapter.
 */
export async function readFileWorkerRuntimeHealthSnapshot(
  filePath: string,
  context?: RuntimeContext
): Promise<WorkerRuntimeHealthSnapshot | null> {
  const runtime = context ?? getRuntimeContext();
  const resolvedPath = runtime.storage.resolve(filePath);
  
  try {
    const fileStat = await runtime.storage.stat(resolvedPath);

    if (fileStat.size > MAX_HEALTH_FILE_BYTES) {
      throw new Error("Worker health snapshot exceeded the bounded file size.");
    }

    const contentRaw = await runtime.storage.readFile(resolvedPath, "utf8");
    const content = contentRaw as string;
    const parsed = JSON.parse(content) as unknown;

    if (!isWorkerRuntimeHealthSnapshot(parsed)) {
      throw new Error("Worker health snapshot has an invalid shape.");
    }

    return parsed;
  } catch (error) {
    // If file doesn't exist, return null
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    // Re-throw other errors
    throw error;
  }
}
