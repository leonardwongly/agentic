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
    id: "malformed-input-and-size-limits",
    description: "Reject malformed or oversized input before it reaches durable or privileged paths.",
    files: [
      "tests/api-validation.test.ts",
      "tests/local-notes-route.test.ts",
      "tests/provider-credential-secrets.test.ts",
      "tests/public-share-view-route.test.ts"
    ]
  },
  {
    id: "auth-session-and-provider-callbacks",
    description: "Fail closed on token misuse, state tampering, and callback abuse.",
    files: [
      "tests/api-security-headers.test.ts",
      "tests/auth.test.ts",
      "tests/google-provider-routes.test.ts"
    ]
  },
  {
    id: "authorization-governance-and-tenant-isolation",
    description: "Preserve tenant isolation, scoped access, and governed route behavior.",
    files: [
      "tests/route-user-scope.test.ts",
      "tests/governance-privacy-route.test.ts",
      "tests/governance-audit-route.test.ts"
    ]
  },
  {
    id: "idempotency-replay-and-duplicate-submission",
    description: "Prevent duplicate submissions, replayed events, and retried mutations from corrupting state.",
    files: [
      "tests/goal-route.test.ts",
      "tests/briefing-route.test.ts",
      "tests/docs-render-route.test.ts",
      "tests/templates-route.test.ts",
      "tests/nl-intent-route.test.ts",
      "tests/autopilot-route.test.ts"
    ]
  },
  {
    id: "privacy-and-anonymous-surfaces",
    description: "Keep public and privacy-sensitive surfaces rate-limited, asynchronous, and minimally exposed.",
    files: [
      "tests/public-share-view-route.test.ts",
      "tests/dashboard-goals-card.test.tsx",
      "tests/share-route.test.ts",
      "tests/governance-privacy-route.test.ts"
    ]
  },
  {
    id: "durable-execution-and-recovery",
    description: "Keep retries, dead letters, duplicate execution, and worker recovery bounded and sanitized.",
    files: [
      "tests/autopilot-route.test.ts",
      "tests/docs-render-route.test.ts",
      "tests/repository.test.ts",
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
