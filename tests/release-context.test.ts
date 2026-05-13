import { describe, expect, it } from "vitest";
import {
  validateDockerIgnoreContent,
  validateTrackedReleasePaths
} from "../scripts/check-release-context";

describe("release context checks", () => {
  it("accepts the checked-in Docker context denylist", async () => {
    const content = await import("node:fs/promises").then(({ readFile }) => readFile(".dockerignore", "utf8"));

    expect(validateDockerIgnoreContent(content)).toEqual([]);
  });

  it("fails when secret, local-state, or generated-artifact patterns are missing", () => {
    const findings = validateDockerIgnoreContent("node_modules\n.git\n");

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing-dockerignore-pattern",
          message: ".dockerignore must include .env"
        }),
        expect.objectContaining({
          code: "missing-dockerignore-pattern",
          message: ".dockerignore must include artifacts"
        }),
        expect.objectContaining({
          code: "missing-dockerignore-pattern",
          message: ".dockerignore must include .playwright-mcp"
        })
      ])
    );
  });

  it("rejects tracked release artifacts, local stores, secrets, and private keys", () => {
    const findings = validateTrackedReleasePaths([
      ".env",
      ".env.example",
      ".agentic/runtime-store.json",
      "artifacts/security/runtime-audit-report.json",
      "coverage/index.html",
      "playwright-report/index.html",
      "certs/private.pem",
      "release/agentic-runtime-bundle.tgz",
      "apps/web/app/api/dashboard/artifacts/route.ts",
      "packages/contracts/src/index.ts"
    ]);

    expect(findings).toEqual([
      expect.objectContaining({ code: "tracked-env-file" }),
      expect.objectContaining({ code: "tracked-local-store" }),
      expect.objectContaining({ code: "tracked-release-artifact" }),
      expect.objectContaining({ code: "tracked-coverage" }),
      expect.objectContaining({ code: "tracked-playwright-output" }),
      expect.objectContaining({ code: "tracked-private-key" }),
      expect.objectContaining({ code: "tracked-packed-artifact" })
    ]);
  });
});
