import { isIP } from "node:net";

const SYNC_PATH = "/api/github/issues/app/sync";
const TEMPORARY_SYNC_DOMAINS = [
  "trycloudflare.com",
  "ngrok.io",
  "ngrok.app",
  "ngrok-free.app",
  "loca.lt",
  "localhost.run",
  "devtunnels.ms",
  "serveo.net",
  "tunnelmole.net"
];
const REQUIRED_RUNTIME_ENV = [
  "DATABASE_URL",
  "AGENTIC_ACCESS_KEY",
  "AGENTIC_GITHUB_APP_ID",
  "AGENTIC_GITHUB_APP_INSTALLATION_ID",
  "AGENTIC_GITHUB_APP_PRIVATE_KEY",
  "AGENTIC_GITHUB_APP_SYNC_SECRET",
  "AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES"
] as const;
const REQUIRED_CANARY_ENV = ["AGENTIC_SMOKE_ACCESS_KEY"] as const;
const REQUIRED_GITHUB_ACTIONS_SECRETS = ["AGENTIC_GITHUB_APP_SYNC_SECRET"] as const;
const FORBIDDEN_GITHUB_ACTIONS_SECRETS = [
  "AGENTIC_GITHUB_APP_PRIVATE_KEY",
  "AGENTIC_GITHUB_APP_INSTALLATION_ID",
  "AGENTIC_GITHUB_APP_INSTALLATION_TOKEN"
] as const;
const REPOSITORY_FULL_NAME_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const NUMERIC_ID_PATTERN = /^[1-9][0-9]{0,19}$/u;

type RequiredRuntimeEnvName = (typeof REQUIRED_RUNTIME_ENV)[number];
type RequiredCanaryEnvName = (typeof REQUIRED_CANARY_ENV)[number];
type RequiredGitHubActionsSecretName = (typeof REQUIRED_GITHUB_ACTIONS_SECRETS)[number];
type ForbiddenGitHubActionsSecretName = (typeof FORBIDDEN_GITHUB_ACTIONS_SECRETS)[number];

export type GitHubAppSyncLivePreflightCheck = {
  name:
    | "sync_url"
    | "stable_host"
    | "smoke_base_url"
    | "workflow_state"
    | "github_actions_secret_inventory"
    | "runtime_secret_inventory"
    | "runtime_secret_shape"
    | "smoke_canary_inventory"
    | "repository_allowlist"
    | "provider_services"
    | "provider_configuration"
    | "deployment_smoke"
    | "deployment_async_canary"
    | "github_app_sync_canary";
  status: "pass" | "warn" | "fail";
  message: string;
  details?: Record<string, string | number | boolean | null>;
};

export type GitHubAppSyncLivePreflightReport = {
  ok: boolean;
  syncUrl: string | null;
  smokeBaseUrl: string | null;
  workflowState: string | null;
  endpoints: {
    health: string | null;
    readiness: string | null;
    sync: string | null;
  };
  checks: GitHubAppSyncLivePreflightCheck[];
};

function trim(value: string | undefined): string {
  return value?.trim() ?? "";
}

function pass(
  name: GitHubAppSyncLivePreflightCheck["name"],
  message: string,
  details?: GitHubAppSyncLivePreflightCheck["details"]
): GitHubAppSyncLivePreflightCheck {
  return { name, status: "pass", message, details };
}

function warn(
  name: GitHubAppSyncLivePreflightCheck["name"],
  message: string,
  details?: GitHubAppSyncLivePreflightCheck["details"]
): GitHubAppSyncLivePreflightCheck {
  return { name, status: "warn", message, details };
}

function fail(
  name: GitHubAppSyncLivePreflightCheck["name"],
  message: string,
  details?: GitHubAppSyncLivePreflightCheck["details"]
): GitHubAppSyncLivePreflightCheck {
  return { name, status: "fail", message, details };
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
}

function domainMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function isTemporaryHost(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return TEMPORARY_SYNC_DOMAINS.some((domain) => domainMatches(normalized, domain));
}

