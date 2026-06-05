import { runDocsBuild } from "@agentic/docs-runtime";
import { prepareDefaultIntegrations } from "@agentic/integrations";
import {
  createRepository,
  type AgentCatalogRepositoryPort,
  type ApprovalQueueRepositoryPort,
  type CredentialRepositoryPort,
  type DashboardCollectionRepositoryPort,
  type DashboardEventStreamRepositoryPort,
  type DashboardReadRepositoryPort,
  type GovernanceAuditRepositoryPort,
  type GovernanceRepositoryPort,
  type GovernanceRouteRepositoryPort,
  type GovernanceSimulationRepositoryPort,
  type MemoryRepositoryPort,
  type PrivacyRepositoryPort,
  type PrivacyRouteRepositoryPort,
  type ProductRepositoryPort,
  type QueueRepositoryPort,
  type ShareAuditRepositoryPort,
  type TemplateRepositoryPort,
  type WatcherRepositoryPort,
  type WorkspaceRouteRepositoryPort
} from "@agentic/repository";
import { createSelfImprovementRepository, type SelfImprovementRepository } from "@agentic/self-improvement-memory";
import { validateAuthRuntimeState } from "./auth-runtime-state";

declare global {
  // eslint-disable-next-line no-var
  var __agenticRepository: ReturnType<typeof createRepository> | undefined;
  // eslint-disable-next-line no-var
  var __agenticSelfImprovementRepository: SelfImprovementRepository | undefined;
}

export function getRepository() {
  if (!global.__agenticRepository) {
    validateAuthRuntimeState();
    // Respect explicit file-backed test stores so route handlers and test fixtures
    // share the same backend even when DATABASE_URL is configured for other suites.
    global.__agenticRepository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
  }

  return global.__agenticRepository;
}

export async function getSeededRepository() {
  const repository = getRepository();
  await Promise.all([repository.seedDefaults(), prepareDefaultIntegrations()]);
  return repository;
}

export async function getSeededDashboardCollectionRepository(): Promise<DashboardCollectionRepositoryPort> {
  return getSeededRepository();
}

export async function getSeededDashboardEventStreamRepository(): Promise<DashboardEventStreamRepositoryPort> {
  return getSeededRepository();
}

export async function getSeededDashboardReadRepository(): Promise<DashboardReadRepositoryPort> {
  return getSeededRepository();
}

export async function getSeededGovernanceRepository(): Promise<GovernanceRepositoryPort> {
  return getSeededRepository();
}

export async function getSeededGovernanceRouteRepository(): Promise<GovernanceRouteRepositoryPort> {
  return getSeededRepository();
}

export async function getSeededGovernanceSimulationRepository(): Promise<GovernanceSimulationRepositoryPort> {
  return getSeededRepository();
}

export async function getSeededWorkspaceRouteRepository(): Promise<WorkspaceRouteRepositoryPort> {
  return getSeededRepository();
}

export async function getSeededCredentialRepository(): Promise<CredentialRepositoryPort> {
  return getSeededRepository();
}

export async function getSeededMemoryRepository(): Promise<MemoryRepositoryPort> {
  return getSeededRepository();
}

export async function getSeededWatcherRepository(): Promise<WatcherRepositoryPort> {
  return getSeededRepository();
}

export async function getSeededPrivacyRepository(): Promise<PrivacyRepositoryPort> {
  return getSeededRepository();
}

export async function getSeededPrivacyRouteRepository(): Promise<PrivacyRouteRepositoryPort> {
  return getSeededRepository();
}

export async function getSeededGovernanceAuditRepository(): Promise<GovernanceAuditRepositoryPort> {
  return getSeededRepository();
}

export async function getSeededShareAuditRepository(): Promise<ShareAuditRepositoryPort> {
  return getSeededRepository();
}

export async function getSeededTemplateRepository(): Promise<TemplateRepositoryPort> {
  return getSeededRepository();
}

export async function getSeededAgentCatalogRepository(): Promise<AgentCatalogRepositoryPort> {
  return getSeededRepository();
}

export async function getSeededProductRepository(): Promise<ProductRepositoryPort> {
  return getSeededRepository();
}

export async function getSeededQueueRepository(): Promise<QueueRepositoryPort> {
  return getSeededRepository();
}

export async function getSeededApprovalQueueRepository(): Promise<ApprovalQueueRepositoryPort> {
  return getSeededRepository();
}

export function getSelfImprovementRepository(): SelfImprovementRepository {
  if (!global.__agenticSelfImprovementRepository) {
    validateAuthRuntimeState();
    global.__agenticSelfImprovementRepository = createSelfImprovementRepository();
  }

  return global.__agenticSelfImprovementRepository;
}

export async function getSeededSelfImprovementRepository(): Promise<SelfImprovementRepository> {
  const repo = getSelfImprovementRepository();
  await repo.seed();
  return repo;
}

export { runDocsBuild };
