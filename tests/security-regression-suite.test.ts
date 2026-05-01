import { SECURITY_REGRESSION_CATEGORIES } from "../scripts/security-regression-suite";

describe("security regression suite inventory", () => {
  it("keeps category ids unique and files de-duplicated within each category", () => {
    const categoryIds = new Set<string>();

    for (const category of SECURITY_REGRESSION_CATEGORIES) {
      expect(categoryIds.has(category.id)).toBe(false);
      categoryIds.add(category.id);

      const files = new Set(category.files);
      expect(files.size).toBe(category.files.length);
      expect(category.files.length).toBeGreaterThan(0);
    }
  });

  it("covers the expected high-signal abuse boundaries", () => {
    expect(SECURITY_REGRESSION_CATEGORIES.map((category) => category.id)).toEqual([
      "malformed-input-and-size-limits",
      "auth-session-and-provider-callbacks",
      "authorization-governance-and-tenant-isolation",
      "idempotency-replay-and-duplicate-submission",
      "privacy-and-anonymous-surfaces",
      "durable-execution-and-recovery"
    ]);

    const files = new Set(SECURITY_REGRESSION_CATEGORIES.flatMap((category) => category.files));

    expect(files.has("tests/api-validation.test.ts")).toBe(true);
    expect(files.has("tests/public-share-view-route.test.ts")).toBe(true);
    expect(files.has("tests/dashboard-goals-card.test.tsx")).toBe(true);
    expect(files.has("tests/google-provider-routes.test.ts")).toBe(true);
    expect(files.has("tests/route-user-scope.test.ts")).toBe(true);
    expect(files.has("tests/goal-route.test.ts")).toBe(true);
    expect(files.has("tests/autopilot-route.test.ts")).toBe(true);
    expect(files.has("tests/repository.test.ts")).toBe(true);
    expect(files.has("tests/worker-runtime.test.ts")).toBe(true);
  });
});