function parseIpv4(hostname: string): number[] | null {
  const normalized = normalizeHostname(hostname);

  if (isIP(normalized) !== 4) {
    return null;
  }

  const octets = normalized.split(".").map((segment) => Number.parseInt(segment, 10));
  return octets.length === 4 && octets.every((octet) => Number.isInteger(octet)) ? octets : null;
}

function isLocalOrPrivateHost(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  const ipVersion = isIP(normalized);

  if (normalized === "localhost" || normalized === "::1") {
    return true;
  }

  const ipv4 = parseIpv4(normalized);

  if (ipv4) {
    const [first = 0, second = 0] = ipv4;

    return (
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }

  return ipVersion === 6 && (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:"));
}

function parseSyncUrl(env: NodeJS.ProcessEnv): { url: URL | null; checks: GitHubAppSyncLivePreflightCheck[] } {
  const raw = trim(env.AGENTIC_GITHUB_APP_ISSUE_SYNC_URL);

  if (!raw) {
    return {
      url: null,
      checks: [fail("sync_url", "Set AGENTIC_GITHUB_APP_ISSUE_SYNC_URL to the deployed sync endpoint.")]
    };
  }

  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    return {
      url: null,
      checks: [fail("sync_url", "AGENTIC_GITHUB_APP_ISSUE_SYNC_URL must be a valid absolute URL.")]
    };
  }

  const checks: GitHubAppSyncLivePreflightCheck[] = [];

  if (url.protocol !== "https:") {
    checks.push(fail("sync_url", "Sync URL must use HTTPS.", { protocol: url.protocol.replace(/:$/, "") }));
  }

  if (url.username || url.password) {
    checks.push(fail("sync_url", "Sync URL must not include embedded credentials."));
  }

  if (url.pathname !== SYNC_PATH || url.search || url.hash) {
    checks.push(fail("sync_url", `Sync URL must point exactly to ${SYNC_PATH} without query or fragment.`));
  }

  if (checks.length === 0) {
    checks.push(pass("sync_url", "Sync URL points at the canonical deployed route.", { path: SYNC_PATH }));
  }

  return { url, checks };
}

function buildStableHostCheck(url: URL | null): GitHubAppSyncLivePreflightCheck {
  if (!url) {
    return fail("stable_host", "Sync host cannot be checked until the sync URL is valid.");
  }

  const hostname = normalizeHostname(url.hostname);

  if (isTemporaryHost(hostname)) {
    return fail("stable_host", "Sync URL must not use a temporary tunnel host.", { host: hostname });
  }

  if (isLocalOrPrivateHost(hostname)) {
    return fail("stable_host", "Sync URL must use a public stable DNS host.", { host: hostname });
  }

  return pass("stable_host", "Sync URL host is public and not a known temporary tunnel.", { host: hostname });
}

function parseSmokeBaseUrl(env: NodeJS.ProcessEnv, syncUrl: URL | null): GitHubAppSyncLivePreflightCheck {
  const raw = trim(env.AGENTIC_SMOKE_BASE_URL) || trim(env.AGENTIC_INGRESS_BASE_URL);

  if (!raw) {
    return fail("smoke_base_url", "Set AGENTIC_SMOKE_BASE_URL or AGENTIC_INGRESS_BASE_URL to the deployed origin.");
  }

  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    return fail("smoke_base_url", "Smoke base URL must be a valid absolute URL.");
  }

  if (url.protocol !== "https:" || url.username || url.password || (url.pathname && url.pathname !== "/") || url.search || url.hash) {
    return fail("smoke_base_url", "Smoke base URL must be an HTTPS origin without credentials, path, query, or fragment.");
  }

  if (syncUrl && url.origin !== syncUrl.origin) {
    return fail("smoke_base_url", "Smoke base URL and GitHub App sync URL must use the same origin.", {
      smokeOrigin: url.origin,
      syncOrigin: syncUrl.origin
    });
  }

  return pass("smoke_base_url", "Smoke base URL matches the sync endpoint origin.", { origin: url.origin });
}

