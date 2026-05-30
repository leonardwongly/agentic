import { readFile } from "node:fs/promises";
import path from "node:path";

const publicRuntimeSurfaces = [
  ".env.example",
  "README.md",
  "apps/web/lib/auth.ts",
  "apps/web/lib/instance-owner.ts",
  "apps/web/app/api/github/issues/app/sync/route.ts",
  "apps/web/app/api/github/issues/webhook/route.ts",
  "packages/contracts/src/index.ts",
  "packages/repository/src/file-helpers.ts",
  "packages/repository/src/file-repository.ts",
  "packages/repository/src/postgres-repository.ts",
  "packages/repository/src/repository-constants.ts",
  "deploy/render/render.yaml",
  "scripts/repo-hygiene-report.ts"
];

describe("OSS ownership defaults", () => {
  it("keeps public runtime defaults installer-owned rather than maintainer-owned", async () => {
    const forbidden = /\bLeonard\b|user-primary|Asia\/Singapore|leonardwongly\/agentic/u;

    for (const relativePath of publicRuntimeSurfaces) {
      const source = await readFile(path.join(process.cwd(), relativePath), "utf8");
      expect(source, relativePath).not.toMatch(forbidden);
    }
  });
});
