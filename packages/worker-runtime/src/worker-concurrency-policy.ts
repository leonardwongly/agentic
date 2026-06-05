import type { JobConcurrencyLimits } from "@agentic/execution";

export const AGENTIC_WORKER_MAX_RUNNING_PER_KIND_ENV = "AGENTIC_WORKER_MAX_RUNNING_PER_KIND";
export const AGENTIC_WORKER_MAX_RUNNING_PER_USER_ENV = "AGENTIC_WORKER_MAX_RUNNING_PER_USER";
export const AGENTIC_WORKER_MAX_RUNNING_PER_CONCURRENCY_KEY_ENV =
  "AGENTIC_WORKER_MAX_RUNNING_PER_CONCURRENCY_KEY";

export const DEFAULT_PRODUCTION_WORKER_CONCURRENCY_LIMITS = {
  maxRunningPerKind: 1,
  maxRunningPerUser: 2,
  maxRunningPerConcurrencyKey: 1
} satisfies Required<JobConcurrencyLimits>;

export type WorkerConcurrencyPolicySource =
  | "env"
  | "production-defaults"
  | "non-production-unconstrained";

export type WorkerConcurrencyPolicy = {
  limits?: JobConcurrencyLimits;
  source: WorkerConcurrencyPolicySource;
  constrained: boolean;
  explicitlyConfigured: boolean;
};

type WorkerConcurrencyPolicyEnv = Record<string, string | undefined>;

function parseOptionalPositiveIntEnv(env: WorkerConcurrencyPolicyEnv, name: string): number | undefined {
  const value = env[name]?.trim();

  if (!value) {
    return undefined;
  }

  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive integer when configured.`);
  }

  return Number.parseInt(value, 10);
}

export function resolveWorkerConcurrencyPolicy(params?: {
  env?: WorkerConcurrencyPolicyEnv;
  nodeEnv?: string;
}): WorkerConcurrencyPolicy {
  const env = params?.env ?? process.env;
  const nodeEnv = params?.nodeEnv ?? env.NODE_ENV;
  const configuredLimits = {
    maxRunningPerKind: parseOptionalPositiveIntEnv(env, AGENTIC_WORKER_MAX_RUNNING_PER_KIND_ENV),
    maxRunningPerUser: parseOptionalPositiveIntEnv(env, AGENTIC_WORKER_MAX_RUNNING_PER_USER_ENV),
    maxRunningPerConcurrencyKey: parseOptionalPositiveIntEnv(env, AGENTIC_WORKER_MAX_RUNNING_PER_CONCURRENCY_KEY_ENV)
  };
  const explicitlyConfigured = Object.values(configuredLimits).some((value) => value !== undefined);

  if (nodeEnv === "production") {
    return {
      limits: {
        maxRunningPerKind:
          configuredLimits.maxRunningPerKind ?? DEFAULT_PRODUCTION_WORKER_CONCURRENCY_LIMITS.maxRunningPerKind,
        maxRunningPerUser:
          configuredLimits.maxRunningPerUser ?? DEFAULT_PRODUCTION_WORKER_CONCURRENCY_LIMITS.maxRunningPerUser,
        maxRunningPerConcurrencyKey:
          configuredLimits.maxRunningPerConcurrencyKey ??
          DEFAULT_PRODUCTION_WORKER_CONCURRENCY_LIMITS.maxRunningPerConcurrencyKey
      },
      source: explicitlyConfigured ? "env" : "production-defaults",
      constrained: true,
      explicitlyConfigured
    };
  }

  if (!explicitlyConfigured) {
    return {
      source: "non-production-unconstrained",
      constrained: false,
      explicitlyConfigured: false
    };
  }

  return {
    limits: configuredLimits,
    source: "env",
    constrained: true,
    explicitlyConfigured: true
  };
}