function buildWorkflowStateCheck(env: NodeJS.ProcessEnv): GitHubAppSyncLivePreflightCheck {
  const state = trim(env.AGENTIC_GITHUB_APP_SYNC_WORKFLOW_STATE).toLowerCase();

  if (!state) {
    return fail(
      "workflow_state",
      "Set AGENTIC_GITHUB_APP_SYNC_WORKFLOW_STATE from `gh api repos/leonardwongly/agentic/actions/workflows/github-app-issue-sync.yml --jq .state`."
    );
  }

  if (state !== "active") {
    return fail("workflow_state", "GitHub App Issue Sync workflow must be active before live validation.", { state });
  }

  return pass("workflow_state", "GitHub App Issue Sync workflow is active.", { state });
}

function secretName(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const name = record.name;

  return typeof name === "string" && name.trim() ? name.trim() : null;
}

function buildGitHubActionsSecretInventoryCheck(env: NodeJS.ProcessEnv): GitHubAppSyncLivePreflightCheck {
  const raw = trim(env.AGENTIC_GITHUB_ACTIONS_SECRETS_JSON);

  if (!raw) {
    return fail(
      "github_actions_secret_inventory",
      "AGENTIC_GITHUB_ACTIONS_SECRETS_JSON is not set; live preflight cannot prove GitHub Actions secret inventory."
    );
  }

  let parsed: unknown;

  try {
    parsed = parseJsonObject(raw);
  } catch {
    return fail(
      "github_actions_secret_inventory",
      "AGENTIC_GITHUB_ACTIONS_SECRETS_JSON must contain JSON from `gh secret list --repo leonardwongly/agentic --json name`."
    );
  }

  if (!Array.isArray(parsed)) {
    return fail("github_actions_secret_inventory", "GitHub Actions secret inventory JSON must be an array.");
  }

  const names = new Set(parsed.map(secretName).filter((name): name is string => Boolean(name)));
  const missing = REQUIRED_GITHUB_ACTIONS_SECRETS.filter((name) => !names.has(name));

  if (missing.length > 0) {
    return fail("github_actions_secret_inventory", "GitHub Actions secret inventory is missing required sync caller secret.", {
      missingCount: missing.length,
      missingNames: missing.join(",")
    });
  }

  const forbidden = FORBIDDEN_GITHUB_ACTIONS_SECRETS.filter((name) => names.has(name));

  if (forbidden.length > 0) {
    return fail("github_actions_secret_inventory", "GitHub Actions secret inventory includes runtime-only GitHub App credentials.", {
      forbiddenCount: forbidden.length,
      forbiddenNames: forbidden.join(",")
    });
  }

  return pass("github_actions_secret_inventory", "GitHub Actions secret inventory contains the route caller secret only.", {
    requiredCount: REQUIRED_GITHUB_ACTIONS_SECRETS.length
  });
}

function buildRuntimeInventoryCheck(env: NodeJS.ProcessEnv): GitHubAppSyncLivePreflightCheck {
  const missing = REQUIRED_RUNTIME_ENV.filter((name) => !trim(env[name]));

  if (missing.length > 0) {
    return fail("runtime_secret_inventory", "Required runtime configuration is missing.", {
      missingCount: missing.length,
      missingNames: missing.join(",")
    });
  }

  return pass("runtime_secret_inventory", "Required runtime configuration names are present.", {
    count: REQUIRED_RUNTIME_ENV.length
  });
}

