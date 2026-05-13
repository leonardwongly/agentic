import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DOC_PORTABILITY_TARGETS = ["README.md", "docs/runbooks", "docs/security", "docs/audits"];
const MACHINE_LOCAL_PATH_PATTERNS = [/\/Users\/[^)\s`]+/u, /\.codex\/worktrees\//u];

async function collectMarkdownFiles(target: string): Promise<string[]> {
  const absoluteTarget = path.resolve(target);
  const targetStat = await stat(absoluteTarget);

  if (targetStat.isFile()) {
    return target.endsWith(".md") ? [absoluteTarget] : [];
  }

  const entries = await readdir(absoluteTarget, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => collectMarkdownFiles(path.join(absoluteTarget, entry.name)))
  );

  return nested.flat();
}

describe("documentation portability", () => {
  it("keeps first-run docs and runbooks free of machine-local paths", async () => {
    const files = (await Promise.all(DOC_PORTABILITY_TARGETS.map((target) => collectMarkdownFiles(target)))).flat();
    const offenders: string[] = [];

    for (const file of files) {
      const contents = await readFile(file, "utf8");

      for (const pattern of MACHINE_LOCAL_PATH_PATTERNS) {
        if (pattern.test(contents)) {
          offenders.push(path.relative(process.cwd(), file));
          break;
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
