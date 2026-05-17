import { describe, expect, it, afterEach } from "vitest";
import {
  getRequestClientIdentity,
  getRequestIdentityRuntimeStatus
} from "../apps/web/lib/request-client-identity";

describe("request client identity", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalTrustProxyHeaders = process.env.AGENTIC_TRUST_PROXY_HEADERS;
  const originalTrustedClientIpHeader = process.env.AGENTIC_TRUSTED_CLIENT_IP_HEADER;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.AGENTIC_TRUST_PROXY_HEADERS = originalTrustProxyHeaders;
    process.env.AGENTIC_TRUSTED_CLIENT_IP_HEADER = originalTrustedClientIpHeader;
  });

  function buildRequest(headers: Record<string, string> = {}): Request {
    return new Request("https://agentic.example.com/api/session", {
      method: "POST",
      headers: {
        "user-agent": "Agentic Test Client",
        "accept-language": "en-SG,en;q=0.9",
        ...headers
      }
    });
  }

  it("falls back to request fingerprinting unless proxy trust and a canonical header are both configured", () => {
    const request = buildRequest({
      "x-forwarded-for": "203.0.113.10",
      "cf-connecting-ip": "203.0.113.11",
      "x-real-ip": "203.0.113.12"
    });

    expect(getRequestClientIdentity(request)).toMatchObject({
      source: "request-fingerprint"
    });

    process.env.AGENTIC_TRUST_PROXY_HEADERS = "true";

    expect(getRequestClientIdentity(request)).toMatchObject({
      source: "request-fingerprint"
    });
  });

  it("trusts only the configured x-forwarded-for first hop and ignores alternate spoofed headers", () => {
    process.env.AGENTIC_TRUST_PROXY_HEADERS = "true";
    process.env.AGENTIC_TRUSTED_CLIENT_IP_HEADER = "x-forwarded-for";

    expect(
      getRequestClientIdentity(
        buildRequest({
          "x-forwarded-for": "203.0.113.10, 198.51.100.8",
          "cf-connecting-ip": "198.51.100.99",
          "x-real-ip": "198.51.100.100"
        })
      )
    ).toEqual({
      key: "ip:203.0.113.10",
      source: "trusted-ip"
    });
  });

  it("trusts only the configured cf-connecting-ip header and ignores forwarded-for spoofing", () => {
    process.env.AGENTIC_TRUST_PROXY_HEADERS = "true";
    process.env.AGENTIC_TRUSTED_CLIENT_IP_HEADER = "cf-connecting-ip";

    expect(
      getRequestClientIdentity(
        buildRequest({
          "x-forwarded-for": "198.51.100.99",
          "cf-connecting-ip": "203.0.113.15",
          "x-real-ip": "198.51.100.100"
        })
      )
    ).toEqual({
      key: "ip:203.0.113.15",
      source: "trusted-ip"
    });
  });

  it("trusts only the configured x-real-ip header and ignores other forwarded headers", () => {
    process.env.AGENTIC_TRUST_PROXY_HEADERS = "true";
    process.env.AGENTIC_TRUSTED_CLIENT_IP_HEADER = "x-real-ip";

    expect(
      getRequestClientIdentity(
        buildRequest({
          "x-forwarded-for": "198.51.100.99",
          "cf-connecting-ip": "198.51.100.100",
          "x-real-ip": "203.0.113.20"
        })
      )
    ).toEqual({
      key: "ip:203.0.113.20",
      source: "trusted-ip"
    });
  });

  it("falls back when the configured trusted client IP header is unsupported or malformed", () => {
    process.env.AGENTIC_TRUST_PROXY_HEADERS = "true";
    process.env.AGENTIC_TRUSTED_CLIENT_IP_HEADER = "x-client-ip";

    expect(
      getRequestClientIdentity(
        buildRequest({
          "x-client-ip": "203.0.113.10",
          "x-forwarded-for": "203.0.113.11"
        })
      )
    ).toMatchObject({
      source: "request-fingerprint"
    });

    process.env.AGENTIC_TRUSTED_CLIENT_IP_HEADER = "x-forwarded-for";

    expect(
      getRequestClientIdentity(
        buildRequest({
          "x-forwarded-for": "not-an-ip, 203.0.113.11"
        })
      )
    ).toMatchObject({
      source: "request-fingerprint"
    });
  });

  it("reports the production readiness contract for trusted client IP headers", () => {
    process.env.NODE_ENV = "production";
    process.env.AGENTIC_TRUST_PROXY_HEADERS = "true";

    expect(getRequestIdentityRuntimeStatus()).toEqual({
      production: true,
      trustProxyHeaders: true,
      trustedClientIpHeader: null,
      identitySource: "request-fingerprint",
      warnings: [
        "Trusted proxy headers are enabled, but AGENTIC_TRUSTED_CLIENT_IP_HEADER must name one canonical client-IP header."
      ]
    });

    process.env.AGENTIC_TRUSTED_CLIENT_IP_HEADER = "CF-Connecting-IP";

    expect(getRequestIdentityRuntimeStatus()).toEqual({
      production: true,
      trustProxyHeaders: true,
      trustedClientIpHeader: "cf-connecting-ip",
      identitySource: "trusted-ip",
      warnings: []
    });
  });
});