function buildRuntimeShapeCheck(env: NodeJS.ProcessEnv): GitHubAppSyncLivePreflightCheck {
  const invalid: string[] = [];
  const appId = trim(env.AGENTIC_GITHUB_APP_ID);
  const installationId = trim(env.AGENTIC_GITHUB_APP_INSTALLATION_ID);
  const privateKey = trim(env.AGENTIC_GITHUB_APP_PRIVATE_KEY);
  const syncSecret = trim(env.AGENTIC_GITHUB_APP_SYNC_SECRET);

  if (appId && !NUMERIC_ID_PATTERN.test(appId)) {
    invalid.push("AGENTIC_GITHUB_APP_ID");
  }

  if (installationId && !NUMERIC_ID_PATTERN.test(installationId)) {
    invalid.push("AGENTIC_GITHUB_APP_INSTALLATION_ID");
  }

  if (privateKey && privateKey.length > 12_000) {
    invalid.push("AGENTIC_GITHUB_APP_PRIVATE_KEY");
  }

  if (syncSecret && syncSecret.length < 32) {
    invalid.push("AGENTIC_GITHUB_APP_SYNC_SECRET");
  }

  if (invalid.length > 0) {
    return fail("runtime_secret_shape", "One or more runtime secrets/config values have an invalid shape.", {
      invalidNames: invalid.join(",")
    });
  }

  return pass("runtime_secret_shape", "Runtime secret/config values have valid non-secret shape.", {
    checkedNames: "AGENTIC_GITHUB_APP_ID,AGENTIC_GITHUB_APP_INSTALLATION_ID,AGENTIC_GITHUB_APP_PRIVATE_KEY,AGENTIC_GITHUB_APP_SYNC_SECRET"
  });
}

function buildSmokeCanaryInventoryCheck(env: NodeJS.ProcessEnv): GitHubAppSyncLivePreflightCheck {
  const missing = REQUIRED_CANARY_ENV.filter((name) => !trim(env[name]));

  if (missing.length > 0) {
    return fail("smoke_canary_inventory", "Required smoke canary configuration is missing.", {
      missingCount: missing.length,
      missingNames: missing.join(",")
    });
  }

  return pass("smoke_canary_inventory", "Required smoke canary configuration names are present.", {
    count: REQUIRED_CANARY_ENV.length
  });
}

function buildAllowlistCheck(env: NodeJS.ProcessEnv): GitHubAppSyncLivePreflightCheck {
  const raw = trim(env.AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES);

  if (!raw) {
    return fail("repository_allowlist", "AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES must be configured.");
  }

  const repositories = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const uniqueRepositories = new Set(repositories);

  if (uniqueRepositories.size === 0) {
    return fail("repository_allowlist", "Repository allowlist must include at least one repository.");
  }

  if (uniqueRepositories.size > 50) {
    return fail("repository_allowlist", "Repository allowlist must not include more than 50 repositories.", {
      count: uniqueRepositories.size
    });
  }

  const invalidRepository = Array.from(uniqueRepositories).find((repository) => !REPOSITORY_FULL_NAME_PATTERN.test(repository));

  if (invalidRepository) {
    return fail("repository_allowlist", "Repository allowlist includes an invalid repository full name.", {
      invalidRepository
    });
  }

  return pass("repository_allowlist", "Repository allowlist is bounded and syntactically valid.", {
    count: uniqueRepositories.size
  });
}

function parseJsonObject(raw: string): unknown {
  return JSON.parse(raw);
}

function serviceName(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const service = record.service && typeof record.service === "object" ? (record.service as Record<string, unknown>) : null;
  const candidates = [record.name, record.serviceName, record.slug, service?.name, service?.serviceName, service?.slug];
  const candidate = candidates.find((item) => typeof item === "string" && item.trim());

  return typeof candidate === "string" ? candidate.trim() : null;
}

function serviceRole(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const candidates = [record.role, record.type, record.kind, record.serviceType];
  const candidate = candidates.find((item) => typeof item === "string" && item.trim());

  return typeof candidate === "string" ? candidate.trim().toLowerCase() : null;
}

function isTruthyRecordFlag(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true;
}

type AlternateProviderEvidence = {
  ok: boolean;
  provider: string | null;
  environment: string | null;
  serviceCount: number;
  errors: string[];
};

export type AlternateProviderEvidenceTemplate = {
  provider: string;
  environment: string;
  services: Array<{
    name: string;
    role: "web" | "worker";
  }>;
  database: {
    engine: "postgres";
    configured: boolean;
  };
  stableHttpsIngress: boolean;
  secretManagement: boolean;
  rollbackAuthority: string;
};

