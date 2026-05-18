const DEFAULT_SELF_TEST_DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:5432/agentic";
const DEFAULT_SELF_TEST_BASE_URL = "http://127.0.0.1:3301";
const DEFAULT_SELF_TEST_ACCESS_KEY = "agentic-staging-self-test-key";
const DEFAULT_DEPLOY_TIMEOUT_MS = "180000";
const DEFAULT_DEPLOY_COMMAND = "node";
const DEFAULT_DEPLOY_ARGS = JSON.stringify(["--import", "tsx", "scripts/staging-self-test.ts"]);

const EXTERNAL_REQUIREMENTS = [
  ["DATABASE_URL", "STAGING_DATABASE_URL"],
  ["AGENTIC_ACCESS_KEY", "STAGING_AGENTIC_ACCESS_KEY"],
  ["AGENTIC_INGRESS_PROVIDER", "STAGING_INGRESS_PROVIDER"],
  ["AGENTIC_INGRESS_ENVIRONMENT", "STAGING_INGRESS_ENVIRONMENT"],
  ["AGENTIC_INGRESS_ROLLOUT_MODE", "STAGING_INGRESS_ROLLOUT_MODE"],
  ["AGENTIC_INGRESS_ROLLBACK_AUTHORITY", "STAGING_INGRESS_ROLLBACK_AUTHORITY"],
  ["AGENTIC_SMOKE_BASE_URL", "STAGING_BASE_URL"],
  ["AGENTIC_SMOKE_ACCESS_KEY", "STAGING_SMOKE_ACCESS_KEY"],
  ["AGENTIC_TRUST_PROXY_HEADERS", "STAGING_TRUST_PROXY_HEADERS"],
  ["AGENTIC_PROXY_HEADER_OVERWRITE_CONFIRMED", "STAGING_PROXY_HEADER_OVERWRITE_CONFIRMED"],
  ["AGENTIC_TRUSTED_CLIENT_IP_HEADER", "STAGING_TRUSTED_CLIENT_IP_HEADER"],
  ["AGENTIC_STAGING_DEPLOY_BIN", "STAGING_DEPLOY_BIN"]
] as const;

export type StagingExecutionPlan = {
  mode: "external" | "self-test";
  missingExternalConfig: string[];
  injectedEnv: Record<string, string>;
};

function trim(value: string | undefined): string {
  return value?.trim() ?? "";
}

export function resolveStagingExecutionPlan(env: NodeJS.ProcessEnv): StagingExecutionPlan {
  const missingExternalConfig = EXTERNAL_REQUIREMENTS.flatMap(([key, label]) => (trim(env[key]) ? [] : [label]));

  if (missingExternalConfig.length === 0) {
    return {
      mode: "external",
      missingExternalConfig,
      injectedEnv: {}
    };
  }

  return {
    mode: "self-test",
    missingExternalConfig,
    injectedEnv: {
      DATABASE_URL: DEFAULT_SELF_TEST_DATABASE_URL,
      AGENTIC_ACCESS_KEY: DEFAULT_SELF_TEST_ACCESS_KEY,
      AGENTIC_INGRESS_PROVIDER: "runner-local",
      AGENTIC_INGRESS_ENVIRONMENT: "staging",
      AGENTIC_INGRESS_ROLLOUT_MODE: "manual-only",
      AGENTIC_INGRESS_ROLLBACK_AUTHORITY: "github-actions",
      AGENTIC_SMOKE_BASE_URL: DEFAULT_SELF_TEST_BASE_URL,
      AGENTIC_SMOKE_ACCESS_KEY: DEFAULT_SELF_TEST_ACCESS_KEY,
      AGENTIC_ALLOW_PROCESS_LOCAL_AUTH_STATE: "true",
      AGENTIC_TRUST_PROXY_HEADERS: "true",
      AGENTIC_PROXY_HEADER_OVERWRITE_CONFIRMED: "true",
      AGENTIC_TRUSTED_CLIENT_IP_HEADER: "x-forwarded-for",
      AGENTIC_REQUIRE_SHARED_AUTH_STATE: "false",
      AGENTIC_STAGING_DEPLOY_BIN: DEFAULT_DEPLOY_COMMAND,
      AGENTIC_STAGING_DEPLOY_ARGS_JSON: DEFAULT_DEPLOY_ARGS,
      AGENTIC_STAGING_DEPLOY_TIMEOUT_MS: trim(env.AGENTIC_STAGING_DEPLOY_TIMEOUT_MS) || DEFAULT_DEPLOY_TIMEOUT_MS
    }
  };
}
