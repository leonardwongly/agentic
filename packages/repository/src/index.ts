import { FileRepository } from "./file-repository";
import { PostgresRepository } from "./postgres-repository";
import { assertWorkspaceGovernanceStartupConfig } from "./governance-defaults";
import type { AgenticRepository } from "./repository-types";

export { CommitmentInboxQueryError } from "./commitment-helpers";
export { CollectionPageQueryError } from "./collection-pagination";
export { resolveWorkspaceGovernanceDefaultsFromEnv } from "./governance-defaults";
export {
  ApprovalMutationError,
  JobMutationError,
  type AgenticRepository,
  type AutopilotEventClaim,
  type CollectionPageParams,
  type DashboardCollectionPage,
  type DashboardCollectionPageParams,
  type DashboardCollectionSort,
  type DashboardControlPlane,
  type DashboardControlPlaneSection,
  type DashboardData,
  type DashboardDiagnostic,
  type DashboardDiagnosticTarget,
  type DashboardDiagnostics,
  type GoalPageParams,
  type GoalShareListFilters,
  type PrivacyOperationListFilters,
  type WatcherListFilters,
  type WatcherPageParams,
  type WorkspaceAuditExport,
  type WorkspaceDeleteParams,
  type WorkspaceRetentionParams
} from "./repository-types";
export { FileRepository } from "./file-repository";
export { PostgresRepository } from "./postgres-repository";
export {
  resolveDashboardCockpitRollout,
  type DashboardCockpitRollout,
  type DashboardCockpitVariant
} from "./dashboard-cockpit-rollout";
export {
  buildDashboardTraceability,
  type DashboardApprovalTrace,
  type DashboardMemoryProvenance,
  type DashboardTaskTrace,
  type DashboardTraceability,
  type DashboardWorkflowTrace
} from "./dashboard-traceability";
export { buildExecutionProvenanceGraph } from "./provenance-graph";
export { buildDashboardSummary, type DashboardSummary, type DashboardSummaryLane } from "./dashboard-summary";
export {
  listDashboardActionLogsPage,
  listDashboardApprovalsPage,
  listDashboardArtifactsPage,
  listDashboardCommitmentsPage,
  listDashboardJobsPage,
  listDashboardMemoryPage
} from "./dashboard-collection-page";

export function createRepository(options?: { storePath?: string; databaseUrl?: string }): AgenticRepository {
  assertWorkspaceGovernanceStartupConfig();

  const databaseUrl =
    options?.databaseUrl ?? (options?.storePath === undefined ? process.env.DATABASE_URL : undefined);

  if (databaseUrl) {
    return new PostgresRepository(databaseUrl);
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "DATABASE_URL must be configured in production. The file-backed repository is development-only."
    );
  }

  return new FileRepository(options?.storePath);
}