export function createAlternateProviderEvidenceTemplate(): AlternateProviderEvidenceTemplate {
  return {
    provider: "approved-provider-name",
    environment: "production-like",
    services: [
      {
        name: "agentic-web",
        role: "web"
      },
      {
        name: "agentic-worker",
        role: "worker"
      }
    ],
    database: {
      engine: "postgres",
      configured: true
    },
    stableHttpsIngress: true,
    secretManagement: true,
    rollbackAuthority: "platform-operator"
  };
}

function buildAlternateProviderEvidence(raw: string): AlternateProviderEvidence {
  let parsed: unknown;

  try {
    parsed = parseJsonObject(raw);
  } catch {
    return {
      ok: false,
      provider: null,
      environment: null,
      serviceCount: 0,
      errors: ["AGENTIC_DEPLOYMENT_PROVIDER_EVIDENCE_JSON must be valid JSON."]
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      provider: null,
      environment: null,
      serviceCount: 0,
      errors: ["AGENTIC_DEPLOYMENT_PROVIDER_EVIDENCE_JSON must be a JSON object."]
    };
  }

  const record = parsed as Record<string, unknown>;
  const provider = stringValue(record, "provider");
  const environment = stringValue(record, "environment");
  const services = arrayValue(record, "services");
  const serviceNames = services.map(serviceName).filter((name): name is string => Boolean(name));
  const serviceRoles = services.map(serviceRole).filter((role): role is string => Boolean(role));
  const hasWebService =
    serviceRoles.some((role) => role === "web") || serviceNames.some((name) => name === "agentic-web" || name.includes("agentic-web"));
  const hasWorkerService =
    serviceRoles.some((role) => role === "worker") ||
    serviceNames.some((name) => name === "agentic-worker" || name.includes("agentic-worker"));
  const database = record.database && typeof record.database === "object" ? (record.database as Record<string, unknown>) : null;
  const databaseEngine = database
    ? [database.engine, database.type, database.kind].find((value) => typeof value === "string" && value.trim())
    : null;
  const postgres =
    record.postgres === true ||
    (typeof databaseEngine === "string" && databaseEngine.toLowerCase().includes("postgres") && database.configured === true);
  const errors = [
    provider ? null : "provider must be set.",
    environment ? null : "environment must be set.",
    hasWebService ? null : "services must include a web service.",
    hasWorkerService ? null : "services must include a worker service.",
    postgres ? null : "postgres or a configured Postgres database must be proven.",
    isTruthyRecordFlag(record, "stableHttpsIngress") ? null : "stableHttpsIngress must be true.",
    isTruthyRecordFlag(record, "secretManagement") ? null : "secretManagement must be true.",
    stringValue(record, "rollbackAuthority") ? null : "rollbackAuthority must be set."
  ].filter((error): error is string => Boolean(error));

  return {
    ok: errors.length === 0,
    provider,
    environment,
    serviceCount: services.length,
    errors
  };
}

function buildProviderServicesCheck(env: NodeJS.ProcessEnv): GitHubAppSyncLivePreflightCheck {
  const alternateRaw = trim(env.AGENTIC_DEPLOYMENT_PROVIDER_EVIDENCE_JSON);
  const raw = trim(env.AGENTIC_RENDER_SERVICES_JSON);
  const alternate = alternateRaw ? buildAlternateProviderEvidence(alternateRaw) : null;

  if (alternate?.ok) {
    return pass("provider_services", "Alternate provider evidence proves deployed web and worker services.", {
      provider: alternate.provider,
      environment: alternate.environment,
      serviceCount: alternate.serviceCount
    });
  }

  if (raw) {
    let parsed: unknown;

    try {
      parsed = parseJsonObject(raw);
    } catch {
      return fail("provider_services", "AGENTIC_RENDER_SERVICES_JSON must contain JSON from `render services list --output json`.");
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return fail("provider_services", "Provider services evidence must include deployed Agentic web and worker services.", {
        provider: "render",
        alternateProviderErrors: alternate?.errors.join("; ") ?? null
      });
    }

    const names = parsed.map(serviceName).filter((name): name is string => Boolean(name));
    const missing = ["agentic-web", "agentic-worker"].filter(
      (expected) => !names.some((name) => name === expected || name.includes(expected))
    );

    if (missing.length > 0) {
      return fail("provider_services", "Provider services evidence is missing required Agentic services.", {
        provider: "render",
        missingNames: missing.join(","),
        alternateProviderErrors: alternate?.errors.join("; ") ?? null
      });
    }

    return pass("provider_services", "Render services list includes web and worker services.", {
      provider: "render",
      serviceCount: parsed.length
    });
  }

  return fail(
    "provider_services",
    "Set AGENTIC_RENDER_SERVICES_JSON or AGENTIC_DEPLOYMENT_PROVIDER_EVIDENCE_JSON to prove deployed web and worker services exist.",
    {
      alternateProviderErrors: alternate?.errors.join("; ") ?? null
    }
  );
}

