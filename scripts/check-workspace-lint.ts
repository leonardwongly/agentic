import { readFileSync } from "node:fs";
import path from "node:path";

import { lintWorkspaceContracts, type IssueEvidenceMap } from "./lib/engineering-hygiene";

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(process.cwd(), relativePath), "utf8")) as T;
}

const issues = lintWorkspaceContracts({
  cwd: process.cwd(),
  packageJson: readJson("package.json"),
  ciWorkflow: readFileSync(path.join(process.cwd(), ".github/workflows/ci.yml"), "utf8"),
  evidenceMap: readJson<IssueEvidenceMap>("config/engineering-hygiene/w10-evidence-map.json")
});

if (issues.length > 0) {
  console.error("Workspace lint failed:");
  for (const issue of issues) {
    console.error(`- ${issue.path}: ${issue.message}`);
  }
  process.exitCode = 1;
} else {
  console.log("Workspace lint checks passed.");
}
