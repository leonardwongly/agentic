import { describe, expect, it } from "vitest";
import { validateStableIngressConfig } from "../scripts/lib/stable-ingress-config";

const BASE_ENV = {
  NODE_ENV: "production",
  AGENTIC_INGRESS_PROVIDER: "render",
  AGENTIC_INGRESS_ENVIRONMENT: "production-like",
  AGENTIC_INGRESS_ROLLOUT_MODE: "manual-only",
  AGENTIC_INGRESS_ROLLBACK_AUTHORITY: "platform-operator",
  AGENTIC_SMOKE_BASE_URL: "https://staging.agentic.example.com",
  AGENTIC_SMOKE_ACCESS_KEY: "smoke-key",
  AGENTIC_TRUST_PROXY_HEADERS: "true",
  AGENTIC_PROXY_HEADER_OVERWRITE_CONFIRMED: "true",
  AGENTIC_TRUSTED_CLIENT_IP_HEADER: "x-forwarded-for",
  AGENTIC_STAGING_DEPLOY_BIN: "node",
  AGENTIC_STAGING_DEPLOY_ARGS_JSON: JSON.stringify(["scripts/provider-deploy.mjs"])
};

describe("stable ingress config", () => {
  it("accepts a stable HTTPS origin with production proxy trust and provider deploy wiring", () => {
    const report = validateStableIngressConfig(BASE_ENV);

    expect(report.ok).toBe(true);
    expect(report.provider).toBe("render");
    expect(report.environment).toBe("production-like");
    expect(report.rolloutMode).toBe("manual-only");
    expect(report.baseUrl).toBe("https://staging.agentic.example.com");
    expect(report.endpoints).toEqual({
      health: "https://staging.agentic.example.com/api/health",
      readiness: "https://staging.agentic.example.com/api/ready",
      session: "https://staging.agentic.example.com/api/session"
    });
    expect(report.checks.map((check) => [check.name, check.status])).toEqual([
      ["base_url", "pass"],
      ["host_stability", "pass"],
      ["deployment_target", "pass"],
      ["runtime", "pass"],
      ["proxy_trust", "pass"],
      ["proxy_header_overwrite", "pass"],
      ["client_ip_header", "pass"],
      ["rollout_mode", "pass"],
      ["rollback_authority", "pass"],
      ["provider_deploy", "pass"],
      ["smoke_session", "pass"]
    ]);
  });

  it("rejects temporary tunnel hosts", () => {
    const report = validateStableIngressConfig({
      ...BASE_ENV,
      AGENTIC_SMOKE_BASE_URL: "https://agentic-demo.ngrok-free.app"
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "host_stability",
        status: "fail",
        message: "Stable ingress must not use a temporary tunnel domain."
      })
    );
  });

  it("rejects local and private ingress hosts", () => {
    const report = validateStableIngressConfig({
      ...BASE_ENV,
      AGENTIC_SMOKE_BASE_URL: "https://127.0.0.1"
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "host_stability",
        status: "fail",
        message: "Stable ingress must be reachable through a non-local DNS host."
      })
    );
  });

  it("rejects non-HTTPS origins and embedded URL credentials", () => {
    const report = validateStableIngressConfig({
      ...BASE_ENV,
      AGENTIC_SMOKE_BASE_URL: "http://deploy-user:secret@staging.agentic.example.com"
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "base_url",
        status: "fail",
        message: "Stable ingress URL must use HTTPS."
      })
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "base_url",
        status: "fail",
        message: "Stable ingress URL must not embed credentials."
      })
    );
  });

  it("rejects path, query, and fragment components so smoke checks hit the canonical origin", () => {
    const report = validateStableIngressConfig({
      ...BASE_ENV,
      AGENTIC_SMOKE_BASE_URL: "https://staging.agentic.example.com/app?token=secret#ready"
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "base_url",
        status: "fail",
        message: "Stable ingress URL must be an origin without path, query, or fragment."
      })
    );
  });

  it("requires explicit production proxy trust and a smoke access key", () => {
    const report = validateStableIngressConfig({
      ...BASE_ENV,
      NODE_ENV: "development",
      AGENTIC_TRUST_PROXY_HEADERS: "false",
      AGENTIC_SMOKE_ACCESS_KEY: ""
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "runtime",
        status: "fail"
      })
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "proxy_trust",
        status: "fail"
      })
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "smoke_session",
        status: "fail"
      })
    );
  });

  it("fails closed when provider deploy configuration is missing", () => {
    const report = validateStableIngressConfig({
      NODE_ENV: "production",
      AGENTIC_INGRESS_PROVIDER: "render",
      AGENTIC_INGRESS_ENVIRONMENT: "production-like",
      AGENTIC_INGRESS_ROLLOUT_MODE: "manual-only",
      AGENTIC_INGRESS_ROLLBACK_AUTHORITY: "platform-operator",
      AGENTIC_SMOKE_BASE_URL: "https://staging.agentic.example.com",
      AGENTIC_SMOKE_ACCESS_KEY: "smoke-key",
      AGENTIC_TRUST_PROXY_HEADERS: "true",
      AGENTIC_PROXY_HEADER_OVERWRITE_CONFIRMED: "true",
      AGENTIC_TRUSTED_CLIENT_IP_HEADER: "x-forwarded-for"
    });

    expect(report.ok).toBe(false);
    expect(report.providerDeployConfigured).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "provider_deploy",
        status: "fail",
        message: "AGENTIC_STAGING_DEPLOY_BIN must be configured."
      })
    );
  });

  it("requires an explicit supported client IP header contract", () => {
    const missing = validateStableIngressConfig({
      ...BASE_ENV,
      AGENTIC_TRUSTED_CLIENT_IP_HEADER: ""
    });

    expect(missing.ok).toBe(false);
    expect(missing.checks).toContainEqual(
      expect.objectContaining({
        name: "client_ip_header",
        status: "fail",
        message: "Set AGENTIC_TRUSTED_CLIENT_IP_HEADER to the one ingress-overwritten client-IP header."
      })
    );

    const unsupported = validateStableIngressConfig({
      ...BASE_ENV,
      AGENTIC_TRUSTED_CLIENT_IP_HEADER: "x-client-ip"
    });

    expect(unsupported.ok).toBe(false);
    expect(unsupported.checks).toContainEqual(
      expect.objectContaining({
        name: "client_ip_header",
        status: "fail",
        message: "Trusted client-IP header must be one of the supported canonical headers."
      })
    );
  });

  it("requires target identity, proxy overwrite evidence, rollout mode, and rollback authority", () => {
    const report = validateStableIngressConfig({
      ...BASE_ENV,
      AGENTIC_INGRESS_PROVIDER: "",
      AGENTIC_INGRESS_ENVIRONMENT: "sandbox",
      AGENTIC_PROXY_HEADER_OVERWRITE_CONFIRMED: "false",
      AGENTIC_INGRESS_ROLLOUT_MODE: "automatic",
      AGENTIC_INGRESS_ROLLBACK_AUTHORITY: ""
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "deployment_target",
        status: "fail",
        message: "Set AGENTIC_INGRESS_PROVIDER and AGENTIC_INGRESS_ENVIRONMENT for the approved target."
      })
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "proxy_header_overwrite",
        status: "fail",
        message: "Set AGENTIC_PROXY_HEADER_OVERWRITE_CONFIRMED=true only after the provider overwrites the configured client-IP header."
      })
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "rollout_mode",
        status: "fail",
        message: "AGENTIC_INGRESS_ROLLOUT_MODE must be manual-only, scheduled-disabled, or scheduled-enabled."
      })
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "rollback_authority",
        status: "fail",
        message: "Set AGENTIC_INGRESS_ROLLBACK_AUTHORITY to the operator or team allowed to roll back."
      })
    );
  });
});