function buildProviderConfigurationCheck(env: NodeJS.ProcessEnv): GitHubAppSyncLivePreflightCheck {
  const alternateRaw = trim(env.AGENTIC_DEPLOYMENT_PROVIDER_EVIDENCE_JSON);
  const raw = trim(env.AGENTIC_RENDER_BLUEPRINT_VALIDATION_JSON);
  const alternate = alternateRaw ? buildAlternateProviderEvidence(alternateRaw) : null;

  if (alternate?.ok) {
    return pass("provider_configuration", "Alternate provider evidence proves Postgres, stable ingress controls, secret management, and rollback authority.", {
      provider: alternate.provider,
      environment: alternate.environment
    });
  }

  if (raw) {
    let parsed: unknown;

    try {
      parsed = parseJsonObject(raw);
    } catch {
      return fail(
        "provider_configuration",
        "AGENTIC_RENDER_BLUEPRINT_VALIDATION_JSON must contain JSON from `render blueprints validate deploy/render/render.yaml --output json`."
      );
    }

    if (!parsed || typeof parsed !== "object") {
      return fail("provider_configuration", "Render Blueprint validation JSON must be an object.");
    }

    const record = parsed as Record<string, unknown>;
    const errors = Array.isArray(record.errors) ? record.errors : [];

    if (record.valid === false || errors.length > 0) {
      const firstError = errors.find((error) => error && typeof error === "object") as Record<string, unknown> | undefined;
      const errorCode = typeof firstError?.error === "string" ? firstError.error : "unknown";
      return fail("provider_configuration", "Provider configuration validation must pass before live sync validation.", {
        provider: "render",
        errorCount: errors.length,
        firstError: errorCode,
        alternateProviderErrors: alternate?.errors.join("; ") ?? null
      });
    }

    return pass("provider_configuration", "Render Blueprint validation passed.", { provider: "render", valid: true });
  }

  return fail(
    "provider_configuration",
    "Set AGENTIC_RENDER_BLUEPRINT_VALIDATION_JSON or AGENTIC_DEPLOYMENT_PROVIDER_EVIDENCE_JSON to prove provider configuration.",
    {
      alternateProviderErrors: alternate?.errors.join("; ") ?? null
    }
  );
}

function recordValue(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

function numberValue(record: Record<string, unknown>, key: string): number | null {
  const value = recordValue(record, key);

  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(record: Record<string, unknown>, key: string): string | null {
  const value = recordValue(record, key);

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanValue(record: Record<string, unknown>, key: string): boolean | null {
  const value = recordValue(record, key);

  return typeof value === "boolean" ? value : null;
}

function jsonEvidenceObject(env: NodeJS.ProcessEnv, envName: string): Record<string, unknown> | null {
  const raw = trim(env[envName]);

  if (!raw) {
    return null;
  }

  const parsed = parseJsonObject(raw);

  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
}

function arrayValue(record: Record<string, unknown>, key: string): unknown[] {
  const value = recordValue(record, key);

  return Array.isArray(value) ? value : [];
}

function checkNames(record: Record<string, unknown>): Set<string> {
  return new Set(
    arrayValue(record, "checks")
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }

        const name = (item as Record<string, unknown>).name;
        return typeof name === "string" ? name : null;
      })
      .filter((name): name is string => Boolean(name))
  );
}

