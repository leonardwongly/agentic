import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createRepository,
  type AgentCatalogRepositoryPort,
  type AgenticRepository,
  type ApprovalQueueRepositoryPort,
  type CredentialRepositoryPort,
  type DashboardCollectionRepositoryPort,
  type DashboardEventStreamRepositoryPort,
  type DashboardReadRepositoryPort,
  type GovernanceRepositoryPort,
  type MemoryRepositoryPort,
  type PrivacyRepositoryPort,
  type ProductRepositoryPort,
  type QueueRepositoryPort,
  type ReadinessRepositoryPort,
  type RepositoryLifecyclePort,
  type ShareAuditRepositoryPort,
  type TemplateRepositoryPort,
  type WatcherRepositoryPort,
  type WorkerRuntimeRepositoryPort
} from "@agentic/repository";

function assertPortAssignments(repository: AgenticRepository) {
  const lifecycle: RepositoryLifecyclePort = repository;
  const queue: QueueRepositoryPort = repository;
  const approvalQueue: ApprovalQueueRepositoryPort = repository;
  const dashboardCollection: DashboardCollectionRepositoryPort = repository;
  const dashboardEventStream: DashboardEventStreamRepositoryPort = repository;
  const dashboardRead: DashboardReadRepositoryPort = repository;
  const governance: GovernanceRepositoryPort = repository;
  const credential: CredentialRepositoryPort = repository;
  const memory: MemoryRepositoryPort = repository;
  const watcher: WatcherRepositoryPort = repository;
  const privacy: PrivacyRepositoryPort = repository;
  const shareAudit: ShareAuditRepositoryPort = repository;
  const template: TemplateRepositoryPort = repository;
  const agentCatalog: AgentCatalogRepositoryPort = repository;
  const product: ProductRepositoryPort = repository;
  const readiness: ReadinessRepositoryPort = repository;
  const workerRuntime: WorkerRuntimeRepositoryPort = repository;

  return {
    lifecycle,
    queue,
    approvalQueue,
    dashboardCollection,
    dashboardEventStream,
    dashboardRead,
    governance,
    credential,
    memory,
    watcher,
    privacy,
    shareAudit,
    template,
    agentCatalog,
    product,
    readiness,
    workerRuntime
  };
}

