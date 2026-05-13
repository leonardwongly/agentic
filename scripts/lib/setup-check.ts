export type SetupCheckStatus = "pass" | "warn" | "fail";

export type SetupCheckResult = {
  id: string;
  status: SetupCheckStatus;
  message: string;
};

export type SetupCheckReport = {
  mode: "development" | "test" | "production";
  ok: boolean;
  checks: SetupCheckResult[];
};

type SetupCheckRuntime = {
  nodeVersion?: string;
};

function trim(value: string | undefined): string {
  return value?.trim() ?? "";
}

function isTrue(value: string | undefined): boolean {
  return trim(value).toLowerCase() === "true";
}

function parseMajorNodeVersion(version: string): number {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  return Number.isFinite(major) ? major : 0;
}

function addCheck(checks: SetupCheckResult[], id: string, status: SetupCheckStatus, message: string) {
  checks.push({
    id,
    status,
    message
  });
}

function evaluateAccessKey(env: NodeJS.ProcessEnv, checks: SetupCheckResult[], production: boolean) {
  const accessKey = trim(env.AGENTIC_ACCESS_KEY);

  if (!accessKey) {
    addCheck(
      checks,
      "access_key",
      production ? "fail" : "warn",
      production
        ? "AGENTIC_ACCESS_KEY is required in production."
        : "AGENTIC_ACCESS_KEY is not set; local development will use the agentic-local-dev-key fallback."
    );
    return;
  }

  if (accessKey === "agentic-local-dev-key" || accessKey.startsWith("replace-")) {
    addCheck(
      checks,
      "access_key",
      production ? "fail" : "warn",
      production
        ? "AGENTIC_ACCESS_KEY must not use a placeholder or development fallback in production."
        : "AGENTIC_ACCESS_KEY is using a development-style value; use a long random secret for shared environments."
    );
    return;
  }

  if (accessKey.length < 32) {
    addCheck(
      checks,
      "access_key",
      production ? "fail" : "warn",
      production
        ? "AGENTIC_ACCESS_KEY must be at least 32 characters in production."
        : "AGENTIC_ACCESS_KEY is short; use at least 32 random characters before sharing the environment."
    );
    return;
  }

  addCheck(checks, "access_key", "pass", "AGENTIC_ACCESS_KEY is configured.");
}

function evaluateDatabase(env: NodeJS.ProcessEnv, checks: SetupCheckResult[], production: boolean) {
  const databaseUrl = trim(env.DATABASE_URL);

  if (!databaseUrl) {
    addCheck(
      checks,
      "database",
      production ? "fail" : "warn",
      production
        ? "DATABASE_URL is required in production."
        : "DATABASE_URL is not set; the app will use the development-only file-backed runtime store."
    );
    return;
  }

  if (!/^postgres(?:ql)?:\/\//u.test(databaseUrl)) {
    addCheck(checks, "database", "fail", "DATABASE_URL must use a postgres:// or postgresql:// URL.");
    return;
  }

  addCheck(checks, "database", "pass", "DATABASE_URL is configured for Postgres-backed persistence.");
}

function evaluateAuthState(env: NodeJS.ProcessEnv, checks: SetupCheckResult[], production: boolean) {
  const databaseUrl = trim(env.DATABASE_URL);
  const sharedAuth = isTrue(env.AGENTIC_SHARED_AUTH_STATE);
  const requireSharedAuth = isTrue(env.AGENTIC_REQUIRE_SHARED_AUTH_STATE);
  const allowProcessLocal = isTrue(env.AGENTIC_ALLOW_PROCESS_LOCAL_AUTH_STATE);

  if (allowProcessLocal) {
    addCheck(
      checks,
      "auth_state",
      production ? "warn" : "pass",
      production
        ? "AGENTIC_ALLOW_PROCESS_LOCAL_AUTH_STATE=true is set; this should only be used for audited single-instance production deployments."
        : "Process-local auth state is explicitly allowed for this non-production environment."
    );
    return;
  }

  if ((production || requireSharedAuth || sharedAuth) && !databaseUrl) {
    addCheck(
      checks,
      "auth_state",
      "fail",
      "Shared auth state requires DATABASE_URL so session revocation, unlock throttling, and rate limits are not process-local."
    );
    return;
  }

  if (production || requireSharedAuth || sharedAuth) {
    addCheck(checks, "auth_state", "pass", "Shared auth state can use the configured Postgres backend.");
    return;
  }

  addCheck(
    checks,
    "auth_state",
    "warn",
    "Auth state is process-local in this non-production setup; set AGENTIC_SHARED_AUTH_STATE=true with DATABASE_URL for parity."
  );
}

function evaluateGoogleConfig(env: NodeJS.ProcessEnv, checks: SetupCheckResult[]) {
  const configured = [
    trim(env.GOOGLE_CLIENT_ID),
    trim(env.GOOGLE_CLIENT_SECRET),
    trim(env.GOOGLE_REFRESH_TOKEN)
  ];
  const configuredCount = configured.filter(Boolean).length;

  if (configuredCount === 0) {
    addCheck(checks, "google", "warn", "Google integrations are not configured; Google connect/actions will stay unavailable.");
    return;
  }

  if (configuredCount < configured.length) {
    addCheck(
      checks,
      "google",
      "fail",
      "Google integrations require GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN together."
    );
    return;
  }

  addCheck(checks, "google", "pass", "Google integration credentials are present.");
}

function evaluateProviderSecret(env: NodeJS.ProcessEnv, checks: SetupCheckResult[], production: boolean) {
  const providerSecret = trim(env.AGENTIC_PROVIDER_SECRET_KEY);

  if (!providerSecret) {
    addCheck(
      checks,
      "provider_secret",
      production ? "warn" : "warn",
      "AGENTIC_PROVIDER_SECRET_KEY is not set; encrypted provider credential storage will be unavailable."
    );
    return;
  }

  if (providerSecret.length < 32) {
    addCheck(checks, "provider_secret", production ? "fail" : "warn", "AGENTIC_PROVIDER_SECRET_KEY should be at least 32 characters.");
    return;
  }

  addCheck(checks, "provider_secret", "pass", "AGENTIC_PROVIDER_SECRET_KEY is configured.");
}

export function evaluateSetupEnvironment(
  env: NodeJS.ProcessEnv,
  runtime: SetupCheckRuntime = {}
): SetupCheckReport {
  const mode = trim(env.NODE_ENV) === "production" ? "production" : trim(env.NODE_ENV) === "test" ? "test" : "development";
  const production = mode === "production";
  const checks: SetupCheckResult[] = [];
  const nodeVersion = runtime.nodeVersion ?? process.versions.node;
  const nodeMajor = parseMajorNodeVersion(nodeVersion);

  addCheck(
    checks,
    "node",
    nodeMajor >= 20 ? "pass" : "fail",
    nodeMajor >= 20 ? `Node ${nodeVersion} satisfies the Node 20+ requirement.` : `Node ${nodeVersion} is unsupported; use Node 20 or newer.`
  );
  evaluateAccessKey(env, checks, production);
  evaluateDatabase(env, checks, production);
  evaluateAuthState(env, checks, production);
  evaluateGoogleConfig(env, checks);
  evaluateProviderSecret(env, checks, production);

  return {
    mode,
    ok: checks.every((check) => check.status !== "fail"),
    checks
  };
}
