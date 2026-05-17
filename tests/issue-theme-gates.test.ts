import {
  ISSUE_THEME_TAXONOMY,
  buildIssueThemeGatePlan,
  normalizeChangedFile,
  validateIssueThemeTaxonomy
} from "../scripts/lib/issue-theme-gates";

describe("issue-theme validation gates", () => {
  it("defines unique CI shards for every issue theme", () => {
    const shardIds = ISSUE_THEME_TAXONOMY.map(theme => theme.ciShard);

    expect(new Set(shardIds).size).toBe(shardIds.length);
    expect(ISSUE_THEME_TAXONOMY.map(theme => theme.id)).toContain("operator-shell");
    expect(ISSUE_THEME_TAXONOMY.map(theme => theme.id)).toContain("security-privacy");
  });

  it("keeps taxonomy gates backed by package scripts", () => {
    expect(validateIssueThemeTaxonomy()).toEqual([]);
  });

  it("maps GitHub labels to targeted validation gates", () => {
    const plan = buildIssueThemeGatePlan({
      labels: ["aos-trust-spine"]
    });

    expect(plan.fallback).toBe(false);
    expect(plan.themes.map(theme => theme.id)).toEqual(
      expect.arrayContaining(["connector-readiness", "governance-trust", "security-privacy"])
    );
    expect(plan.commands).toContain("npm run test:security:regression");
    expect(plan.commands).toContain("npm run compliance:validate-registry");
  });

  it("maps changed dashboard and CI files to shell and hygiene shards", () => {
    const plan = buildIssueThemeGatePlan({
      changedFiles: [".github/workflows/ci.yml", "apps/web/components/dashboard.tsx"]
    });

    expect(plan.ciShards).toEqual(expect.arrayContaining(["hygiene", "shell"]));
    expect(plan.commands).toContain("npm run test:parallel-worktree:fitness");
    expect(plan.commands).toContain("npm run docs:build");
  });

  it("maps issue titles to the matching domain shard", () => {
    const plan = buildIssueThemeGatePlan({
      titles: ["gap(g27): add issue-theme gate taxonomy and CI sharding"]
    });

    expect(plan.themes.map(theme => theme.id)).toEqual(expect.arrayContaining(["operator-shell", "engineering-hygiene"]));
  });

  it("rejects unsafe changed file paths before matching gates", () => {
    expect(() => normalizeChangedFile("../outside.ts")).toThrow(/inside the repository/u);
    expect(() => normalizeChangedFile("/tmp/outside.ts")).toThrow(/repo-relative/u);
    expect(() => normalizeChangedFile("")).toThrow(/must not be empty/u);
  });

  it("rejects unknown explicit themes", () => {
    expect(() =>
      buildIssueThemeGatePlan({
        explicitThemes: ["unknown-theme"]
      })
    ).toThrow(/Unknown issue theme/u);
  });

  it("falls back to all gates when a changed path has no known theme", () => {
    const plan = buildIssueThemeGatePlan({
      changedFiles: ["new-runtime-surface/example.ts"]
    });

    expect(plan.fallback).toBe(true);
    expect(plan.themes).toHaveLength(ISSUE_THEME_TAXONOMY.length);
    expect(plan.commands).toEqual(expect.arrayContaining(["npm run test:security:regression", "npm run build"]));
  });
});
