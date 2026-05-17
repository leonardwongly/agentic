import path from "node:path";

import {
  buildParallelWorktreePlan,
  evaluateParallelWorktreeProtection,
  parseParallelWorktreeArgs,
  parseParallelWorktreeCleanupArgs,
  resolveParallelWorktreeStreamFromBranch,
  renderParallelWorktreePlan
} from "../scripts/lib/parallel-worktrees";

describe("parallel worktree planning", () => {
  const repoRoot = "/workspace/Agentic";

  it("builds the default five-stream plan with a shared spine", () => {
    const plan = buildParallelWorktreePlan({
      repoRoot
    });

    expect(plan.baseBranch).toBe("main");
    expect(plan.branchPrefix).toBe("feat/parallel");
    expect(plan.worktreeRoot).toBe(path.dirname(repoRoot));
    expect(plan.streams.map(stream => stream.id)).toEqual([
      "spine",
      "secops",
      "connectors",
      "governance",
      "intelligence"
    ]);
    expect(plan.streams[0]).toMatchObject({
      branch: "feat/parallel-spine",
      path: "/workspace/Agentic-spine"
    });
    expect(plan.streams[4]).toMatchObject({
      branch: "feat/parallel-intelligence",
      path: "/workspace/Agentic-intelligence"
    });
  });

  it("supports a no-spine plan for already-frozen repos", () => {
    const plan = buildParallelWorktreePlan({
      repoRoot,
      includeSpine: false,
      branchPrefix: "chore/worktree"
    });

    expect(plan.streams.map(stream => stream.id)).toEqual([
      "secops",
      "connectors",
      "governance",
      "intelligence"
    ]);
    expect(plan.streams.every(stream => stream.branch.startsWith("chore/worktree-"))).toBe(true);
  });

  it("rejects unsafe branch segments", () => {
    expect(() =>
      buildParallelWorktreePlan({
        repoRoot,
        branchPrefix: "feat bad"
      })
    ).toThrow("branchPrefix");
  });

  it("parses cli arguments with absolute worktree roots", () => {
    const parsed = parseParallelWorktreeArgs(
      ["--root", "../parallel", "--base-branch", "release/2026.04", "--branch-prefix", "feat/worktree", "--no-spine"],
      {
        cwd: repoRoot
      }
    );

    expect(parsed).toEqual({
      worktreeRoot: "/workspace/parallel",
      baseBranch: "release/2026.04",
      branchPrefix: "feat/worktree",
      includeSpine: false,
      printOnly: false,
      json: false
    });
  });

  it("renders a readable plan summary for operators", () => {
    const plan = buildParallelWorktreePlan({
      repoRoot,
      includeSpine: false
    });

    const summary = renderParallelWorktreePlan(plan);

    expect(summary).toContain("Repo root: /workspace/Agentic");
    expect(summary).toContain("CONNECTORS :: Connector readiness and certification");
    expect(summary).toContain("issues: LEO-72");
    expect(summary).toContain("dependsOn: spine");
  });

  it("resolves stream ownership from the standard branch names", () => {
    expect(resolveParallelWorktreeStreamFromBranch("feat/parallel-spine")).toBe("spine");
    expect(resolveParallelWorktreeStreamFromBranch("feat/parallel-governance")).toBe("governance");
    expect(resolveParallelWorktreeStreamFromBranch("feature/random")).toBeUndefined();
  });

  it("allows a stream branch to edit only its own protected files", () => {
    const evaluation = evaluateParallelWorktreeProtection({
      branchName: "feat/parallel-secops",
      changedFiles: [
        "apps/web/lib/abuse-rate-limit.ts",
        "apps/web/app/api/goals/route.ts"
      ]
    });

    expect(evaluation.ok).toBe(true);
    expect(evaluation.violations).toEqual([]);
  });

  it("rejects non-spine branches that edit shared protected files", () => {
    const evaluation = evaluateParallelWorktreeProtection({
      branchName: "feat/parallel-connectors",
      changedFiles: ["packages/contracts/src/index.ts"]
    });

    expect(evaluation.ok).toBe(false);
    expect(evaluation.violations).toEqual([
      {
        file: "packages/contracts/src/index.ts",
        ownerStreamIds: ["spine"],
        reason: "shared-spine-only"
      }
    ]);
  });

  it("rejects stream branches that edit another stream's protected files", () => {
    const evaluation = evaluateParallelWorktreeProtection({
      branchName: "feat/parallel-governance",
      changedFiles: ["apps/web/lib/google-provider-adapters.ts"]
    });

    expect(evaluation.ok).toBe(false);
    expect(evaluation.violations).toEqual([
      {
        file: "apps/web/lib/google-provider-adapters.ts",
        ownerStreamIds: ["connectors"],
        reason: "owned-by-other-stream"
      }
    ]);
  });

  it("allows the integrated base branch to carry protected-file edits", () => {
    const evaluation = evaluateParallelWorktreeProtection({
      branchName: "main",
      changedFiles: ["packages/contracts/src/index.ts"]
    });

    expect(evaluation.ok).toBe(true);
    expect(evaluation.protectedFiles).toEqual(["packages/contracts/src/index.ts"]);
  });

  it("rejects protected-file edits from non-stream branches", () => {
    const evaluation = evaluateParallelWorktreeProtection({
      branchName: "feature/misc-hardening",
      changedFiles: ["packages/policy/src/index.ts"]
    });

    expect(evaluation.ok).toBe(false);
    expect(evaluation.violations).toEqual([
      {
        file: "packages/policy/src/index.ts",
        ownerStreamIds: ["governance"],
        reason: "protected-requires-owned-stream"
      }
    ]);
  });

  it("parses cleanup arguments including branch retention", () => {
    const parsed = parseParallelWorktreeCleanupArgs(["--root", "../parallel", "--keep-branches", "--json"], {
      cwd: repoRoot
    });

    expect(parsed).toEqual({
      worktreeRoot: "/workspace/parallel",
      includeSpine: true,
      printOnly: false,
      json: true,
      keepBranches: true
    });
  });
});