const portMethods = {
  RepositoryLifecyclePort: ["seedDefaults"],
  QueueRepositoryPort: ["listJobs", "getJob", "enqueueJob", "claimNextJob", "completeJob", "retryJob", "deadLetterJob"],
  ApprovalQueueRepositoryPort: ["respondToApproval", "respondToApprovalAndEnqueueJob", "enqueueJob"],
  DashboardCollectionRepositoryPort: ["listGoalsPage", "listCommitments", "listJobs", "listMemoryPage"],
  DashboardEventStreamRepositoryPort: ["getDashboardData", "listJobs"],
  DashboardReadRepositoryPort: ["getDashboardData"],
  GovernanceRepositoryPort: [
    "listWorkspaces",
    "saveWorkspace",
    "listWorkspaceMembers",
    "saveWorkspaceMember",
    "getWorkspaceSelection",
    "saveWorkspaceSelection",
    "getWorkspaceGovernance",
    "saveWorkspaceGovernance"
  ],
  CredentialRepositoryPort: [
    "listIntegrations",
    "listIntegrationsPage",
    "upsertIntegration",
    "listProviderCredentials",
    "getProviderCredential",
    "saveProviderCredential",
    "getProviderCredentialSecret",
    "saveProviderCredentialSecret",
    "reserveProviderSideEffect",
    "updateProviderSideEffect"
  ],
  MemoryRepositoryPort: [
    "listMemory",
    "listContextPacketMemory",
    "listMemoryPage",
    "saveMemory",
    "saveEvidenceRecord",
    "listEvidenceRecords"
  ],
  WatcherRepositoryPort: ["listWatchers", "listWatchersPage", "claimWatcherLease", "saveWatcher", "claimAutopilotEvent"],
  PrivacyRepositoryPort: [
    "listPrivacyOperations",
    "getPrivacyOperation",
    "savePrivacyOperation",
    "enforceWorkspaceRetention",
    "deleteWorkspaceData",
    "exportWorkspaceAudit"
  ],
  ShareAuditRepositoryPort: [
    "listGoalShares",
    "getGoalShare",
    "getGoalShareByTokenFingerprint",
    "saveGoalShare",
    "getGoalBundle",
    "saveGoalBundle",
    "appendGoalActionLogs",
    "exportWorkspaceAudit"
  ],
  TemplateRepositoryPort: [
    "listTemplates",
    "saveTemplate",
    "deleteTemplate",
    "listWorkflowTemplates",
    "getWorkflowTemplate",
    "saveWorkflowTemplate",
    "deleteWorkflowTemplate"
  ],
  AgentCatalogRepositoryPort: ["listAgents", "getAgent", "saveAgent", "deleteAgent", "getAgentMetrics", "saveAgentMetrics"],
  ProductRepositoryPort: [
    "listOperatorProducts",
    "getOperatorProductSelection",
    "saveOperatorProduct",
    "saveOperatorProductSelection"
  ],
  ReadinessRepositoryPort: ["listJobs", "listProviderCredentials"],
  WorkerRuntimeRepositoryPort: [
    "listJobs",
    "getJob",
    "enqueueJob",
    "claimNextJob",
    "completeJob",
    "retryJob",
    "deadLetterJob",
    "respondToApproval",
    "respondToApprovalAndEnqueueJob",
    "getDashboardData",
    "listWorkspaces",
    "saveWorkspace",
    "listWorkspaceMembers",
    "saveWorkspaceMember",
    "getWorkspaceSelection",
    "saveWorkspaceSelection",
    "getWorkspaceGovernance",
    "saveWorkspaceGovernance",
    "listIntegrations",
    "listIntegrationsPage",
    "upsertIntegration",
    "listProviderCredentials",
    "getProviderCredential",
    "saveProviderCredential",
    "getProviderCredentialSecret",
    "saveProviderCredentialSecret",
    "reserveProviderSideEffect",
    "updateProviderSideEffect",
    "listMemory",
    "listContextPacketMemory",
    "listMemoryPage",
    "saveMemory",
    "saveEvidenceRecord",
    "listEvidenceRecords",
    "listWatchers",
    "listWatchersPage",
    "claimWatcherLease",
    "saveWatcher",
    "claimAutopilotEvent",
    "listPrivacyOperations",
    "getPrivacyOperation",
    "savePrivacyOperation",
    "enforceWorkspaceRetention",
    "deleteWorkspaceData",
    "exportWorkspaceAudit",
    "listGoalShares",
    "getGoalShare",
    "getGoalShareByTokenFingerprint",
    "saveGoalShare",
    "getGoalBundle",
    "saveGoalBundle",
    "appendGoalActionLogs",
    "listTemplates",
    "saveTemplate",
    "deleteTemplate",
    "listWorkflowTemplates",
    "getWorkflowTemplate",
    "saveWorkflowTemplate",
    "deleteWorkflowTemplate",
    "listAgents",
    "getAgent",
    "saveAgent",
    "deleteAgent",
    "getAgentMetrics",
    "saveAgentMetrics",
    "getGoalBundleForUser",
    "listGoals",
    "listApprovals",
    "getBriefingPreferences",
    "listAutopilotEvents",
    "saveAutopilotEvent"
  ]
} as const;

describe("repository ports", () => {
  it("keeps the backing repository assignable to every narrow port", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repository-ports-"));
    const repository = createRepository({
      storePath: path.join(tempDir, "runtime-store.json")
    });

    expect(assertPortAssignments(repository).lifecycle.backend).toBe("file");
  });

  it("keeps every named port backed by concrete repository methods", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repository-port-methods-"));
    const repository = createRepository({
      storePath: path.join(tempDir, "runtime-store.json")
    });

    for (const [portName, methods] of Object.entries(portMethods)) {
      for (const method of methods) {
        expect(typeof repository[method as keyof AgenticRepository]).toBe("function");
      }

      expect(portName).toMatch(/Port$/);
    }
  });
});
