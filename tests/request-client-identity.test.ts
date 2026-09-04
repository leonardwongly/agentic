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

  describe("adversarial request identity edge cases", () => {
    it("handles IPv6 addresses in x-forwarded-for correctly", () => {
      process.env.AGENTIC_TRUST_PROXY_HEADERS = "true";
      process.env.AGENTIC_TRUSTED_CLIENT_IP_HEADER = "x-forwarded-for";

      const identity = getRequestClientIdentity(
        buildRequest({
          "x-forwarded-for": "2001:db8::1, 198.51.100.8"
        })
      );

      expect(identity).toEqual({
        key: "ip:2001:db8::1",
        source: "trusted-ip"
      });
    });

    it("handles bracketed IPv6 with port in proxy headers", () => {
      process.env.AGENTIC_TRUST_PROXY_HEADERS = "true";
      process.env.AGENTIC_TRUSTED_CLIENT_IP_HEADER = "x-forwarded-for";

      const identity = getRequestClientIdentity(
        buildRequest({
          "x-forwarded-for": "[2001:db8::1]:8080"
        })
      );

      expect(identity).toEqual({
        key: "ip:2001:db8::1",
        source: "trusted-ip"
      });
    });

    it("handles IPv4-mapped IPv6 addresses (::ffff: prefix)", () => {
      process.env.AGENTIC_TRUST_PROXY_HEADERS = "true";
      process.env.AGENTIC_TRUSTED_CLIENT_IP_HEADER = "x-forwarded-for";

      const identity = getRequestClientIdentity(
        buildRequest({
          "x-forwarded-for": "::ffff:192.168.1.1"
        })
      );

      expect(identity).toEqual({
        key: "ip:192.168.1.1",
        source: "trusted-ip"
      });
    });

    it("strips zone IDs from IPv6 addresses", () => {
      process.env.AGENTIC_TRUST_PROXY_HEADERS = "true";
      process.env.AGENTIC_TRUSTED_CLIENT_IP_HEADER = "x-forwarded-for";

      const identity = getRequestClientIdentity(
        buildRequest({
          "x-forwarded-for": "fe80::1%eth0"
        })
      );

      expect(identity).toEqual({
        key: "ip:fe80::1",
        source: "trusted-ip"
      });
    });

    it("falls back to fingerprint when all proxy IPs are invalid", () => {
      process.env.AGENTIC_TRUST_PROXY_HEADERS = "true";
      process.env.AGENTIC_TRUSTED_CLIENT_IP_HEADER = "x-forwarded-for";

      const identity = getRequestClientIdentity(
        buildRequest({
          "x-forwarded-for": "invalid, also-invalid, still-not-an-ip"
        })
      );

      expect(identity.source).toBe("request-fingerprint");
    });

    it("produces stable fingerprints for identical requests", () => {
      const request1 = buildRequest();
      const request2 = buildRequest();

      expect(getRequestClientIdentity(request1).key).toBe(getRequestClientIdentity(request2).key);
    });

    it("produces different fingerprints for different user agents", () => {
      const request1 = buildRequest({ "user-agent": "Chrome/120" });
      const request2 = buildRequest({ "user-agent": "Firefox/121" });

      expect(getRequestClientIdentity(request1).key).not.toBe(getRequestClientIdentity(request2).key);
    });

    it("truncates extremely long user-agent strings for fingerprint stability", () => {
      const longUA = "A".repeat(10_000);
      const request = buildRequest({ "user-agent": longUA });

      // Should not throw and should produce a bounded fingerprint
      const identity = getRequestClientIdentity(request);
      expect(identity.key.length).toBeLessThan(200);
    });

    it("handles empty x-forwarded-for header gracefully", () => {
      process.env.AGENTIC_TRUST_PROXY_HEADERS = "true";
      process.env.AGENTIC_TRUSTED_CLIENT_IP_HEADER = "x-forwarded-for";

      const identity = getRequestClientIdentity(
        buildRequest({
          "x-forwarded-for": ""
        })
      );

      expect(identity.source).toBe("request-fingerprint");
    });

    it("ignores AGENTIC_TRUST_PROXY_HEADERS when set to non-true values", () => {
      process.env.AGENTIC_TRUST_PROXY_HEADERS = "yes";
      process.env.AGENTIC_TRUSTED_CLIENT_IP_HEADER = "x-forwarded-for";

      const identity = getRequestClientIdentity(
        buildRequest({
          "x-forwarded-for": "203.0.113.10"
        })
      );

      // "yes" is not "true", so proxy headers should not be trusted
      expect(identity.source).toBe("request-fingerprint");
    });
  });
});
