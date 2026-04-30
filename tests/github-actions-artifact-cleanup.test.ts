import { readFileSync } from "node:fs";

function readRepoFile(path: string): string {
  return readFileSync(path, "utf8");
}

describe("GitHub Actions artifact uploads", () => {
  it("keeps pull request evidence validation from consuming artifact quota", () => {
    const ci = readRepoFile(".github/workflows/ci.yml");

    expect((ci.match(/uses: actions\/upload-artifact@v\d+/g) || []).length).toBe(1);
    expect(ci).toMatch(
      /if:\s*github\.event_name\s*!=\s*['"]pull_request['"]\s*&&\s*vars\.ENABLE_SUPPLY_CHAIN_ARTIFACT_UPLOAD\s*==\s*['"]true['"]/
    );
  });
});