function buildDeploymentSmokeCheck(env: NodeJS.ProcessEnv): GitHubAppSyncLivePreflightCheck {
  let parsed: Record<string, unknown> | null;

  try {
    parsed = jsonEvidenceObject(env, "AGENTIC_DEPLOYMENT_SMOKE_JSON");
  } catch {
    return fail(
      "deployment_smoke",
      "AGENTIC_DEPLOYMENT_SMOKE_JSON must contain JSON output from `npm run test:smoke:deployment`."
    );
  }

  if (!parsed) {
    return fail(
      "deployment_smoke",
      "Set AGENTIC_DEPLOYMENT_SMOKE_JSON from a passing `npm run test:smoke:deployment` run against the deployed origin."
    );
  }

  const healthStatus = stringValue(parsed, "healthStatus");
  const readinessStatus = stringValue(parsed, "readinessStatus");
  const sessionChecked = booleanValue(parsed, "sessionChecked");
  const names = checkNames(parsed);

  if (recordValue(parsed, "ok") !== true || healthStatus !== "live" || readinessStatus !== "ready") {
    return fail("deployment_smoke", "Deployment smoke evidence must prove live health and ready readiness.", {
      healthStatus,
      readinessStatus
    });
  }

  if (!names.has("health") || !names.has("readiness")) {
    return fail("deployment_smoke", "Deployment smoke evidence must include health and readiness checks.");
  }

  if (trim(env.AGENTIC_SMOKE_ACCESS_KEY) && sessionChecked !== true) {
    return fail("deployment_smoke", "Deployment smoke evidence must include authenticated session bootstrap when a smoke access key is configured.");
  }

  return pass("deployment_smoke", "Deployment smoke evidence proves health, readiness, and session bootstrap.", {
    healthStatus,
    readinessStatus,
    sessionChecked,
    checkCount: names.size
  });
}

function buildDeploymentAsyncCanaryCheck(env: NodeJS.ProcessEnv): GitHubAppSyncLivePreflightCheck {
  let parsed: Record<string, unknown> | null;

  try {
    parsed = jsonEvidenceObject(env, "AGENTIC_DEPLOYMENT_ASYNC_CANARY_JSON");
  } catch {
    return fail(
      "deployment_async_canary",
      "AGENTIC_DEPLOYMENT_ASYNC_CANARY_JSON must contain JSON output from `npm run test:smoke:deployment-async`."
    );
  }

  if (!parsed) {
    return fail(
      "deployment_async_canary",
      "Set AGENTIC_DEPLOYMENT_ASYNC_CANARY_JSON from a passing `npm run test:smoke:deployment-async` run against the deployed worker."
    );
  }

  const attempts = numberValue(parsed, "attempts");
  const jobId = stringValue(parsed, "jobId");
  const statusUrl = stringValue(parsed, "statusUrl");

  if (recordValue(parsed, "ok") !== true || !jobId || !statusUrl || attempts === null || attempts < 1) {
    return fail("deployment_async_canary", "Deployment async canary evidence must prove a queued job reached durable completion.", {
      attempts,
      hasJobId: Boolean(jobId),
      hasStatusUrl: Boolean(statusUrl)
    });
  }

  return pass("deployment_async_canary", "Deployment async canary evidence proves worker-backed job completion.", {
    attempts,
    hasJobId: true
  });
}

function buildGitHubAppSyncCanaryCheck(env: NodeJS.ProcessEnv): GitHubAppSyncLivePreflightCheck {
  let parsed: Record<string, unknown> | null;

  try {
    parsed = jsonEvidenceObject(env, "AGENTIC_GITHUB_APP_SYNC_CANARY_JSON");
  } catch {
    return fail(
      "github_app_sync_canary",
      "AGENTIC_GITHUB_APP_SYNC_CANARY_JSON must contain JSON output from `npm run test:smoke:github-app-sync`."
    );
  }

  if (!parsed) {
    return fail(
      "github_app_sync_canary",
      "Set AGENTIC_GITHUB_APP_SYNC_CANARY_JSON from a passing `npm run test:smoke:github-app-sync` run against the deployed sync route."
    );
  }

  const negativeAuthStatus = numberValue(parsed, "negativeAuthStatus");
  const repositories = arrayValue(parsed, "repositories");
  const jobs = arrayValue(parsed, "jobs");

  if (recordValue(parsed, "ok") !== true || negativeAuthStatus !== 401 || repositories.length === 0 || jobs.length === 0) {
    return fail("github_app_sync_canary", "GitHub App sync canary evidence must prove invalid auth, repository sync, and worker-settled jobs.", {
      negativeAuthStatus,
      repositoryCount: repositories.length,
      jobCount: jobs.length
    });
  }

  return pass("github_app_sync_canary", "GitHub App sync canary evidence proves invalid auth, repository sync, and worker-settled jobs.", {
    negativeAuthStatus,
    repositoryCount: repositories.length,
    jobCount: jobs.length
  });
}

