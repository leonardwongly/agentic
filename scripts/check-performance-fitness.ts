import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function readRepoFile(relativePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

function assertContains(content: string, needle: string, message: string) {
  if (!content.includes(needle)) {
    throw new Error(message);
  }
}

function assertFileExists(relativePath: string, message: string) {
  if (!existsSync(path.resolve(process.cwd(), relativePath))) {
    throw new Error(message);
  }
}

function main() {
  const goalsRoutePath = "apps/web/app/api/goals/route.ts";
  const briefingRoutePath = "apps/web/app/api/briefing/route.ts";
  const dashboardPath = "apps/web/components/dashboard.tsx";
  const goalsStatusRoutePath = "apps/web/app/api/goals/jobs/[id]/route.ts";
  const briefingStatusRoutePath = "apps/web/app/api/briefing/jobs/[id]/route.ts";

  const goalsRoute = readRepoFile(goalsRoutePath);
  const briefingRoute = readRepoFile(briefingRoutePath);
  const dashboard = readRepoFile(dashboardPath);

  assertContains(
    goalsRoute,
    "idempotencyKey: parseIdempotencyKey(request)",
    `${goalsRoutePath} must parse and pass idempotency keys for goal creation.`
  );
  assertContains(
    goalsRoute,
    "statusUrl: `/api/goals/jobs/${job.id}`",
    `${goalsRoutePath} must return a goal status route for queued work.`
  );

  assertContains(
    briefingRoute,
    "idempotencyKey: parseIdempotencyKey(request)",
    `${briefingRoutePath} must parse and pass idempotency keys for briefing creation.`
  );
  assertContains(
    briefingRoute,
    "statusUrl: `/api/briefing/jobs/${job.id}`",
    `${briefingRoutePath} must return a briefing status route for queued work.`
  );

  assertFileExists(
    goalsStatusRoutePath,
    `${goalsStatusRoutePath} must exist so clients can poll queued goal jobs.`
  );
  assertFileExists(
    briefingStatusRoutePath,
    `${briefingStatusRoutePath} must exist so clients can poll queued briefing jobs.`
  );

  assertContains(
    dashboard,
    "function buildClientIdempotencyKey(): string",
    `${dashboardPath} must generate client idempotency keys for queued mutations.`
  );
  assertContains(
    dashboard,
    'const queued = await readJson<GoalCreateApiResponse>(',
    `${dashboardPath} must treat goal creation as a queued async flow.`
  );
  assertContains(
    dashboard,
    'const queued = await readJson<BriefingCreateApiResponse>(',
    `${dashboardPath} must treat briefing creation as a queued async flow.`
  );
  assertContains(
    dashboard,
    'const settled = await pollGoalJobUntilSettled(queued.statusUrl);',
    `${dashboardPath} must poll goal job completion before refreshing dashboard data.`
  );
  assertContains(
    dashboard,
    'const settled = await pollBriefingJobUntilSettled(queued.statusUrl);',
    `${dashboardPath} must poll briefing job completion before refreshing dashboard data.`
  );
  const idempotencyHeaderCount = dashboard.match(/"x-idempotency-key": buildClientIdempotencyKey\(\)/gu)?.length ?? 0;
  if (idempotencyHeaderCount < 2) {
    throw new Error(`${dashboardPath} must send idempotency keys for both goal and briefing job creation.`);
  }

  console.log("Performance fitness checks passed.");
}

main();
