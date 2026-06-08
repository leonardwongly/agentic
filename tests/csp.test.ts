import { buildContentSecurityPolicy } from "../apps/web/lib/csp";

describe("buildContentSecurityPolicy", () => {
  it("builds a static production policy that keeps strict non-script directives", () => {
    const policy = buildContentSecurityPolicy({ isDevelopment: false });

    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("upgrade-insecure-requests");
    // Production must not allow eval.
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it("allows unsafe-eval only in development", () => {
    const policy = buildContentSecurityPolicy({ isDevelopment: true });

    expect(policy).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
  });
});
