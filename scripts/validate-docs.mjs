import { paths, validateDocx } from "./lib/docx-pipeline.mjs";

const result = await validateDocx(paths.outputDocx);

console.log(JSON.stringify(result, null, 2));
