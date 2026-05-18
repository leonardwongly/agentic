import type { JobKind, JobRecord } from "@agentic/contracts";
import { recordCounter } from "@agentic/integrations";

export type WorkerRuntimeImmuneSystemControls = {
  enabled: boolean;
  maxConsecutiveFailures: number;
  coolDownMs: number;
};

export type WorkerRuntimeImmuneSystem = {
  getAllowedKinds(requestedKinds: readonly JobKind[]): JobKind[] | null;
  recordJobOutcome(kind: JobKind, status: JobRecord["status"]): void;
};

export function createWorkerRuntimeImmuneSystem(params: {
  runnerId: string;
  controls?: Partial<WorkerRuntimeImmuneSystemControls>;
}): WorkerRuntimeImmuneSystem {
  const controls: WorkerRuntimeImmuneSystemControls = {
    enabled: true,
    maxConsecutiveFailures: 6,
    coolDownMs: 30_000,
    ...(params.controls ?? {})
  };
  const breaker = new Map<JobKind, { consecutiveFailures: number; openUntilMs: number | null }>();

  return {
    getAllowedKinds(requestedKinds) {
      if (!controls.enabled) {
        return requestedKinds.slice();
      }

      const nowMs = Date.now();
      const allowed = requestedKinds.filter((kind) => {
        const entry = breaker.get(kind);
        return !entry?.openUntilMs || entry.openUntilMs <= nowMs;
      });

      return allowed.length > 0 ? allowed : null;
    },
    recordJobOutcome(kind, status) {
      if (!controls.enabled) {
        return;
      }

      const existing = breaker.get(kind) ?? { consecutiveFailures: 0, openUntilMs: null };

      if (status === "completed") {
        if (existing.consecutiveFailures > 0 || existing.openUntilMs) {
          breaker.set(kind, { consecutiveFailures: 0, openUntilMs: null });
        }
        return;
      }

      const nextFailures = existing.consecutiveFailures + 1;

      if (nextFailures >= controls.maxConsecutiveFailures) {
        breaker.set(kind, { consecutiveFailures: 0, openUntilMs: Date.now() + controls.coolDownMs });
        recordCounter("worker.immunity.circuit_breaker.opened.total", 1, {
          runnerId: params.runnerId,
          jobKind: kind
        });
        return;
      }

      breaker.set(kind, { consecutiveFailures: nextFailures, openUntilMs: null });
    }
  };
}
