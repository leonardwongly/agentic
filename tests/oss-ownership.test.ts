import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_BOOTSTRAP_USER_ID,
  DEFAULT_OWNER_USER_ID,
  SYSTEM_USER_ID,
  TEST_OWNER_USER_ID
} from "@agentic/contracts";
import { TEST_REPOSITORY_FULL_NAME } from "./fixtures/oss-fixtures";

const publicRuntimeSurfaces = [
  ".env.example",
  "apps/web/lib/auth.ts",
  "apps/web/lib/instance-owner.ts",
  "apps/web/app/api/github/issues/app/sync/route.ts",
  "apps/web/app/api/github/issues/webhook/route.ts",
  "packages/contracts/src/index.ts",
  "packages/repository/src/index.ts",
  "packages/orchestrator/src/morning-briefing.ts",
  "deploy/render/render.yaml",
  "deploy/self-hosted/docker-compose.yml",
  "docs/deployment/self-hosted.md"
];

const userFacingSetupDocs = [
  ".env.example",
  "docs/deployment/self-hosted.md",
  "deploy/self-hosted/docker-compose.yml"
];

async function readRepoFile(relativePath: string) {
  return readFile(path.join(process.cwd(), relativePath), "utf8");
}

async function listFiles(relativeDir: string): Promise<string[]> {
  const absoluteDir = path.join(process.cwd(), relativeDir);
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const relativePath = path.join(relativeDir, entry.name);

      if (entry.isDirectory()) {
        return listFiles(relativePath);
      }

      return [relativePath];
    })
  );

  return nested.flat();
}

describe("OSS ownership defaults", () => {
  it("keeps default owner constants installer-owned", () => {
    expect(DEFAULT_OWNER_USER_ID).toBe("owner");
    expect(DEFAULT_BOOTSTRAP_USER_ID).toBe(DEFAULT_OWNER_USER_ID);
    expect(SYSTEM_USER_ID).toBe(DEFAULT_OWNER_USER_ID);
    expect(TEST_OWNER_USER_ID).toBe("test-owner");
    expect(TEST_REPOSITORY_FULL_NAME).toBe("octo-org/demo-agentic");
  });

  it("keeps public runtime defaults free of maintainer-owned identity values", async () => {
    const forbidden = /\bLeonard\b|user-primary|Asia\/Singapore/u;

    for (const relativePath of publicRuntimeSurfaces) {
      const source = await readRepoFile(relativePath);
      expect(source, relativePath).not.toMatch(forbidden);
    }
  });

  it("uses placeholder repositories in installer-facing setup docs", async () => {
    for (const relativePath of userFacingSetupDocs) {
      const source = await readRepoFile(relativePath);
      expect(source, relativePath).not.toContain("leonardwongly/agentic");
      expect(
        source.includes("<your-org>/<your-repo>") ||
          source.includes("AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES:-")
      ).toBe(true);
    }
  });

  it("keeps active tests on explicit owner fixtures instead of deprecated system-user naming", async () => {
    const testFiles = (await listFiles("tests")).filter(
      (relativePath) =>
        (relativePath.endsWith(".test.ts") || relativePath.endsWith(".test.tsx")) &&
        relativePath !== "tests/oss-ownership.test.ts"
    );

    for (const relativePath of testFiles) {
      const source = await readRepoFile(relativePath);
      expect(source, relativePath).not.toContain("SYSTEM_USER_ID");
    }
  });
});
