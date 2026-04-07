import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prepareDefaultIntegrations } from "@agentic/integrations";
import { createRepository } from "@agentic/repository";
import { createSelfImprovementRepository, type SelfImprovementRepository } from "@agentic/self-improvement-memory";

const execFileAsync = promisify(execFile);
const DOCS_BUILD_TIMEOUT_MS = 60_000;
const DOCS_BUILD_MAX_BUFFER_BYTES = 256 * 1024;

declare global {
  // eslint-disable-next-line no-var
  var __agenticRepository: ReturnType<typeof createRepository> | undefined;
  // eslint-disable-next-line no-var
  var __agenticSelfImprovementRepository: SelfImprovementRepository | undefined;
  // eslint-disable-next-line no-var
  var __agenticDocsBuild: Promise<{ stdout: string; stderr: string }> | undefined;
}

export function getRepository() {
  if (!global.__agenticRepository) {
    global.__agenticRepository = createRepository();
  }

  return global.__agenticRepository;
}

export async function getSeededRepository() {
  const repository = getRepository();
  await Promise.all([repository.seedDefaults(), prepareDefaultIntegrations()]);
  return repository;
}

export function getSelfImprovementRepository(): SelfImprovementRepository {
  if (!global.__agenticSelfImprovementRepository) {
    global.__agenticSelfImprovementRepository = createSelfImprovementRepository();
  }

  return global.__agenticSelfImprovementRepository;
}

export async function getSeededSelfImprovementRepository(): Promise<SelfImprovementRepository> {
  const repo = getSelfImprovementRepository();
  await repo.seed();
  return repo;
}

function normalizeDocsBuildError(error: unknown, step: "render" | "validate"): Error {
  if (error instanceof Error && "killed" in error && error.killed) {
    return new Error(`Document ${step} timed out after ${DOCS_BUILD_TIMEOUT_MS / 1000} seconds.`);
  }

  if (error instanceof Error && "code" in error && error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
    return new Error(`Document ${step} produced too much output.`);
  }

  return new Error(`Document ${step} failed.`);
}

async function runDocsScript(scriptPath: string, step: "render" | "validate") {
  try {
    return await execFileAsync(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      timeout: DOCS_BUILD_TIMEOUT_MS,
      maxBuffer: DOCS_BUILD_MAX_BUFFER_BYTES
    });
  } catch (error) {
    throw normalizeDocsBuildError(error, step);
  }
}

export async function runDocsBuild() {
  if (!global.__agenticDocsBuild) {
    global.__agenticDocsBuild = (async () => {
      await runDocsScript("./scripts/render-docs.mjs", "render");
      const result = await runDocsScript("./scripts/validate-docs.mjs", "validate");

      return {
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim()
      };
    })().finally(() => {
      global.__agenticDocsBuild = undefined;
    });
  }

  return global.__agenticDocsBuild;
}
