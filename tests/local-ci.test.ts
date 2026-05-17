import { buildLocalCiPlan, formatLocalCiCommand } from "../scripts/lib/local-ci";

describe("local CI runner", () => {
  it("builds a fast PR gate that matches the high-signal local checks", () => {
    const plan = buildLocalCiPlan({ mode: "fast" });
    const commands = plan.steps.filter(step => step.kind === "command").map(step => formatLocalCiCommand(step));

    expect(plan.mode).toBe("fast");
    expect(commands).toEqual([
      "npm ci",
      "npm run ci:validate-provenance",
      "npm run ci:issue-theme-gates -- --assert-workflow",
      "npm run compliance:validate-registry",
      "npm run test:architecture:fitness",
      "npm run test:performance:fitness",
      "npm run test",
      "npm run build"
    ]);
    expect(plan.skipped.map(step => step.id)).toEqual(
      expect.arrayContaining(["dependency-review-action", "upload-artifact", "attestations"])
    );
  });

  it("builds a full local CI plan with database, security, smoke, build, and evidence gates", () => {
    const plan = buildLocalCiPlan({ mode: "full", withPostgres: true, branchName: "feat/parallel-spine" });
    const ids = plan.steps.map(step => step.id);

    expect(plan.managesPostgres).toBe(true);
    expect(ids[0]).toBe("start-postgres");
    expect(ids).toEqual(
      expect.arrayContaining([
        "security-audit-runtime",
        "db-check-migrations",
        "db-migrate",
        "db-status",
        "governance-simulate",
        "test-security-regression",
        "test-smoke-capabilities",
        "test-parallel-worktree-fitness",
        "test-smoke-observability",
        "security-sbom",
        "playwright",
        "test-e2e",
        "docker-build",
        "package-build-artifacts",
        "security-collect-evidence"
      ])
    );
  });

  it("can skip install and browser E2E for faster full-mode diagnosis", () => {
    const plan = buildLocalCiPlan({ mode: "full", skipInstall: true, noE2e: true, withPostgres: true });
    const ids = plan.steps.map(step => step.id);

    expect(ids).not.toContain("npm-ci");
    expect(ids).not.toContain("playwright");
    expect(ids).not.toContain("test-e2e");
    expect(plan.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "browser-e2e",
          reason: expect.stringContaining("--no-e2e")
        }),
        expect.objectContaining({
          id: "test-parallel-worktree-fitness"
        })
      ])
    );
  });

  it("keeps fast mode out of database-backed tests by default", () => {
    const plan = buildLocalCiPlan({ mode: "fast" });

    expect(plan.env).toMatchObject({
      AGENTIC_ACCESS_KEY: "ci-access-key",
      NEXT_TELEMETRY_DISABLED: "1",
      NODE_ENV: "test",
      NODE_OPTIONS: "--max-old-space-size=4096"
    });
    expect(plan.env).not.toHaveProperty("DATABASE_URL");
  });

  it("sets a deterministic database URL for full local CI", () => {
    const plan = buildLocalCiPlan({ mode: "full", databaseUrl: "postgres://custom.example/agentic" });

    expect(plan.env.DATABASE_URL).toBe("postgres://custom.example/agentic");
  });

  it("requires an explicit database source for full local CI", () => {
    expect(() => buildLocalCiPlan({ mode: "full" })).toThrow(/--with-postgres or DATABASE_URL/u);
  });
});
