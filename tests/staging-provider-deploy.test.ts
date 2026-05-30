import { describe, expect, it } from "vitest";
import {
  buildProviderDeployEnv,
  parseDeployTimeoutMs,
  parseProviderDeployConfig
} from "../scripts/lib/staging-provider-deploy";

describe("staging provider deploy config", () => {
  it("parses a provider command with structured arguments", () => {
    const config = parseProviderDeployConfig({
      AGENTIC_STAGING_DEPLOY_BIN: "node",
      AGENTIC_STAGING_DEPLOY_ARGS_JSON: JSON.stringify(["scripts/deploy.mjs", "--env", "staging"])
    }, { requireConfig: true });

    expect(config).toEqual({
      command: "node",
      args: ["scripts/deploy.mjs", "--env", "staging"]
    });
  });

  it("returns null when provider deploy configuration is omitted and not required", () => {
    expect(parseProviderDeployConfig({}, { requireConfig: false })).toBeNull();
  });

  it("rejects a missing provider command when configuration is required", () => {
    expect(() => parseProviderDeployConfig({}, { requireConfig: true })).toThrow(
      "AGENTIC_STAGING_DEPLOY_BIN must be configured."
    );
  });

  it("rejects malformed JSON for provider arguments", () => {
    expect(() =>
      parseProviderDeployConfig({
        AGENTIC_STAGING_DEPLOY_BIN: "node",
        AGENTIC_STAGING_DEPLOY_ARGS_JSON: "[not-json"
      }, { requireConfig: true })
    ).toThrow("AGENTIC_STAGING_DEPLOY_ARGS_JSON must be valid JSON.");
  });

  it("rejects non-string provider arguments", () => {
    expect(() =>
      parseProviderDeployConfig({
        AGENTIC_STAGING_DEPLOY_BIN: "node",
        AGENTIC_STAGING_DEPLOY_ARGS_JSON: JSON.stringify(["deploy.mjs", 42])
      }, { requireConfig: true })
    ).toThrow("AGENTIC_STAGING_DEPLOY_ARGS_JSON[1] must be a string.");
  });

  it("rejects arbitrary deploy binaries outside the supported command allowlist", () => {
    expect(() =>
      parseProviderDeployConfig({
        AGENTIC_STAGING_DEPLOY_BIN: "curl",
        AGENTIC_STAGING_DEPLOY_ARGS_JSON: JSON.stringify(["https://attacker.example"])
      }, { requireConfig: true })
    ).toThrow("AGENTIC_STAGING_DEPLOY_BIN must name a supported deploy command.");

    expect(() =>
      parseProviderDeployConfig({
        AGENTIC_STAGING_DEPLOY_BIN: "/tmp/deploy"
      }, { requireConfig: true })
    ).toThrow("AGENTIC_STAGING_DEPLOY_BIN must be a supported command name without path separators.");
  });

  it("passes only staging deploy related environment to provider commands", () => {
    expect(buildProviderDeployEnv({
      PATH: "/usr/bin",
      AGENTIC_ACCESS_KEY: "agentic-key",
      STAGING_SMOKE_ACCESS_KEY: "smoke-key",
      RENDER_API_KEY: "render-token",
      UNRELATED_SECRET: "do-not-pass",
      LOCAL_DEBUG_FLAG: "do-not-pass"
    })).toEqual({
      PATH: "/usr/bin",
      AGENTIC_ACCESS_KEY: "agentic-key",
      STAGING_SMOKE_ACCESS_KEY: "smoke-key",
      RENDER_API_KEY: "render-token"
    });
  });

  it("parses an explicit deploy timeout", () => {
    expect(parseDeployTimeoutMs({
      AGENTIC_STAGING_DEPLOY_TIMEOUT_MS: "45000"
    })).toBe(45000);
  });

  it("rejects an invalid deploy timeout", () => {
    expect(() => parseDeployTimeoutMs({
      AGENTIC_STAGING_DEPLOY_TIMEOUT_MS: "0"
    })).toThrow("AGENTIC_STAGING_DEPLOY_TIMEOUT_MS must be a positive integer when configured.");
  });
});
