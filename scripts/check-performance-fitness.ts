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
  const goalRefineRoutePath = "apps/web/app/api/goals/[id]/refine/route.ts";
  const briefingRoutePath = "apps/web/app/api/briefing/route.ts";
  const templateRunRoutePath = "apps/web/app/api/templates/[id]/run/route.ts";
  const docsRenderRoutePath = "apps/web/app/api/docs/render/route.ts";
  const publicShareViewRoutePath = "apps/web/app/api/share/view/route.ts";
  const dashboardPath = "apps/web/components/dashboard.tsx";
  const goalsStatusRoutePath = "apps/web/app/api/goals/jobs/[id]/route.ts";
  const briefingStatusRoutePath = "apps/web/app/api/briefing/jobs/[id]/route.ts";
  const templateRunStatusRoutePath = "apps/web/app/api/templates/jobs/[id]/route.ts";
  const docsRenderStatusRoutePath = "apps/web/app/api/docs/jobs/[id]/route.ts";

  const goalsRoute = readRepoFile(goalsRoutePath);
  const goalRefineRoute = readRepoFile(goalRefineRoutePath);
  const briefingRoute = readRepoFile(briefingRoutePath);
  const templateRunRoute = readRepoFile(templateRunRoutePath);
  const docsRenderRoute = readRepoFile(docsRenderRoutePath);
  const publicShareViewRoute = readRepoFile(publicShareViewRoutePath);
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
    goalRefineRoute,
    "idempotencyKey: parseIdempotencyKey(request)",
    `${goalRefineRoutePath} must parse and pass idempotency keys for goal refinement.`
  );
  assertContains(
    goalRefineRoute,
    "statusUrl: `/api/goals/jobs/${job.id}`",
    `${goalRefineRoutePath} must return a goal status route for queued refinements.`
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

  assertContains(
    templateRunRoute,
    "idempotencyKey: parseIdempotencyKey(request)",
    `${templateRunRoutePath} must parse and pass idempotency keys for template execution.`
  );
  assertContains(
    templateRunRoute,
    "statusUrl: `/api/templates/jobs/${job.id}`",
    `${templateRunRoutePath} must return a template status route for queued work.`
  );
  assertContains(
    docsRenderRoute,
    "idempotencyKey: parseIdempotencyKey(request)",
    `${docsRenderRoutePath} must parse and pass idempotency keys for docs rendering.`
  );
  assertContains(
    docsRenderRoute,
    "statusUrl: `/api/docs/jobs/${job.id}`",
    `${docsRenderRoutePath} must return a docs status route for queued work.`
  );
  assertContains(
    publicShareViewRoute,
    "enqueuePublicShareViewJob",
    `${publicShareViewRoutePath} must enqueue public share tracking instead of writing inline state.`
  );
  if (publicShareViewRoute.includes("repository.saveGoalShare(")) {
    throw new Error(`${publicShareViewRoutePath} must not persist share state on the anonymous request path.`);
  }
  if (publicShareViewRoute.includes("repository.saveGoalBundle(")) {
    throw new Error(`${publicShareViewRoutePath} must not append share activity logs on the anonymous request path.`);
  }

  assertFileExists(
    goalsStatusRoutePath,
    `${goalsStatusRoutePath} must exist so clients can poll queued goal jobs.`
  );
  assertFileExists(
    briefingStatusRoutePath,
    `${briefingStatusRoutePath} must exist so clients can poll queued briefing jobs.`
  );
  assertFileExists(
    templateRunStatusRoutePath,
    `${templateRunStatusRoutePath} must exist so clients can poll queued template jobs.`
  );
  assertFileExists(
    docsRenderStatusRoutePath,
    `${docsRenderStatusRoutePath} must exist so clients can poll queued docs jobs.`
  );

  assertContains(
    dashboard,
    "function buildClientIdempotencyKey(): string",
    `${dashboardPath} must generate client idempotency keys for queued mutations.`
  );
  assertContains(
    dashboard,
    'const queued = await readJson<GoalQueuedApiResponse>(',
    `${dashboardPath} must treat goal creation as a queued async flow.`
  );
  assertContains(
    dashboard,
    'const queued = await readJson<BriefingCreateApiResponse>(',
    `${dashboardPath} must treat briefing creation as a queued async flow.`
  );
  assertContains(
    dashboard,
    'const queued = await readJson<TemplateRunApiResponse>(',
    `${dashboardPath} must treat template execution as a queued async flow.`
  );
  assertContains(
    dashboard,
    'const queued = await readJson<DocsRenderApiResponse>(',
    `${dashboardPath} must treat docs rendering as a queued async flow.`
  );
  assertContains(
    dashboard,
    'const settled = await pollGoalJobUntilSettled(queued.statusUrl);',
    `${dashboardPath} must poll goal job completion before refreshing dashboard data.`
  );
  assertContains(
    dashboard,
    'await fetch(`/api/goals/${encodeURIComponent(goalId)}/refine`, {',
    `${dashboardPath} must refine goals through the queued async route.`
  );
  assertContains(
    dashboard,
    'const settled = await pollBriefingJobUntilSettled(queued.statusUrl);',
    `${dashboardPath} must poll briefing job completion before refreshing dashboard data.`
  );
  assertContains(
    dashboard,
    'const settled = await pollTemplateRunJobUntilSettled(queued.statusUrl);',
    `${dashboardPath} must poll template job completion before refreshing dashboard data.`
  );
  assertContains(
    dashboard,
    'const settled = await pollDocsRenderJobUntilSettled(queued.statusUrl);',
    `${dashboardPath} must poll docs job completion before surfacing the build result.`
  );
  const idempotencyHeaderCount = dashboard.match(/"x-idempotency-key": buildClientIdempotencyKey\(\)/gu)?.length ?? 0;
  if (idempotencyHeaderCount < 5) {
    throw new Error(`${dashboardPath} must send idempotency keys for goal creation, goal refinement, briefing creation, template execution, and docs rendering.`);
  }

  console.log("Performance fitness checks passed.");
}

main();
