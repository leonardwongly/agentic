import { readFileSync } from "node:fs";
import path from "node:path";

function readRepoFile(relativePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

function assertContains(content: string, needle: string, message: string) {
  if (!content.includes(needle)) {
    throw new Error(message);
  }
}

function assertNotContains(content: string, needle: string, message: string) {
  if (content.includes(needle)) {
    throw new Error(message);
  }
}

function main() {
  const goalsRoutePath = "apps/web/app/api/goals/route.ts";
  const briefingRoutePath = "apps/web/app/api/briefing/route.ts";
  const commitmentsRoutePath = "apps/web/app/api/commitments/[id]/route.ts";
  const templatesRoutePath = "apps/web/app/api/templates/[id]/route.ts";

  const goalsRoute = readRepoFile(goalsRoutePath);
  const briefingRoute = readRepoFile(briefingRoutePath);
  const commitmentsRoute = readRepoFile(commitmentsRoutePath);
  const templatesRoute = readRepoFile(templatesRoutePath);

  assertContains(
    goalsRoute,
    'import { enqueueGoalCreateJob } from "@agentic/worker-runtime";',
    `${goalsRoutePath} must enqueue durable goal jobs through worker runtime.`
  );
  assertNotContains(
    goalsRoute,
    "processUserRequest(",
    `${goalsRoutePath} must not execute processUserRequest directly on the request path.`
  );

  assertContains(
    briefingRoute,
    'import { enqueueBriefingCreateJob } from "@agentic/worker-runtime";',
    `${briefingRoutePath} must enqueue durable briefing jobs through worker runtime.`
  );
  assertNotContains(
    briefingRoute,
    "generateBriefing(",
    `${briefingRoutePath} must not generate briefings directly on the request path.`
  );
  assertNotContains(
    briefingRoute,
    "captureMemoriesFromBundle(",
    `${briefingRoutePath} must not persist captured memories directly on the request path.`
  );

  assertContains(
    commitmentsRoute,
    'import { requireUpdatedAtPrecondition } from "../../../../lib/mutation-preconditions";',
    `${commitmentsRoutePath} must enforce optimistic concurrency preconditions.`
  );
  assertContains(
    commitmentsRoute,
    "requireUpdatedAtPrecondition(request, existing.updatedAt);",
    `${commitmentsRoutePath} must reject stale commitment mutations.`
  );

  assertContains(
    templatesRoute,
    'import { requireUpdatedAtPrecondition } from "../../../../lib/mutation-preconditions";',
    `${templatesRoutePath} must enforce optimistic concurrency preconditions.`
  );
  const templatePreconditionCalls = templatesRoute.match(/requireUpdatedAtPrecondition\(request, existing\.updatedAt\);/gu) ?? [];
  if (templatePreconditionCalls.length < 2) {
    throw new Error(`${templatesRoutePath} must enforce preconditions for both delete and patch mutations.`);
  }

  console.log("Architecture fitness checks passed.");
}

main();
