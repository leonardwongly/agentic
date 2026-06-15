import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

function readRepoFile(relativePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

function readRepoDirectory(relativePath: string): string[] {
  return readdirSync(path.resolve(process.cwd(), relativePath));
}

function countLines(content: string): number {
  return content.split(/\r?\n/gu).length;
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

function assertMaxLines(content: string, maxLines: number, label: string) {
  const lineCount = countLines(content);
  if (lineCount > maxLines) {
    throw new Error(`${label} exceeds its line budget (${lineCount} > ${maxLines}).`);
  }
}

function main() {
  const goalsRoutePath = "apps/web/app/api/goals/route.ts";
  const goalRefineRoutePath = "apps/web/app/api/goals/[id]/refine/route.ts";
  const briefingRoutePath = "apps/web/app/api/briefing/route.ts";
  const docsRenderRoutePath = "apps/web/app/api/docs/render/route.ts";
  const governanceRoutePath = "apps/web/app/api/governance/route.ts";
  const governanceAuditRoutePath = "apps/web/app/api/governance/audit/route.ts";
  const governancePrivacyRoutePath = "apps/web/app/api/governance/privacy/route.ts";
  const governanceSimulateRoutePath = "apps/web/app/api/governance/simulate/route.ts";
  const workspacesRoutePath = "apps/web/app/api/workspaces/route.ts";
  const commitmentsRoutePath = "apps/web/app/api/commitments/[id]/route.ts";
  const nlIntentRoutePath = "apps/web/app/api/nl/intent/route.ts";
  const autopilotEventsRoutePath = "apps/web/app/api/autopilot/events/route.ts";
  const templateRunRoutePath = "apps/web/app/api/templates/[id]/run/route.ts";
  const publicShareViewRoutePath = "apps/web/app/api/share/view/route.ts";
  const templatesRoutePath = "apps/web/app/api/templates/[id]/route.ts";
  const webServerPath = "apps/web/lib/server.ts";
  const abuseRateLimitPath = "apps/web/lib/abuse-rate-limit.ts";
  const repositoryPath = "packages/repository/src/index.ts";
  const workerEntryPath = "apps/worker/src/index.ts";
  const runtimeReadinessPath = "apps/web/lib/runtime-readiness.ts";
  const dashboardPath = "apps/web/components/dashboard.tsx";
  const dashboardAsyncPath = "apps/web/components/dashboard-async.ts";
  const dashboardCockpitPath = "apps/web/components/dashboard-cockpit.tsx";
  const dashboardHooksPath = "apps/web/components/dashboard-hooks.ts";
  const dashboardPrimarySectionsPath = "apps/web/components/dashboard-primary-sections.tsx";
  const dashboardShellPath = "apps/web/components/dashboard-shell.tsx";
  const dashboardCollectionPath = "apps/web/lib/dashboard-collection.ts";
  const dashboardSummaryRoutePath = "apps/web/app/api/dashboard/summary/route.ts";
  const dashboardApprovalsRoutePath = "apps/web/app/api/dashboard/approvals/route.ts";
  const dashboardCommitmentsRoutePath = "apps/web/app/api/dashboard/commitments/route.ts";
  const dashboardJobsRoutePath = "apps/web/app/api/dashboard/jobs/route.ts";
  const dashboardEventsRoutePath = "apps/web/app/api/dashboard/events/route.ts";
  const dashboardActivityRoutePath = "apps/web/app/api/dashboard/activity/route.ts";
  const dashboardMemoriesRoutePath = "apps/web/app/api/dashboard/memories/route.ts";
  const dashboardArtifactsRoutePath = "apps/web/app/api/dashboard/artifacts/route.ts";
  const dashboardSurfacePath = "apps/web/lib/dashboard-surface.ts";
  const repositoryTypesPath = "packages/repository/src/repository-types.ts";
  const workerRuntimePath = "packages/worker-runtime/src/index.ts";
  const workerJobDispatchPath = "packages/worker-runtime/src/job-dispatch.ts";
  const watcherSchedulerPath = "packages/worker-runtime/src/watcher-scheduler.ts";
  const privacyShareExecutorsPath = "packages/worker-runtime/src/privacy-share-executors.ts";
  const googleWorkspaceAdaptersPath = "packages/worker-runtime/src/google-workspace-adapters.ts";
  const memoryCaptureSignalsPath = "packages/worker-runtime/src/memory-capture-signals.ts";
  const workerJobPayloadsPath = "packages/worker-runtime/src/job-payloads.ts";
  const publicShareLogPath = "packages/worker-runtime/src/public-share-log.ts";
  const workerRuntimeDirectoryPath = "packages/worker-runtime/src";
  const decompositionDocPath = "docs/architecture/phase-1-decomposition-boundaries.md";

  const goalsRoute = readRepoFile(goalsRoutePath);
  const goalRefineRoute = readRepoFile(goalRefineRoutePath);
  const briefingRoute = readRepoFile(briefingRoutePath);
  const docsRenderRoute = readRepoFile(docsRenderRoutePath);
  const governanceRoute = readRepoFile(governanceRoutePath);
  const governanceAuditRoute = readRepoFile(governanceAuditRoutePath);
  const governancePrivacyRoute = readRepoFile(governancePrivacyRoutePath);
  const governanceSimulateRoute = readRepoFile(governanceSimulateRoutePath);
  const workspacesRoute = readRepoFile(workspacesRoutePath);
  const commitmentsRoute = readRepoFile(commitmentsRoutePath);
  const nlIntentRoute = readRepoFile(nlIntentRoutePath);
  const autopilotEventsRoute = readRepoFile(autopilotEventsRoutePath);
  const templateRunRoute = readRepoFile(templateRunRoutePath);
  const publicShareViewRoute = readRepoFile(publicShareViewRoutePath);
  const templatesRoute = readRepoFile(templatesRoutePath);
  const webServer = readRepoFile(webServerPath);
  const abuseRateLimit = readRepoFile(abuseRateLimitPath);
  const repository = readRepoFile(repositoryPath);
  const workerEntry = readRepoFile(workerEntryPath);
  const runtimeReadiness = readRepoFile(runtimeReadinessPath);
  const dashboard = readRepoFile(dashboardPath);
  const dashboardAsync = readRepoFile(dashboardAsyncPath);
  const dashboardCockpit = readRepoFile(dashboardCockpitPath);
  const dashboardHooks = readRepoFile(dashboardHooksPath);
  const dashboardPrimarySections = readRepoFile(dashboardPrimarySectionsPath);
  const dashboardShell = readRepoFile(dashboardShellPath);
  const dashboardCollection = readRepoFile(dashboardCollectionPath);
  const dashboardSummaryRoute = readRepoFile(dashboardSummaryRoutePath);
  const dashboardApprovalsRoute = readRepoFile(dashboardApprovalsRoutePath);
  const dashboardCommitmentsRoute = readRepoFile(dashboardCommitmentsRoutePath);
  const dashboardJobsRoute = readRepoFile(dashboardJobsRoutePath);
  const dashboardEventsRoute = readRepoFile(dashboardEventsRoutePath);
  const dashboardActivityRoute = readRepoFile(dashboardActivityRoutePath);
  const dashboardMemoriesRoute = readRepoFile(dashboardMemoriesRoutePath);
  const dashboardArtifactsRoute = readRepoFile(dashboardArtifactsRoutePath);
  const dashboardSurface = readRepoFile(dashboardSurfacePath);
  const repositoryTypes = readRepoFile(repositoryTypesPath);
  const workerRuntime = readRepoFile(workerRuntimePath);
  const workerJobDispatch = readRepoFile(workerJobDispatchPath);
  const watcherScheduler = readRepoFile(watcherSchedulerPath);
  const privacyShareExecutors = readRepoFile(privacyShareExecutorsPath);
  const googleWorkspaceAdapters = readRepoFile(googleWorkspaceAdaptersPath);
  const memoryCaptureSignals = readRepoFile(memoryCaptureSignalsPath);
  const workerJobPayloads = readRepoFile(workerJobPayloadsPath);
  const publicShareLog = readRepoFile(publicShareLogPath);
  const workerRuntimeFiles = readRepoDirectory(workerRuntimeDirectoryPath)
    .filter((file) => file.endsWith(".ts"))
    .map((file) => {
      const filePath = `${workerRuntimeDirectoryPath}/${file}`;
      return [filePath, readRepoFile(filePath)] as const;
    });
  const decompositionDoc = readRepoFile(decompositionDocPath);

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
    abuseRateLimit,
    "buildAbuseRateLimitKey(",
    `${abuseRateLimitPath} must expose a reusable namespaced abuse-rate-limit key builder.`
  );
  assertContains(
    goalsRoute,
    "checkAbuseRateLimit(",
    `${goalsRoutePath} must enforce abuse-rate limiting on goal creation.`
  );
  assertContains(
    goalRefineRoute,
    "checkAbuseRateLimit(",
    `${goalRefineRoutePath} must enforce abuse-rate limiting on goal refinement.`
  );
  assertContains(
    briefingRoute,
    "checkAbuseRateLimit(",
    `${briefingRoutePath} must enforce abuse-rate limiting on briefing creation.`
  );
  assertContains(
    docsRenderRoute,
    "checkAbuseRateLimit(",
    `${docsRenderRoutePath} must enforce abuse-rate limiting on docs rendering.`
  );
  assertContains(
    templateRunRoute,
    "checkAbuseRateLimit(",
    `${templateRunRoutePath} must enforce abuse-rate limiting on template execution.`
  );
  assertContains(
    governancePrivacyRoute,
    "checkAbuseRateLimit(",
    `${governancePrivacyRoutePath} must enforce abuse-rate limiting on privacy operations.`
  );
  assertContains(
    governanceAuditRoute,
    "checkAbuseRateLimit(",
    `${governanceAuditRoutePath} must enforce abuse-rate limiting on audit exports.`
  );
  assertContains(
    autopilotEventsRoute,
    "checkAbuseRateLimit(",
    `${autopilotEventsRoutePath} must enforce abuse-rate limiting on autopilot event creation.`
  );
  assertContains(
    nlIntentRoute,
    "checkAbuseRateLimit(",
    `${nlIntentRoutePath} must enforce abuse-rate limiting on NL command execution.`
  );
  assertContains(
    publicShareViewRoute,
    "checkSessionRateLimit(",
    `${publicShareViewRoutePath} must enforce anonymous share-view rate limiting.`
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
    "await repository.getProviderCredentialReadinessSummary(",
    `${runtimeReadinessPath} must inspect bounded provider credential health when computing readiness.`
  );
  assertContains(
    runtimeReadiness,
    "ReadinessRepositoryPort",
    `${runtimeReadinessPath} must type readiness probes against a narrow repository port.`
  );
  assertNotContains(
    runtimeReadiness,
    "AgenticRepository",
    `${runtimeReadinessPath} must not depend on the full repository surface.`
  );
  assertContains(
    dashboard,
    "DashboardOperationsTowerCard",
    `${dashboardPath} must render the operations control tower surface.`
  );
  assertContains(
    repository,
    'from "./repository-types";',
    `${repositoryPath} must keep the shared repository type facade in ${repositoryTypesPath}.`
  );
  assertContains(
    repository,
    "DashboardDiagnosticTarget",
    `${repositoryPath} must re-export dashboard diagnostic targets for UI consumers.`
  );
  assertContains(
    repositoryTypes,
    "export type DashboardDiagnosticTarget = {",
    `${repositoryTypesPath} must own dashboard diagnostic target types.`
  );
  for (const portName of [
    "RepositoryLifecyclePort",
    "QueueRepositoryPort",
    "ApprovalQueueRepositoryPort",
    "DashboardCollectionRepositoryPort",
    "DashboardEventStreamRepositoryPort",
    "DashboardReadRepositoryPort",
    "GovernanceAuditRepositoryPort",
    "GovernanceRepositoryPort",
    "GovernanceRouteRepositoryPort",
    "GovernanceSimulationRepositoryPort",
    "CredentialRepositoryPort",
    "MemoryRepositoryPort",
    "WatcherRepositoryPort",
    "PrivacyRepositoryPort",
    "PrivacyRouteRepositoryPort",
    "ShareAuditRepositoryPort",
    "TemplateRepositoryPort",
    "AgentCatalogRepositoryPort",
    "ProductRepositoryPort",
    "ReadinessRepositoryPort",
    "WorkspaceRouteRepositoryPort",
    "WorkerRuntimeRepositoryPort"
  ]) {
    assertContains(
      repositoryTypes,
      `export type ${portName}`,
      `${repositoryTypesPath} must expose ${portName} so consumers can avoid the full repository surface.`
    );
  }
  assertContains(
    workerRuntime,
    'from "./job-payloads";',
    `${workerRuntimePath} must source job payload builders from ${workerJobPayloadsPath}.`
  );
  assertContains(
    workerRuntime,
    'from "./public-share-log";',
    `${workerRuntimePath} must source share-view action log helpers from ${publicShareLogPath}.`
  );
  assertContains(
    workerJobPayloads,
    "buildAutopilotProcessJobIdempotencyKey",
    `${workerJobPayloadsPath} must own deterministic autopilot idempotency-key derivation.`
  );
  assertContains(
    workerJobPayloads,
    "buildBriefingCreateJobIdempotencyKey",
    `${workerJobPayloadsPath} must own deterministic briefing idempotency-key derivation.`
  );
  assertContains(
    publicShareLog,
    "createPublicShareViewedLog",
    `${publicShareLogPath} must own public share view action-log shaping.`
  );
  for (const [filePath, content] of workerRuntimeFiles) {
    assertNotContains(
      content,
      "AgenticRepository",
      `${filePath} must depend on named repository ports instead of the full AgenticRepository surface.`
    );
  }
  assertContains(
    workerRuntime,
    "WorkerRuntimeRepositoryPort",
    `${workerRuntimePath} must type runtime orchestration against the worker runtime repository port.`
  );
  assertContains(
    workerJobDispatch,
    "QueueRepositoryPort",
    `${workerJobDispatchPath} must type enqueue helpers against the queue repository port.`
  );
  assertContains(
    watcherScheduler,
    "WatcherRepositoryPort",
    `${watcherSchedulerPath} must type scheduler access against the watcher repository port.`
  );
  assertContains(
    dashboard,
    'from "./dashboard-async";',
    `${dashboardPath} must consume extracted async dashboard helpers from ${dashboardAsyncPath}.`
  );
  assertContains(
    dashboardAsync,
    "pollJobStatusUntilSettled",
    `${dashboardAsyncPath} must own bounded async polling helpers.`
  );
  assertContains(
    dashboard,
    'from "./dashboard-hooks";',
    `${dashboardPath} must source dashboard data hooks from ${dashboardHooksPath}.`
  );
  assertContains(
    dashboard,
    'from "./dashboard-cockpit";',
    `${dashboardPath} must source cockpit IA surfaces from ${dashboardCockpitPath}.`
  );
  assertContains(
    dashboard,
    'from "./dashboard-primary-sections";',
    `${dashboardPath} must source extracted operating cards from ${dashboardPrimarySectionsPath}.`
  );
  assertContains(
    dashboard,
    'from "./dashboard-shell";',
    `${dashboardPath} must source dashboard providers and shell chrome from ${dashboardShellPath}.`
  );
  assertNotContains(
    dashboard,
    "KeyboardShortcutsProvider",
    `${dashboardPath} must not own dashboard providers after shell extraction.`
  );
  assertContains(
    dashboardHooks,
    "useDashboardSnapshot",
    `${dashboardHooksPath} must own the dashboard snapshot state hook.`
  );
  for (const hook of [
    "useDashboardGoalActionsState",
    "useDashboardApprovalActionsState",
    "useDashboardCommitmentActionsState",
    "useDashboardBriefingActionsState",
    "useDashboardTemplateActionsState",
    "useDashboardWorkspaceActionsState",
    "useDashboardNotesActionsState"
  ]) {
    assertContains(
      dashboardHooks,
      hook,
      `${dashboardHooksPath} must expose ${hook} for dashboard action/data state boundaries.`
    );
  }
  for (const shellConcern of [
    "ApprovalNavigationProvider",
    "KeyboardShortcutsProvider",
    "NLFloatingBar",
    "StatsBar",
    "ToastContainer",
    "CommandPalette",
    "QuickActionsBar"
  ]) {
    assertContains(
      dashboardShell,
      shellConcern,
      `${dashboardShellPath} must own ${shellConcern} dashboard shell wiring.`
    );
  }
  assertContains(
    dashboardCockpit,
    "DashboardCockpitLanes",
    `${dashboardCockpitPath} must own exception-first cockpit lane rendering.`
  );
  assertContains(
    dashboardCockpit,
    "DashboardDetailDrawer",
    `${dashboardCockpitPath} must own the canonical detail drawer.`
  );
  assertContains(
    dashboardPrimarySections,
    "ReliabilityCard",
    `${dashboardPrimarySectionsPath} must own the reliability card boundary.`
  );
  assertContains(
    dashboardPrimarySections,
    "NowQueueCard",
    `${dashboardPrimarySectionsPath} must own the now queue card boundary.`
  );
  assertContains(
    repository,
    'from "./dashboard-summary";',
    `${repositoryPath} must re-export the bounded dashboard summary contract.`
  );
  assertContains(
    dashboardSummaryRoute,
    "buildDashboardSummary",
    `${dashboardSummaryRoutePath} must serve the bounded first-paint dashboard summary.`
  );
  assertContains(
    dashboardCollection,
    "MAX_COLLECTION_PAGE_LIMIT",
    `${dashboardCollectionPath} must enforce the shared collection page-size ceiling.`
  );
  assertContains(
    dashboardCollection,
    "Unknown dashboard query parameter",
    `${dashboardCollectionPath} must reject unknown collection query parameters.`
  );
  assertNotContains(
    dashboardCollection,
    "AgenticRepository",
    `${dashboardCollectionPath} must depend on DashboardCollectionRepositoryPort instead of the full repository surface.`
  );
  assertContains(
    webServer,
    "getSeededDashboardCollectionRepository",
    `${webServerPath} must expose a seeded dashboard collection repository accessor.`
  );
  assertContains(
    webServer,
    "DashboardCollectionRepositoryPort",
    `${webServerPath} must type dashboard collection access against a narrow repository port.`
  );
  assertContains(
    webServer,
    "getSeededDashboardEventStreamRepository",
    `${webServerPath} must expose a seeded dashboard event stream repository accessor.`
  );
  assertContains(
    webServer,
    "DashboardEventStreamRepositoryPort",
    `${webServerPath} must type dashboard event streams against a narrow repository port.`
  );
  assertContains(
    dashboardEventsRoute,
    "getSeededDashboardEventStreamRepository",
    `${dashboardEventsRoutePath} must request the narrow dashboard event stream repository port.`
  );
  for (const [accessorName, portName] of [
    ["getSeededDashboardReadRepository", "DashboardReadRepositoryPort"],
    ["getSeededGovernanceAuditRepository", "GovernanceAuditRepositoryPort"],
    ["getSeededGovernanceRepository", "GovernanceRepositoryPort"],
    ["getSeededGovernanceRouteRepository", "GovernanceRouteRepositoryPort"],
    ["getSeededGovernanceSimulationRepository", "GovernanceSimulationRepositoryPort"],
    ["getSeededCredentialRepository", "CredentialRepositoryPort"],
    ["getSeededMemoryRepository", "MemoryRepositoryPort"],
    ["getSeededWatcherRepository", "WatcherRepositoryPort"],
    ["getSeededPrivacyRepository", "PrivacyRepositoryPort"],
    ["getSeededPrivacyRouteRepository", "PrivacyRouteRepositoryPort"],
    ["getSeededShareAuditRepository", "ShareAuditRepositoryPort"],
    ["getSeededTemplateRepository", "TemplateRepositoryPort"],
    ["getSeededAgentCatalogRepository", "AgentCatalogRepositoryPort"],
    ["getSeededProductRepository", "ProductRepositoryPort"],
    ["getSeededQueueRepository", "QueueRepositoryPort"],
    ["getSeededApprovalQueueRepository", "ApprovalQueueRepositoryPort"],
    ["getSeededWorkspaceRouteRepository", "WorkspaceRouteRepositoryPort"]
  ] as const) {
    assertContains(
      webServer,
      accessorName,
      `${webServerPath} must expose ${accessorName} for route-level repository port migration.`
    );
    assertContains(
      webServer,
      portName,
      `${webServerPath} must type ${accessorName} against ${portName}.`
    );
  }
  assertContains(
    governanceRoute,
    "getSeededGovernanceRouteRepository",
    `${governanceRoutePath} must request the narrow governance route repository port.`
  );
  assertNotContains(
    governanceRoute,
    "getSeededRepository",
    `${governanceRoutePath} must not request the full seeded repository surface.`
  );
  for (const [routePath, routeContent, accessorName] of [
    [governanceAuditRoutePath, governanceAuditRoute, "getSeededGovernanceAuditRepository"],
    [governancePrivacyRoutePath, governancePrivacyRoute, "getSeededPrivacyRouteRepository"],
    [governanceSimulateRoutePath, governanceSimulateRoute, "getSeededGovernanceSimulationRepository"],
    [workspacesRoutePath, workspacesRoute, "getSeededWorkspaceRouteRepository"]
  ] as const) {
    assertContains(
      routeContent,
      accessorName,
      `${routePath} must request the narrow repository accessor ${accessorName}.`
    );
    assertNotContains(
      routeContent,
      "getSeededRepository",
      `${routePath} must not request the full seeded repository surface.`
    );
  }
  for (const route of [
    [dashboardApprovalsRoutePath, dashboardApprovalsRoute],
    [dashboardCommitmentsRoutePath, dashboardCommitmentsRoute],
    [dashboardJobsRoutePath, dashboardJobsRoute],
    [dashboardActivityRoutePath, dashboardActivityRoute],
    [dashboardMemoriesRoutePath, dashboardMemoriesRoute],
    [dashboardArtifactsRoutePath, dashboardArtifactsRoute]
  ] as const) {
    assertContains(
      route[1],
      "parseDashboardCollectionQuery",
      `${route[0]} must validate dashboard collection query parameters.`
    );
    assertContains(
      route[1],
      "buildDashboardCollectionPage",
      `${route[0]} must return bounded dashboard collection pages.`
    );
    assertContains(
      route[1],
      "principal.userId",
      `${route[0]} must scope collection data to the authenticated principal.`
    );
    assertContains(
      route[1],
      "getSeededDashboardCollectionRepository",
      `${route[0]} must request the narrow dashboard collection repository port.`
    );
  }
  assertContains(
    decompositionDoc,
    "## Repository Boundary",
    `${decompositionDocPath} must document the repository boundary.`
  );
  assertContains(
    decompositionDoc,
    "Repository Port Rules",
    `${decompositionDocPath} must document narrow repository port rules.`
  );
  assertContains(
    decompositionDoc,
    "## Worker Runtime Boundary",
    `${decompositionDocPath} must document the worker-runtime boundary.`
  );
  assertContains(
    decompositionDoc,
    "## Dashboard Boundary",
    `${decompositionDocPath} must document the dashboard boundary.`
  );
  assertContains(
    decompositionDoc,
    "## Line Budgets",
    `${decompositionDocPath} must document hotspot line budgets.`
  );
  assertMaxLines(repository, 8050, repositoryPath);
  assertMaxLines(workerRuntime, 1650, workerRuntimePath);
  // AOS-T2 (#1016): flywheel-activation threads workflowTrust through the dashboard's
  // recommendation load states. Modest bump; AOS-16 dashboard decomposition is the path to reduce this.
  assertMaxLines(dashboard, 3165, dashboardPath);
  assertMaxLines(dashboardCockpit, 450, dashboardCockpitPath);
  assertMaxLines(dashboardPrimarySections, 500, dashboardPrimarySectionsPath);
  assertMaxLines(dashboardShell, 180, dashboardShellPath);
  assertMaxLines(dashboardHooks, 280, dashboardHooksPath);
  assertMaxLines(dashboardCollection, 230, dashboardCollectionPath);
  assertContains(
    dashboardSurface,
    "\"operations\"",
    `${dashboardSurfacePath} must expose the operations section to the advanced dashboard surface.`
  );

  console.log("Architecture fitness checks passed.");
}

main();
