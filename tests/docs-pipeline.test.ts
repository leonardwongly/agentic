import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  findNonPortableReferences,
  paths,
  renderDocx,
  validateDocx,
  validatePortableDocReferences
} from "../scripts/lib/docx-pipeline.mjs";

const pandocCheck = spawnSync("pandoc", ["--version"], { stdio: "ignore" });
const docsIt = pandocCheck.status === 0 ? it : it.skip;

describe("docx pipeline", () => {
  it("detects local absolute paths and Codex worktree evidence in docs", () => {
    const localHome = ["/Users", "leonardwongly"].join("/");
    const worktreeSegment = [".codex", "worktrees"].join("/");
    const violations = findNonPortableReferences(
      `See ${localHome}/${worktreeSegment}/24f9/Agentic/packages/contracts/src/index.ts`
    );

    expect(violations.map(violation => violation.id)).toEqual(
      expect.arrayContaining(["local-home-path", "codex-worktree-path"])
    );
  });

  it("validates portable doc references across docs, config, workflows, and README", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agentic-docs-portable-"));
    await mkdir(path.join(root, "docs"), { recursive: true });
    await mkdir(path.join(root, "config"), { recursive: true });
    await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
    await writeFile(path.join(root, "README.md"), "[API](https://github.com/leonardwongly/agentic/blob/main/apps/web/app/api/health/route.ts)\n");
    await writeFile(path.join(root, "docs", "runbook.md"), "[Contract](https://github.com/leonardwongly/agentic/blob/main/packages/contracts/src/index.ts)\n");
    await writeFile(path.join(root, "config", "controls.json"), "{\"ok\": true}\n");
    await writeFile(path.join(root, ".github", "workflows", "ci.yml"), "name: CI\n");

    await expect(validatePortableDocReferences({ root })).resolves.toMatchObject({
      violations: []
    });
  });

  it("fails validation when docs contain non-portable local paths", async () => {
    const localHome = ["/Users", "leonardwongly"].join("/");
    const root = await mkdtemp(path.join(os.tmpdir(), "agentic-docs-local-paths-"));
    await mkdir(path.join(root, "docs"), { recursive: true });
    await writeFile(path.join(root, "docs", "bad.md"), `[Bad](${localHome}/Developer/Agentic/packages/contracts/src/index.ts)\n`);

    await expect(validatePortableDocReferences({ root, targets: ["docs"] })).rejects.toThrow(
      /non-portable documentation references/u
    );
  });

  docsIt("renders and validates the canonical specification", async () => {
    await renderDocx();
    const result = await validateDocx(paths.outputDocx);

    expect(result.metadataNormalized).toBe(true);
    expect(result.tocSmokePassed).toBe(true);
    expect(result.portableReferences.violations).toEqual([]);
    expect(result.extractedMarkdownLength).toBeGreaterThan(500);
  }, 30_000);
});
