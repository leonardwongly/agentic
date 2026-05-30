import path from "node:path";
import type { DatabaseSchemaStatus } from "@agentic/db/migration-runtime";

const TRUSTED_CLIENT_IP_HEADERS = new Set(["cf-connecting-ip", "x-forwarded-for", "x-real-ip"]);

type EnvLike = Record<string, string | undefined>;

export type ProductionBootstrapCheckName =
  | "runtime"
  | "database_url"
  | "database_schema"
  | "shared_auth_state"
  | "process_local_auth_exception"
  | "access_key"
  | "proxy_trust"
  | "client_ip_header"
  | "worker_heartbeat";

export type ProductionBootstrapCheck = {
  name: ProductionBootstrapCheckName;
  status: "pass" | "warn" | "fail";
  message: string;
  details?: Record<string, boolean | number | string | string[] | null>;
};

export type ProductionBootstrapReport = {
  ok: boolean;
  targetName: string;
  staticOnly: boolean;
  storageBackend: "postgres" | "file";
  database: {
    configured: boolean;
    checked: boolean;
    reachable: boolean | null;
    ready: boolean | null;
    failureReason: DatabaseSchemaStatus["failureReason"] | "not_checked" | null;
    appliedMigrationCount: number | null;
    pendingMigrations: string[];
    driftedMigrations: string[];
    missingRequiredTables: string[];
    missingRequiredIndexes: string[];
    lastAppliedAt: string | null;
  };
  authRuntime: {
    requireSharedAuthState: boolean;
    sharedAuthStateFlag: boolean;
    processLocalExceptionAllowed: boolean;
  };
  checks: ProductionBootstrapCheck[];
};

export type ValidateProductionBootstrapParams = {
  env: EnvLike;
  databaseStatus?: DatabaseSchemaStatus;
  staticOnly?: boolean;
};

function trim(value: string | undefined): string {
  return value?.trim() ?? "";
}

