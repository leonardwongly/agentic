import crypto from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
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
    pid: process.pid,
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
  const heartbeatTimer = health
    ? setInterval(() => {
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
        clearInterval(heartbeatTimer);
      }
    },
    getSnapshot: () => healthSnapshot
  };
}

export function createFileWorkerRuntimeHealthSink(filePath: string): WorkerRuntimeHealthSink {
  const resolvedPath = path.resolve(filePath);

  return {
    async write(snapshot) {
      const payload = `${JSON.stringify(snapshot)}\n`;

      if (Buffer.byteLength(payload, "utf8") > MAX_HEALTH_FILE_BYTES) {
        throw new Error("Worker health snapshot exceeded the bounded file size.");
      }

      await mkdir(path.dirname(resolvedPath), { recursive: true });
      const tempPath = `${resolvedPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
      await writeFile(tempPath, payload, { mode: 0o600 });
      await rename(tempPath, resolvedPath);
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

export async function readFileWorkerRuntimeHealthSnapshot(filePath: string): Promise<WorkerRuntimeHealthSnapshot | null> {
  const resolvedPath = path.resolve(filePath);
  const fileStat = await stat(resolvedPath);

  if (fileStat.size > MAX_HEALTH_FILE_BYTES) {
    throw new Error("Worker health snapshot exceeded the bounded file size.");
  }

  const parsed = JSON.parse(await readFile(resolvedPath, "utf8")) as unknown;

  if (!isWorkerRuntimeHealthSnapshot(parsed)) {
    throw new Error("Worker health snapshot has an invalid shape.");
  }

  return parsed;
}
