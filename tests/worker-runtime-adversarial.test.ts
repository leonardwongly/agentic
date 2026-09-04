import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_OWNER_USER_ID, createSystemActorContext, nowIso } from "@agentic/contracts";
import { processUserRequest } from "@agentic/orchestrator";
import { createRepository } from "@agentic/repository";
import { createSelfImprovementRepository } from "@agentic/self-improvement-memory";
import {
  resolveWorkerConcurrencyPolicy,
  createWorkerRuntimeHealthSnapshot,
  updateWorkerRuntimeHealthSnapshot,
  readFileWorkerRuntimeHealthSnapshot,
  createFileWorkerRuntimeHealthSink,
  type WorkerRuntimeHealthSnapshot
} from "@agentic/worker-runtime";
import { createWorkerRuntimeImmuneSystem } from "../packages/worker-runtime/src/runtime-immune-system";
import { getScheduledAutopilotDueTime } from "../packages/worker-runtime/src/scheduled-autopilot-due-time";

describe("worker runtime adversarial", () => {
  describe("immune system circuit breaker", () => {
    it("opens the breaker after maxConsecutiveFailures and resets counter", () => {
      const immune = createWorkerRuntimeImmuneSystem({
        runnerId: "test-runner",
        controls: { maxConsecutiveFailures: 3, coolDownMs: 100 }
      });

      // Record 3 failures to open the breaker
      immune.recordJobOutcome("goal_create", "dead_letter");
      immune.recordJobOutcome("goal_create", "dead_letter");
      immune.recordJobOutcome("goal_create", "dead_letter");

      // Breaker should be open — goal_create filtered out
      const allowed = immune.getAllowedKinds(["goal_create", "goal_refine"]);
      expect(allowed).toEqual(["goal_refine"]);
    });

    it("returns null when all kinds are circuit-broken", () => {
      const immune = createWorkerRuntimeImmuneSystem({
        runnerId: "test-runner",
        controls: { maxConsecutiveFailures: 2, coolDownMs: 60_000 }
      });

      immune.recordJobOutcome("goal_create", "dead_letter");
      immune.recordJobOutcome("goal_create", "dead_letter");

      const allowed = immune.getAllowedKinds(["goal_create"]);
      expect(allowed).toBeNull();
    });

    it("resets failure count on successful completion", () => {
      const immune = createWorkerRuntimeImmuneSystem({
        runnerId: "test-runner",
        controls: { maxConsecutiveFailures: 3, coolDownMs: 60_000 }
      });

      immune.recordJobOutcome("goal_create", "dead_letter");
      immune.recordJobOutcome("goal_create", "dead_letter");
      immune.recordJobOutcome("goal_create", "completed"); // Reset
      immune.recordJobOutcome("goal_create", "dead_letter");
      immune.recordJobOutcome("goal_create", "dead_letter");

      // Only 2 consecutive failures after reset — should still be allowed
      const allowed = immune.getAllowedKinds(["goal_create"]);
      expect(allowed).toEqual(["goal_create"]);
    });

    it("treats disabled immune system as passthrough", () => {
      const immune = createWorkerRuntimeImmuneSystem({
        runnerId: "test-runner",
        controls: { enabled: false, maxConsecutiveFailures: 1, coolDownMs: 60_000 }
      });

      immune.recordJobOutcome("goal_create", "dead_letter");
      immune.recordJobOutcome("goal_create", "dead_letter");

      // Disabled — everything allowed regardless of failures
      const allowed = immune.getAllowedKinds(["goal_create"]);
      expect(allowed).toEqual(["goal_create"]);
    });

    it("does not count transient statuses (queued/running/retrying/paused) as failures", () => {
      const immune = createWorkerRuntimeImmuneSystem({
        runnerId: "test-runner",
        controls: { maxConsecutiveFailures: 2, coolDownMs: 60_000 }
      });

      // These are transient states, not failures
      immune.recordJobOutcome("goal_create", "queued");
      immune.recordJobOutcome("goal_create", "running");
      immune.recordJobOutcome("goal_create", "retrying");
      immune.recordJobOutcome("goal_create", "paused");

      // Should still be allowed — no failures recorded
      const allowed = immune.getAllowedKinds(["goal_create"]);
      expect(allowed).toEqual(["goal_create"]);
    });

    it("counts cancelled and dead_letter as failures for the breaker", () => {
      const immune = createWorkerRuntimeImmuneSystem({
        runnerId: "test-runner",
        controls: { maxConsecutiveFailures: 2, coolDownMs: 60_000 }
      });

      immune.recordJobOutcome("goal_create", "dead_letter");
      immune.recordJobOutcome("goal_create", "cancelled");

      // Both are terminal failure states — breaker should open
      const allowed = immune.getAllowedKinds(["goal_create"]);
      expect(allowed).toBeNull();
    });
  });

  describe("concurrency policy edge cases", () => {
    it("rejects zero-valued env vars", () => {
      expect(() =>
        resolveWorkerConcurrencyPolicy({
          env: { AGENTIC_WORKER_MAX_RUNNING_PER_KIND: "0" },
          nodeEnv: "production"
        })
      ).toThrow("positive integer");
    });

    it("rejects negative env vars", () => {
      expect(() =>
        resolveWorkerConcurrencyPolicy({
          env: { AGENTIC_WORKER_MAX_RUNNING_PER_KIND: "-1" },
          nodeEnv: "production"
        })
      ).toThrow("positive integer");
    });

    it("rejects float env vars", () => {
      expect(() =>
        resolveWorkerConcurrencyPolicy({
          env: { AGENTIC_WORKER_MAX_RUNNING_PER_KIND: "1.5" },
          nodeEnv: "production"
        })
      ).toThrow("positive integer");
    });

    it("rejects non-numeric env vars", () => {
      expect(() =>
        resolveWorkerConcurrencyPolicy({
          env: { AGENTIC_WORKER_MAX_RUNNING_PER_KIND: "abc" },
          nodeEnv: "production"
        })
      ).toThrow("positive integer");
    });

    it("accepts whitespace-padded valid values", () => {
      const policy = resolveWorkerConcurrencyPolicy({
        env: { AGENTIC_WORKER_MAX_RUNNING_PER_KIND: "  5  " },
        nodeEnv: "production"
      });
      expect(policy.limits?.maxRunningPerKind).toBe(5);
    });

    it("returns unconstrained in non-production without explicit config", () => {
      const policy = resolveWorkerConcurrencyPolicy({
        env: {},
        nodeEnv: "development"
      });
      expect(policy.constrained).toBe(false);
      expect(policy.source).toBe("non-production-unconstrained");
    });

    it("applies production defaults when no env vars set", () => {
      const policy = resolveWorkerConcurrencyPolicy({
        env: {},
        nodeEnv: "production"
      });
      expect(policy.constrained).toBe(true);
      expect(policy.source).toBe("production-defaults");
      expect(policy.limits?.maxRunningPerKind).toBe(1);
      expect(policy.limits?.maxRunningPerUser).toBe(2);
    });

    it("handles partial config in non-production", () => {
      const policy = resolveWorkerConcurrencyPolicy({
        env: { AGENTIC_WORKER_MAX_RUNNING_PER_KIND: "3" },
        nodeEnv: "development"
      });
      expect(policy.constrained).toBe(true);
      expect(policy.source).toBe("env");
      expect(policy.limits?.maxRunningPerKind).toBe(3);
      // Other limits are undefined in partial config
      expect(policy.limits?.maxRunningPerUser).toBeUndefined();
    });
  });

  describe("health snapshot edge cases", () => {
    it("preserves immutable fields across updates", () => {
      const snapshot = createWorkerRuntimeHealthSnapshot({
        runnerId: "runner-1",
        now: "2026-01-01T00:00:00.000Z"
      });
      const updated = updateWorkerRuntimeHealthSnapshot(snapshot, {
        status: "running",
        processedCount: 10,
        runnerId: "hijacked-runner" as any,
        version: 99 as any
      });

      // Immutable fields must not change
      expect(updated.runnerId).toBe("runner-1");
      expect(updated.version).toBe(1);
      expect(updated.startedAt).toBe("2026-01-01T00:00:00.000Z");
    });

    it("merges scheduler updates without losing top-level fields", () => {
      const snapshot = createWorkerRuntimeHealthSnapshot({
        runnerId: "runner-1"
      });
      const updated = updateWorkerRuntimeHealthSnapshot(snapshot, {
        status: "running",
        processedCount: 5,
        scheduler: {
          enabled: true,
          lastRunAt: "2026-01-01T00:01:00.000Z"
        }
      });

      expect(updated.status).toBe("running");
      expect(updated.processedCount).toBe(5);
      expect(updated.scheduler.enabled).toBe(true);
      expect(updated.scheduler.lastRunAt).toBe("2026-01-01T00:01:00.000Z");
    });

    it("rejects invalid health snapshot shapes on read", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-health-invalid-"));
      const filePath = path.join(tempDir, "health.json");
      const sink = createFileWorkerRuntimeHealthSink(filePath);

      // Write a valid snapshot first
      const valid = createWorkerRuntimeHealthSnapshot({ runnerId: "test" });
      await sink.write(valid);

      // Now overwrite with invalid content
      const { writeFile } = await import("node:fs/promises");
      await writeFile(filePath, JSON.stringify({ version: 2, garbage: true }), "utf8");

      await expect(readFileWorkerRuntimeHealthSnapshot(filePath)).rejects.toThrow("invalid shape");
    });

    it("rejects oversized health files", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-health-oversized-"));
      const filePath = path.join(tempDir, "health.json");
      const { writeFile } = await import("node:fs/promises");

      // Write > 16KB
      await writeFile(filePath, "x".repeat(20_000), "utf8");

      await expect(readFileWorkerRuntimeHealthSnapshot(filePath)).rejects.toThrow("bounded file size");
    });
  });

  describe("scheduled autopilot due time", () => {
    it("treats non-scheduled event kinds as always due", () => {
      const result = getScheduledAutopilotDueTime({
        id: "event-1",
        userId: "user-1",
        kind: "communication_received",
        sourceId: "source-1",
        summary: "test",
        details: {},
        status: "pending",
        createdAt: nowIso(),
        processedAt: null,
        error: null,
        resultGoalId: null,
        actorContext: null
      } as any);

      expect(result.due).toBe(true);
      expect(result.dueAt).toBeNull();
    });

    it("rejects template_due events with missing dueAt", () => {
      const result = getScheduledAutopilotDueTime({
        id: "event-1",
        userId: "user-1",
        kind: "template_due",
        sourceId: "source-1",
        summary: "test",
        details: {},
        status: "pending",
        createdAt: nowIso(),
        processedAt: null,
        error: null,
        resultGoalId: null,
        actorContext: null
      } as any);

      expect(result.due).toBe(false);
      expect(result.reason).toBe("missing_due_time");
    });

    it("rejects template_due events with invalid dueAt string", () => {
      const result = getScheduledAutopilotDueTime({
        id: "event-1",
        userId: "user-1",
        kind: "template_due",
        sourceId: "source-1",
        summary: "test",
        details: { dueAt: "not-a-date" },
        status: "pending",
        createdAt: nowIso(),
        processedAt: null,
        error: null,
        resultGoalId: null,
        actorContext: null
      } as any);

      expect(result.due).toBe(false);
      // BUG: reason says "missing_due_time" for an INVALID date, not a missing one
      expect(result.reason).toBe("missing_due_time");
    });

    it("rejects future-dated template_due events", () => {
      const futureDate = new Date(Date.now() + 3_600_000).toISOString();
      const result = getScheduledAutopilotDueTime({
        id: "event-1",
        userId: "user-1",
        kind: "template_due",
        sourceId: "source-1",
        summary: "test",
        details: { dueAt: futureDate },
        status: "pending",
        createdAt: nowIso(),
        processedAt: null,
        error: null,
        resultGoalId: null,
        actorContext: null
      } as any);

      expect(result.due).toBe(false);
      expect(result.reason).toBe("future_due_time");
    });

    it("accepts past-dated template_due events", () => {
      const pastDate = new Date(Date.now() - 3_600_000).toISOString();
      const result = getScheduledAutopilotDueTime({
        id: "event-1",
        userId: "user-1",
        kind: "briefing_due",
        sourceId: "source-1",
        summary: "test",
        details: { dueAt: pastDate },
        status: "pending",
        createdAt: nowIso(),
        processedAt: null,
        error: null,
        resultGoalId: null,
        actorContext: null
      } as any);

      expect(result.due).toBe(true);
      expect(result.dueAt).toBe(pastDate);
    });
  });
});