function isTrue(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function pass(
  name: ProductionBootstrapCheckName,
  message: string,
  details?: ProductionBootstrapCheck["details"]
): ProductionBootstrapCheck {
  return {
    name,
    status: "pass",
    message,
    details
  };
}

function warn(
  name: ProductionBootstrapCheckName,
  message: string,
  details?: ProductionBootstrapCheck["details"]
): ProductionBootstrapCheck {
  return {
    name,
    status: "warn",
    message,
    details
  };
}

function fail(
  name: ProductionBootstrapCheckName,
  message: string,
  details?: ProductionBootstrapCheck["details"]
): ProductionBootstrapCheck {
  return {
    name,
    status: "fail",
    message,
    details
  };
}

function buildRuntimeCheck(env: EnvLike): ProductionBootstrapCheck {
  if (trim(env.NODE_ENV) !== "production") {
    return fail("runtime", "Production bootstrap evidence must run with NODE_ENV=production.");
  }

  return pass("runtime", "Production runtime mode is selected.");
}

function buildDatabaseUrlCheck(env: EnvLike): ProductionBootstrapCheck {
  if (!trim(env.DATABASE_URL)) {
    return fail("database_url", "DATABASE_URL must be configured so production cannot fall back to file storage.");
  }

  return pass("database_url", "Postgres database configuration is present.", { configured: true });
}

function buildDatabaseSchemaCheck(params: {
  databaseConfigured: boolean;
  databaseStatus?: DatabaseSchemaStatus;
  staticOnly: boolean;
}): ProductionBootstrapCheck {
  if (params.staticOnly) {
    return warn("database_schema", "Live database schema check skipped by --static-only; run db:migrate and db:status against the target database before rollout.", {
      checked: false
    });
  }

  if (!params.databaseConfigured) {
    return fail("database_schema", "Database schema cannot be checked until DATABASE_URL is configured.");
  }

  if (!params.databaseStatus) {
    return fail("database_schema", "Database schema status was not supplied to the production bootstrap check.");
  }

  if (!params.databaseStatus.reachable) {
    return fail("database_schema", "Target database is unreachable.", {
      reachable: false,
      failureReason: params.databaseStatus.failureReason ?? "unreachable"
    });
  }

  if (!params.databaseStatus.ready) {
    return fail("database_schema", "Target database schema is not production-ready.", {
      failureReason: params.databaseStatus.failureReason,
      pendingMigrations: params.databaseStatus.pendingMigrations,
      driftedMigrations: params.databaseStatus.driftedMigrations,
      missingRequiredTables: params.databaseStatus.requiredSchemaObjects.missingTables,
      missingRequiredIndexes: params.databaseStatus.requiredSchemaObjects.missingIndexes
    });
  }

  return pass("database_schema", "Target database schema is reachable and ready.", {
    appliedMigrationCount: params.databaseStatus.appliedMigrations.length,
    lastAppliedAt: params.databaseStatus.lastAppliedAt
  });
}

function buildSharedAuthStateCheck(env: EnvLike): ProductionBootstrapCheck {
  if (!isTrue(env.AGENTIC_REQUIRE_SHARED_AUTH_STATE)) {
    return fail(
      "shared_auth_state",
      "AGENTIC_REQUIRE_SHARED_AUTH_STATE=true must be set so production refuses process-local auth runtime state."
    );
  }

  return pass("shared_auth_state", "Shared auth runtime state is required for production startup.");
}

function buildProcessLocalExceptionCheck(env: EnvLike): ProductionBootstrapCheck {
  if (isTrue(env.AGENTIC_ALLOW_PROCESS_LOCAL_AUTH_STATE)) {
    return fail(
      "process_local_auth_exception",
      "AGENTIC_ALLOW_PROCESS_LOCAL_AUTH_STATE must not be enabled for production bootstrap evidence."
    );
  }

  return pass("process_local_auth_exception", "Process-local auth runtime exception is disabled.");
}

function buildAccessKeyCheck(env: EnvLike): ProductionBootstrapCheck {
  if (!trim(env.AGENTIC_ACCESS_KEY)) {
    return fail("access_key", "AGENTIC_ACCESS_KEY must be configured for production authenticated boundaries.");
  }

  return pass("access_key", "Production access key is configured.", { configured: true });
}

function buildProxyTrustCheck(env: EnvLike): ProductionBootstrapCheck {
  if (!isTrue(env.AGENTIC_TRUST_PROXY_HEADERS)) {
    return fail(
      "proxy_trust",
      "AGENTIC_TRUST_PROXY_HEADERS=true must be set only after confirming the ingress overwrites forwarded client-IP headers."
    );
  }

  return pass("proxy_trust", "Trusted proxy headers are explicitly enabled for the production ingress.");
}

function buildProxyHeaderOverwriteCheck(env: EnvLike): ProductionBootstrapCheck {
  if (!isTrue(env.AGENTIC_PROXY_HEADER_OVERWRITE_CONFIRMED)) {
    return fail(
      "proxy_header_overwrite",
      "AGENTIC_PROXY_HEADER_OVERWRITE_CONFIRMED=true must be set only after confirming the ingress overwrites forwarded client-IP headers."
    );
  }

  return pass("proxy_header_overwrite", "Ingress proxy header overwrite behavior is explicitly confirmed.");
}

function buildTrustedClientIpHeaderCheck(env: EnvLike): ProductionBootstrapCheck {
  const configured = trim(env.AGENTIC_TRUSTED_CLIENT_IP_HEADER).toLowerCase();

  if (!configured) {
    return fail("client_ip_header", "AGENTIC_TRUSTED_CLIENT_IP_HEADER must name the ingress-overwritten client-IP header.");
  }

  if (!TRUSTED_CLIENT_IP_HEADERS.has(configured)) {
    return fail("client_ip_header", "Trusted client-IP header must be one of the supported canonical headers.", {
      configured
    });
  }

  return pass("client_ip_header", "Trusted client-IP header contract is explicit.", {
    header: configured
  });
}

function buildWorkerHeartbeatCheck(env: EnvLike): ProductionBootstrapCheck {
  const configured = trim(env.AGENTIC_WORKER_HEALTH_PATH);

  if (!configured) {
    return fail(
      "worker_heartbeat",
      "AGENTIC_WORKER_HEALTH_PATH must be configured so web readiness can verify the worker runtime."
    );
  }

  if (!path.isAbsolute(configured)) {
    return fail("worker_heartbeat", "AGENTIC_WORKER_HEALTH_PATH must be an absolute path shared by web and worker runtimes.", {
      configured
    });
  }

  return pass("worker_heartbeat", "Worker heartbeat path is configured for production readiness.", {
    path: configured
  });
}

function summarizeDatabase(params: {
  configured: boolean;
  databaseStatus?: DatabaseSchemaStatus;
  staticOnly: boolean;
}): ProductionBootstrapReport["database"] {
  if (params.staticOnly || !params.databaseStatus) {
    return {
      configured: params.configured,
      checked: false,
      reachable: null,
      ready: null,
      failureReason: "not_checked",
      appliedMigrationCount: null,
      pendingMigrations: [],
      driftedMigrations: [],
      missingRequiredTables: [],
      missingRequiredIndexes: [],
      lastAppliedAt: null
    };
  }

  return {
    configured: params.configured,
    checked: true,
    reachable: params.databaseStatus.reachable,
    ready: params.databaseStatus.ready,
    failureReason: params.databaseStatus.failureReason,
    appliedMigrationCount: params.databaseStatus.appliedMigrations.length,
    pendingMigrations: params.databaseStatus.pendingMigrations,
    driftedMigrations: params.databaseStatus.driftedMigrations,
    missingRequiredTables: params.databaseStatus.requiredSchemaObjects.missingTables,
    missingRequiredIndexes: params.databaseStatus.requiredSchemaObjects.missingIndexes,
    lastAppliedAt: params.databaseStatus.lastAppliedAt
  };
}

export function validateProductionBootstrap(params: ValidateProductionBootstrapParams): ProductionBootstrapReport {
  const env = params.env;
  const staticOnly = params.staticOnly ?? false;
  const databaseConfigured = Boolean(trim(env.DATABASE_URL));
  const requireSharedAuthState = isTrue(env.AGENTIC_REQUIRE_SHARED_AUTH_STATE);
  const sharedAuthStateFlag = isTrue(env.AGENTIC_SHARED_AUTH_STATE);
  const processLocalExceptionAllowed = isTrue(env.AGENTIC_ALLOW_PROCESS_LOCAL_AUTH_STATE);
  const checks = [
    buildRuntimeCheck(env),
    buildDatabaseUrlCheck(env),
    buildDatabaseSchemaCheck({
      databaseConfigured,
      databaseStatus: params.databaseStatus,
      staticOnly
    }),
    buildSharedAuthStateCheck(env),
    buildProcessLocalExceptionCheck(env),
    buildAccessKeyCheck(env),
    buildProxyTrustCheck(env),
    buildProxyHeaderOverwriteCheck(env),
    buildTrustedClientIpHeaderCheck(env),
    buildWorkerHeartbeatCheck(env)
  ];

  return {
    ok: checks.every((check) => check.status !== "fail"),
    targetName: trim(env.AGENTIC_BOOTSTRAP_TARGET_NAME) || trim(env.AGENTIC_INGRESS_TARGET_NAME) || "production",
    staticOnly,
    storageBackend: databaseConfigured ? "postgres" : "file",
    database: summarizeDatabase({
      configured: databaseConfigured,
      databaseStatus: params.databaseStatus,
      staticOnly
    }),
    authRuntime: {
      requireSharedAuthState,
      sharedAuthStateFlag,
      processLocalExceptionAllowed
    },
    checks
  };
}
