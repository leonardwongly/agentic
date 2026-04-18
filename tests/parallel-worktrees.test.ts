import path from "node:path";

import {
  buildParallelWorktreePlan,
  parseParallelWorktreeArgs,
  renderParallelWorktreePlan
} from "../scripts/lib/parallel-worktrees";

describe("parallel worktree planning", () => {
  const repoRoot = "/Users/leonardwongly/Developer/Agentic";

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
      path: "/Users/leonardwongly/Developer/Agentic-spine"
    });
    expect(plan.streams[4]).toMatchObject({
      branch: "feat/parallel-intelligence",
      path: "/Users/leonardwongly/Developer/Agentic-intelligence"
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
      worktreeRoot: "/Users/leonardwongly/Developer/parallel",
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

    expect(summary).toContain("Repo root: /Users/leonardwongly/Developer/Agentic");
    expect(summary).toContain("CONNECTORS :: Connector readiness and certification");
    expect(summary).toContain("issues: LEO-72");
    expect(summary).toContain("dependsOn: spine");
  });
});
