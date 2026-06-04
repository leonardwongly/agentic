import { runDocsBuild } from "@agentic/docs-runtime";
import { prepareDefaultIntegrations } from "@agentic/integrations";
import {
  createRepository,
  type DashboardCollectionRepositoryPort,
  type DashboardEventStreamRepositoryPort
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
