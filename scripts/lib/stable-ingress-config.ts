import { isIP } from "node:net";
import { parseProviderDeployConfig } from "./staging-provider-deploy";

const TEMPORARY_INGRESS_DOMAINS = [
  "ngrok.io",
  "ngrok-free.app",
  "ngrok.app",
  "trycloudflare.com",
  "loca.lt",
  "localhost.run",
  "devtunnels.ms",
  "serveo.net",
  "tunnelmole.net"
];

const TRUSTED_CLIENT_IP_HEADERS = new Set(["cf-connecting-ip", "x-forwarded-for", "x-real-ip"]);
const STABLE_INGRESS_ENVIRONMENTS = new Set(["staging", "production-like", "production"]);
const ROLLOUT_MODES = new Set(["manual-only", "scheduled-disabled", "scheduled-enabled"]);

export type StableIngressCheck = {
  name:
    | "base_url"
    | "host_stability"
    | "deployment_target"
    | "runtime"
    | "proxy_trust"
    | "proxy_header_overwrite"
    | "client_ip_header"
    | "rollout_mode"
    | "rollback_authority"
    | "provider_deploy"
    | "smoke_session";
  status: "pass" | "warn" | "fail";
  message: string;
  details?: Record<string, string | boolean | number | null>;
};

export type StableIngressReport = {
  ok: boolean;
  targetName: string;
  provider: string | null;
  environment: string | null;
  rolloutMode: string | null;
  baseUrl: string | null;
  host: string | null;
  providerDeployConfigured: boolean;
  endpoints: {
    health: string | null;
    readiness: string | null;
    session: string | null;
  };
  checks: StableIngressCheck[];
};

function trim(value: string | undefined): string {
  return value?.trim() ?? "";
}

function isTrue(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
}

function domainMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function isTemporaryIngressHost(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return TEMPORARY_INGRESS_DOMAINS.some((domain) => domainMatches(normalized, domain));
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

function isSingleLabelHost(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return isIP(normalized) === 0 && !normalized.includes(".");
}

function appendEndpoint(origin: string, pathname: string): string {
  return `${origin}${pathname}`;
}

function fail(name: StableIngressCheck["name"], message: string, details?: StableIngressCheck["details"]): StableIngressCheck {
  return {
    name,
    status: "fail",
    message,
    details
  };
}

function warn(name: StableIngressCheck["name"], message: string, details?: StableIngressCheck["details"]): StableIngressCheck {
  return {
    name,
    status: "warn",
    message,
    details
  };
}

function pass(name: StableIngressCheck["name"], message: string, details?: StableIngressCheck["details"]): StableIngressCheck {
  return {
    name,
    status: "pass",
    message,
    details
  };
}

function parseStableBaseUrl(env: NodeJS.ProcessEnv): {
  url: URL | null;
  checks: StableIngressCheck[];
} {
  const raw = trim(env.AGENTIC_INGRESS_BASE_URL) || trim(env.AGENTIC_SMOKE_BASE_URL);

  if (!raw) {
    return {
      url: null,
      checks: [
        fail(
          "base_url",
          "Set AGENTIC_SMOKE_BASE_URL or AGENTIC_INGRESS_BASE_URL to the stable HTTPS ingress origin."
        )
      ]
    };
  }

  let parsed: URL;

  try {
    parsed = new URL(raw);
  } catch {
    return {
      url: null,
      checks: [fail("base_url", "Stable ingress URL must be a valid absolute URL.")]
    };
  }

  const checks: StableIngressCheck[] = [];

  if (parsed.protocol !== "https:") {
    checks.push(fail("base_url", "Stable ingress URL must use HTTPS.", { protocol: parsed.protocol.replace(/:$/, "") }));
  }

  if (parsed.username || parsed.password) {
    checks.push(fail("base_url", "Stable ingress URL must not embed credentials."));
  }

  if ((parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) {
    checks.push(fail("base_url", "Stable ingress URL must be an origin without path, query, or fragment."));
  }

  if (checks.length === 0) {
    checks.push(pass("base_url", "Stable ingress origin is syntactically valid.", { scheme: "https" }));
  }

  return {
    url: parsed,
    checks
  };
}

function buildHostStabilityCheck(url: URL | null): StableIngressCheck {
  if (!url) {
    return fail("host_stability", "Stable ingress host cannot be checked until the ingress URL is valid.");
  }

  const hostname = normalizeHostname(url.hostname);

  if (isTemporaryIngressHost(hostname)) {
    return fail("host_stability", "Stable ingress must not use a temporary tunnel domain.", { host: hostname });
  }

  if (isLocalOrPrivateHost(hostname)) {
    return fail("host_stability", "Stable ingress must be reachable through a non-local DNS host.", { host: hostname });
  }

  if (isSingleLabelHost(hostname)) {
    return warn("host_stability", "Stable ingress host is single-label; confirm it resolves from GitHub-hosted runners.", {
      host: hostname
    });
  }

  return pass("host_stability", "Stable ingress host is not a known temporary tunnel or local address.", { host: hostname });
}

function buildRuntimeCheck(env: NodeJS.ProcessEnv): StableIngressCheck {
  if (trim(env.NODE_ENV) !== "production") {
    return fail("runtime", "External stable ingress validation must run with NODE_ENV=production.");
  }

  return pass("runtime", "Production runtime mode is selected.");
}

function buildDeploymentTargetCheck(env: NodeJS.ProcessEnv): StableIngressCheck {
  const provider = trim(env.AGENTIC_INGRESS_PROVIDER).toLowerCase();
  const environment = trim(env.AGENTIC_INGRESS_ENVIRONMENT).toLowerCase();

  if (!provider || !environment) {
    return fail("deployment_target", "Set AGENTIC_INGRESS_PROVIDER and AGENTIC_INGRESS_ENVIRONMENT for the approved target.");
  }

  if (!STABLE_INGRESS_ENVIRONMENTS.has(environment)) {
    return fail("deployment_target", "AGENTIC_INGRESS_ENVIRONMENT must be staging, production-like, or production.", {
      environment
    });
  }

  return pass("deployment_target", "Approved provider and target environment are explicit.", {
    provider,
    environment
  });
}

function buildProxyTrustCheck(env: NodeJS.ProcessEnv): StableIngressCheck {
  if (!isTrue(env.AGENTIC_TRUST_PROXY_HEADERS)) {
    return fail(
      "proxy_trust",
      "Set AGENTIC_TRUST_PROXY_HEADERS=true only after confirming the ingress proxy overwrites forwarded client-IP headers."
    );
  }

  return pass("proxy_trust", "Trusted proxy headers are explicitly enabled for this ingress.");
}

function buildProxyHeaderOverwriteCheck(env: NodeJS.ProcessEnv): StableIngressCheck {
  if (!isTrue(env.AGENTIC_PROXY_HEADER_OVERWRITE_CONFIRMED)) {
    return fail(
      "proxy_header_overwrite",
      "Set AGENTIC_PROXY_HEADER_OVERWRITE_CONFIRMED=true only after the provider overwrites the configured client-IP header."
    );
  }

  return pass("proxy_header_overwrite", "Ingress proxy header overwrite behavior is explicitly confirmed.");
}

function buildTrustedClientIpHeaderCheck(env: NodeJS.ProcessEnv): StableIngressCheck {
  const configured = trim(env.AGENTIC_TRUSTED_CLIENT_IP_HEADER).toLowerCase();

  if (!configured) {
    return fail(
      "client_ip_header",
      "Set AGENTIC_TRUSTED_CLIENT_IP_HEADER to the one ingress-overwritten client-IP header."
    );
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

function buildRolloutModeCheck(env: NodeJS.ProcessEnv): StableIngressCheck {
  const rolloutMode = trim(env.AGENTIC_INGRESS_ROLLOUT_MODE).toLowerCase();

  if (!rolloutMode) {
    return fail("rollout_mode", "Set AGENTIC_INGRESS_ROLLOUT_MODE before validating stable ingress.");
  }

  if (!ROLLOUT_MODES.has(rolloutMode)) {
    return fail("rollout_mode", "AGENTIC_INGRESS_ROLLOUT_MODE must be manual-only, scheduled-disabled, or scheduled-enabled.", {
      rolloutMode
    });
  }

  return pass("rollout_mode", "Ingress rollout mode is explicit.", {
    rolloutMode
  });
}

function buildRollbackAuthorityCheck(env: NodeJS.ProcessEnv): StableIngressCheck {
  if (!trim(env.AGENTIC_INGRESS_ROLLBACK_AUTHORITY)) {
    return fail("rollback_authority", "Set AGENTIC_INGRESS_ROLLBACK_AUTHORITY to the operator or team allowed to roll back.");
  }

  return pass("rollback_authority", "Ingress rollback authority is explicit.");
}

function buildProviderDeployCheck(env: NodeJS.ProcessEnv): {
  check: StableIngressCheck;
  configured: boolean;
} {
  try {
    const config = parseProviderDeployConfig(env, { requireConfig: true });

    if (!config) {
      throw new Error("AGENTIC_STAGING_DEPLOY_BIN must be configured.");
    }

    return {
      configured: true,
      check: pass("provider_deploy", "Provider deploy command is configured.", { args: config.args.length })
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Provider deploy command is not configured safely.";

    return {
      configured: false,
      check: fail("provider_deploy", message)
    };
  }
}

function buildSmokeSessionCheck(env: NodeJS.ProcessEnv): StableIngressCheck {
  if (!trim(env.AGENTIC_SMOKE_ACCESS_KEY)) {
    return fail("smoke_session", "Set AGENTIC_SMOKE_ACCESS_KEY so deployment smoke can verify authenticated session bootstrap.");
  }

  return pass("smoke_session", "Deployment smoke access key is configured.");
}

export function validateStableIngressConfig(env: NodeJS.ProcessEnv = process.env): StableIngressReport {
  const targetName = trim(env.AGENTIC_INGRESS_TARGET_NAME) || "staging";
  const provider = trim(env.AGENTIC_INGRESS_PROVIDER).toLowerCase() || null;
  const environment = trim(env.AGENTIC_INGRESS_ENVIRONMENT).toLowerCase() || null;
  const rolloutMode = trim(env.AGENTIC_INGRESS_ROLLOUT_MODE).toLowerCase() || null;
  const { url, checks: baseUrlChecks } = parseStableBaseUrl(env);
  const providerDeploy = buildProviderDeployCheck(env);
  const origin = url?.origin ?? null;
  const allChecks: StableIngressCheck[] = [
    ...baseUrlChecks,
    buildHostStabilityCheck(url),
    buildDeploymentTargetCheck(env),
    buildRuntimeCheck(env),
    buildProxyTrustCheck(env),
    buildProxyHeaderOverwriteCheck(env),
    buildTrustedClientIpHeaderCheck(env),
    buildRolloutModeCheck(env),
    buildRollbackAuthorityCheck(env),
    providerDeploy.check,
    buildSmokeSessionCheck(env)
  ];

  return {
    ok: allChecks.every((check) => check.status !== "fail"),
    targetName,
    provider,
    environment,
    rolloutMode,
    baseUrl: origin,
    host: url ? normalizeHostname(url.hostname) : null,
    providerDeployConfigured: providerDeploy.configured,
    endpoints: {
      health: origin ? appendEndpoint(origin, "/api/health") : null,
      readiness: origin ? appendEndpoint(origin, "/api/ready") : null,
      session: origin ? appendEndpoint(origin, "/api/session") : null
    },
    checks: allChecks
  };
}
