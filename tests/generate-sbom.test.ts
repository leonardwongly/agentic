import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSpdxDocument } from "../scripts/generate-sbom";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function collectScriptFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectScriptFiles(full, found);
    } else if (entry.endsWith(".ts")) {
      found.push(full);
    }
  }
  return found;
}

describe("sbom generation", () => {
  it("emits an SPDX document with root and runtime packages", () => {
    const document = buildSpdxDocument(
      {
        lockfileVersion: 3,
        name: "agentic",
        packages: {
          "": {
            name: "agentic"
          },
          "node_modules/next": {
            version: "16.2.4",
            resolved: "https://registry.npmjs.org/next/-/next-16.2.4.tgz",
            integrity: "sha512-test-next"
          },
          "node_modules/@types/node": {
            version: "24.9.1",
            dev: true
          },
          "packages/contracts": {
            name: "@agentic/contracts",
            version: "0.0.0"
          }
        }
      },
      {
        name: "agentic"
      },
      new Date("2026-04-18T00:00:00.000Z")
    );

    expect(document.spdxVersion).toBe("SPDX-2.3");
    expect(document.packages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          SPDXID: "SPDXRef-Package-root",
          name: "agentic",
          versionInfo: "0.0.0"
        }),
        expect.objectContaining({
          name: "next",
          versionInfo: "16.2.4",
          externalRefs: [
            expect.objectContaining({
              referenceLocator: "pkg:npm/next@16.2.4"
            })
          ]
        }),
        expect.objectContaining({
          name: "@agentic/contracts",
          versionInfo: "0.0.0"
        })
      ])
    );
    expect(document.packages.some((entry) => entry.name === "@types/node")).toBe(false);
    expect(document.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          spdxElementId: "SPDXRef-DOCUMENT",
          relationshipType: "DESCRIBES",
          relatedSpdxElement: "SPDXRef-Package-root"
        })
      ])
    );
  });

  it("REGRESSION: no runtime require() calls in ESM scripts (require-in-ESM crash class)", () => {
    // Regression for the adversarial-sweep CI failure: generate-sbom.ts called
    // require("node:child_process") inside main(). The repo is "type": "module"
    // and tsx executes scripts as ESM, so require is undefined at runtime —
    // ReferenceError: require is not defined in ES module scope. TypeScript
    // does not flag it (global require is typed via @types/node), and the unit
    // test above only exercises buildSpdxDocument, so the bug surfaced only in
    // CI's SBOM step. This guard scans every scripts/**/*.ts for runtime
    // require( calls so the whole bug class stays fixed.
    const scriptFiles = collectScriptFiles(path.join(repoRoot, "scripts"));
    expect(scriptFiles.length).toBeGreaterThan(0);

    // Match require("...") / require('...') call sites, ignoring comment lines.
    const requireCallPattern = /(^|[^.\w])require\s*\(\s*["']/;
    const offenders: string[] = [];

    for (const file of scriptFiles) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) {
          return;
        }
        if (requireCallPattern.test(line)) {
          offenders.push(`${path.relative(repoRoot, file)}:${index + 1}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});
