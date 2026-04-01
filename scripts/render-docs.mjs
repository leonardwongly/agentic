import { renderDocx } from "./lib/docx-pipeline.mjs";

const result = await renderDocx();

console.log(JSON.stringify(result, null, 2));
