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
  const goalRefineRoutePath = "apps/web/app/api/goals/[id]/refine/route.ts";
  const briefingRoutePath = "apps/web/app/api/briefing/route.ts";
  const commitmentsRoutePath = "apps/web/app/api/commitments/[id]/route.ts";
  const templatesRoutePath = "apps/web/app/api/templates/[id]/route.ts";
  const repositoryPath = "packages/repository/src/index.ts";
  const workerEntryPath = "apps/worker/src/index.ts";
  const runtimeReadinessPath = "apps/web/lib/runtime-readiness.ts";
  const dashboardPath = "apps/web/components/dashboard.tsx";
  const dashboardSurfacePath = "apps/web/lib/dashboard-surface.ts";

  const goalsRoute = readRepoFile(goalsRoutePath);
  const goalRefineRoute = readRepoFile(goalRefineRoutePath);
  const briefingRoute = readRepoFile(briefingRoutePath);
  const commitmentsRoute = readRepoFile(commitmentsRoutePath);
  const templatesRoute = readRepoFile(templatesRoutePath);
  const repository = readRepoFile(repositoryPath);
  const workerEntry = readRepoFile(workerEntryPath);
  const runtimeReadiness = readRepoFile(runtimeReadinessPath);
  const dashboard = readRepoFile(dashboardPath);
  const dashboardSurface = readRepoFile(dashboardSurfacePath);

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
    goalRefineRoute,
    'import { enqueueGoalRefineJob } from "@agentic/worker-runtime";',
    `${goalRefineRoutePath} must enqueue durable goal-refine jobs through worker runtime.`
  );
  assertNotContains(
    goalRefineRoute,
    "refineGoal(",
    `${goalRefineRoutePath} must not execute refinement directly on the request path.`
  );
  assertContains(
    goalRefineRoute,
    "statusUrl: `/api/goals/jobs/${job.id}`",
    `${goalRefineRoutePath} must return a pollable goal job status route.`
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

  assertNotContains(
    repository,
    '@agentic/db/migration-runtime',
    `${repositoryPath} must not pull migration runtime into the shared repository implementation.`
  );
  assertContains(
    workerEntry,
    'import { assertDatabaseSchemaReady } from "@agentic/db/migration-runtime";',
    `${workerEntryPath} must validate schema readiness before starting the worker loop.`
  );
  assertContains(
    runtimeReadiness,
    'const runtime = await import("@agentic/db/schema-status");',
    `${runtimeReadinessPath} must use the lightweight schema-status module instead of the migration runner.`
  );
  assertContains(
    runtimeReadiness,
    "buildConnectorHealthCheckSnapshot(",
    `${runtimeReadinessPath} must aggregate connector health into readiness.`
  );
  assertContains(
    runtimeReadiness,
    "name: \"connector_health\"",
    `${runtimeReadinessPath} must expose a connector_health readiness check.`
  );
  assertContains(
    runtimeReadiness,
    "await repository.listProviderCredentials()",
    `${runtimeReadinessPath} must inspect provider credentials when computing readiness.`
  );
  assertContains(
    dashboard,
    "DashboardOperationsTowerCard",
    `${dashboardPath} must render the operations control tower surface.`
  );
  assertContains(
    dashboardSurface,
    "\"operations\"",
    `${dashboardSurfacePath} must expose the operations section to the advanced dashboard surface.`
  );

  console.log("Architecture fitness checks passed.");
}

main();
