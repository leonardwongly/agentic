import { spawnSync } from "node:child_process";
import { paths, renderDocx, validateDocx } from "../scripts/lib/docx-pipeline.mjs";

const pandocCheck = spawnSync("pandoc", ["--version"], { stdio: "ignore" });
const docsIt = pandocCheck.status === 0 ? it : it.skip;

describe("docx pipeline", () => {
  docsIt("renders and validates the canonical specification", async () => {
    await renderDocx();
    const result = await validateDocx(paths.outputDocx);

    expect(result.metadataNormalized).toBe(true);
    expect(result.tocSmokePassed).toBe(true);
    expect(result.extractedMarkdownLength).toBeGreaterThan(500);
  }, 30_000);
});
