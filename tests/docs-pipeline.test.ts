import { paths, renderDocx, validateDocx } from "../scripts/lib/docx-pipeline.mjs";

describe("docx pipeline", () => {
  it("renders and validates the canonical specification", async () => {
    await renderDocx();
    const result = await validateDocx(paths.outputDocx);

    expect(result.metadataNormalized).toBe(true);
    expect(result.tocSmokePassed).toBe(true);
    expect(result.extractedMarkdownLength).toBeGreaterThan(500);
  }, 30_000);
});
