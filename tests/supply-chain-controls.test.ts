import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("supply-chain controls documentation", () => {
  it("documents third-party scanner quota waivers without treating them as security passes", () => {
    const controls = readRepoFile("docs/security/supply-chain-controls.md");

    expect(controls).toContain("## Third-party scanner quota statuses");
    expect(controls).toContain("Snyk reporting `Code test limit reached`");
    expect(controls).toContain("scanner availability failures");
    expect(controls).toContain("not as a clean security scan");
    expect(controls).toContain("runtime vulnerability gate");
    expect(controls).toContain("dependency review");
    expect(controls).toContain("provenance validation");
    expect(controls).toContain("Socket");
    expect(controls).toContain("generated SBOM workflow evidence");
    expect(controls).toContain("Do not waive a scanner quota failure when the failure includes a concrete vulnerability finding");
    expect(controls).toContain("Do not create a runtime vulnerability exception for quota exhaustion");
  });
});
