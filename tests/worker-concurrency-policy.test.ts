import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRODUCTION_WORKER_CONCURRENCY_LIMITS,
  resolveWorkerConcurrencyPolicy
} from "@agentic/worker-runtime";

describe("worker concurrency policy", () => {
  it("applies safe production defaults when concurrency env vars are absent", () => {
    expect(resolveWorkerConcurrencyPolicy({
      nodeEnv: "production",
      env: {
        NODE_ENV: "production"
      }
    })).toEqual({
      limits: DEFAULT_PRODUCTION_WORKER_CONCURRENCY_LIMITS,
      source: "production-defaults",
      constrained: true,
      explicitlyConfigured: false
    });
  });

  it("merges partial production env overrides with defaults", () => {
    expect(resolveWorkerConcurrencyPolicy({
      nodeEnv: "production",
      env: {
        AGENTIC_WORKER_MAX_RUNNING_PER_USER: "7"
      }
    })).toEqual({
      limits: {
        maxRunningPerKind: DEFAULT_PRODUCTION_WORKER_CONCURRENCY_LIMITS.maxRunningPerKind,
        maxRunningPerUser: 7,
        maxRunningPerConcurrencyKey: DEFAULT_PRODUCTION_WORKER_CONCURRENCY_LIMITS.maxRunningPerConcurrencyKey
      },
      source: "env",
      constrained: true,
      explicitlyConfigured: true
    });
  });

  it("keeps non-production unconstrained when no limits are configured", () => {
    expect(resolveWorkerConcurrencyPolicy({
      nodeEnv: "test",
      env: {
        NODE_ENV: "test"
      }
    })).toEqual({
      source: "non-production-unconstrained",
      constrained: false,
      explicitlyConfigured: false
    });
  });

  it("uses explicit non-production limits when configured", () => {
    expect(resolveWorkerConcurrencyPolicy({
      nodeEnv: "development",
      env: {
        AGENTIC_WORKER_MAX_RUNNING_PER_KIND: "3",
        AGENTIC_WORKER_MAX_RUNNING_PER_CONCURRENCY_KEY: "1"
      }
    })).toEqual({
      limits: {
        maxRunningPerKind: 3,
        maxRunningPerUser: undefined,
        maxRunningPerConcurrencyKey: 1
      },
      source: "env",
      constrained: true,
      explicitlyConfigured: true
    });
  });

  it("rejects invalid configured limits", () => {
    expect(() => resolveWorkerConcurrencyPolicy({
      nodeEnv: "production",
      env: {
        AGENTIC_WORKER_MAX_RUNNING_PER_KIND: "0"
      }
    })).toThrow("AGENTIC_WORKER_MAX_RUNNING_PER_KIND must be a positive integer");

    expect(() => resolveWorkerConcurrencyPolicy({
      nodeEnv: "production",
      env: {
        AGENTIC_WORKER_MAX_RUNNING_PER_USER: "3.5"
      }
    })).toThrow("AGENTIC_WORKER_MAX_RUNNING_PER_USER must be a positive integer");
  });
});