function endpoint(origin: string | null, path: string): string | null {
  return origin ? `${origin}${path}` : null;
}

function safeReportUrl(raw: string | null, options: { originOnly?: boolean } = {}): string | null {
  if (!raw) {
    return null;
  }

  try {
    const url = new URL(raw);

    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";

    if (options.originOnly) {
      url.pathname = "/";
    }

    return options.originOnly ? url.origin : url.toString();
  } catch {
    return "[invalid-url]";
  }
}

export function validateGitHubAppSyncLivePreflight(env: NodeJS.ProcessEnv): GitHubAppSyncLivePreflightReport {
  const sync = parseSyncUrl(env);
  const checks = [
    ...sync.checks,
    buildStableHostCheck(sync.url),
    parseSmokeBaseUrl(env, sync.url),
    buildWorkflowStateCheck(env),
    buildGitHubActionsSecretInventoryCheck(env),
    buildRuntimeInventoryCheck(env),
    buildRuntimeShapeCheck(env),
    buildSmokeCanaryInventoryCheck(env),
    buildAllowlistCheck(env),
    buildProviderServicesCheck(env),
    buildProviderConfigurationCheck(env),
    buildDeploymentSmokeCheck(env),
    buildDeploymentAsyncCanaryCheck(env),
    buildGitHubAppSyncCanaryCheck(env)
  ];
  const smokeBaseUrl = trim(env.AGENTIC_SMOKE_BASE_URL) || trim(env.AGENTIC_INGRESS_BASE_URL) || null;
  const safeSmokeBaseUrl = safeReportUrl(smokeBaseUrl, { originOnly: true });
  const smokeOrigin = smokeBaseUrl ? (() => {
    try {
      return new URL(smokeBaseUrl).origin;
    } catch {
      return null;
    }
  })() : null;

  return {
    ok: checks.every((check) => check.status !== "fail"),
    syncUrl: safeReportUrl(sync.url?.toString() ?? null),
    smokeBaseUrl: safeSmokeBaseUrl,
    workflowState: trim(env.AGENTIC_GITHUB_APP_SYNC_WORKFLOW_STATE) || null,
    endpoints: {
      health: endpoint(smokeOrigin, "/api/health"),
      readiness: endpoint(smokeOrigin, "/api/ready"),
      sync: safeReportUrl(sync.url?.toString() ?? null)
    },
    checks
  };
}

export function redactGitHubAppSyncLivePreflightReport(
  report: GitHubAppSyncLivePreflightReport
): GitHubAppSyncLivePreflightReport {
  return report;
}

export const githubAppSyncLivePreflightRequiredRuntimeEnv: readonly RequiredRuntimeEnvName[] = REQUIRED_RUNTIME_ENV;
export const githubAppSyncLivePreflightRequiredCanaryEnv: readonly RequiredCanaryEnvName[] = REQUIRED_CANARY_ENV;
export const githubAppSyncLivePreflightRequiredGitHubActionsSecrets: readonly RequiredGitHubActionsSecretName[] =
  REQUIRED_GITHUB_ACTIONS_SECRETS;
export const githubAppSyncLivePreflightForbiddenGitHubActionsSecrets: readonly ForbiddenGitHubActionsSecretName[] =
  FORBIDDEN_GITHUB_ACTIONS_SECRETS;
