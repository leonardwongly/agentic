import { buildContentSecurityPolicy } from "../apps/web/lib/csp";

describe("buildContentSecurityPolicy", () => {
  it("builds a strict production policy that uses nonces", () => {
    const policy = buildContentSecurityPolicy({
      nonce: "test-nonce",
      isDevelopment: false
    });

    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("script-src 'self' 'nonce-test-nonce' 'strict-dynamic'");
    expect(policy).toContain("style-src 'self' 'nonce-test-nonce'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain("'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it("keeps development-only allowances scoped to local development", () => {
    const policy = buildContentSecurityPolicy({
      nonce: "dev-nonce",
      isDevelopment: true
    });

    expect(policy).toContain("script-src 'self' 'nonce-dev-nonce' 'strict-dynamic' 'unsafe-eval'");
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
  });
});
