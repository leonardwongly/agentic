import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

type SecurityRegressionCategory = {
  id: string;
  description: string;
  files: string[];
};

export const SECURITY_REGRESSION_CATEGORIES: SecurityRegressionCategory[] = [
  {
    id: "input-validation",
    description: "Reject malformed or ambiguous input early with sanitized failures.",
    files: [
      "tests/api-validation.test.ts",
      "tests/public-share-view-route.test.ts"
    ]
  },
  {
    id: "auth-and-session",
    description: "Fail closed on token misuse, state tampering, and callback abuse.",
    files: [
      "tests/auth.test.ts",
      "tests/google-provider-routes.test.ts"
    ]
  },
  {
    id: "scope-and-governance",
    description: "Preserve tenant isolation, scoped access, and governed route behavior.",
    files: [
      "tests/route-user-scope.test.ts",
      "tests/governance-privacy-route.test.ts"
    ]
  },
  {
    id: "idempotency-and-public-surfaces",
    description: "Prevent duplicate or anonymous workflows from corrupting state.",
    files: [
      "tests/goal-route.test.ts",
      "tests/briefing-route.test.ts",
      "tests/templates-route.test.ts",
      "tests/nl-intent-route.test.ts",
      "tests/share-route.test.ts"
    ]
  },
  {
    id: "durable-execution",
    description: "Keep retries, dead letters, and async workers safe under failure.",
    files: [
      "tests/autopilot-route.test.ts",
      "tests/docs-render-route.test.ts",
      "tests/worker-runtime.test.ts"
    ]
  }
];

function uniqueTestFiles(categories: SecurityRegressionCategory[]): string[] {
  return [...new Set(categories.flatMap((category) => category.files))];
}

function printSuiteSummary(categories: SecurityRegressionCategory[]) {
  const files = uniqueTestFiles(categories);

  console.log("Security regression suite");
  console.log(`- categories: ${categories.length}`);
  console.log(`- files: ${files.length}`);

  for (const category of categories) {
    console.log(`- ${category.id}: ${category.files.length} files`);
  }
}

function runVitest(files: string[]): number {
  const result = spawnSync("npm", ["exec", "--", "vitest", "run", ...files], {
    stdio: "inherit",
    env: process.env
  });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
}

function main() {
  const files = uniqueTestFiles(SECURITY_REGRESSION_CATEGORIES);

  printSuiteSummary(SECURITY_REGRESSION_CATEGORIES);
  const exitCode = runVitest(files);

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const currentScriptPath = fileURLToPath(import.meta.url);

if (invokedPath === currentScriptPath) {
  main();
}
