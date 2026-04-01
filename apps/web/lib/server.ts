import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prepareDefaultIntegrations } from "@agentic/integrations";
import { createRepository } from "@agentic/repository";

const execFileAsync = promisify(execFile);

declare global {
  // eslint-disable-next-line no-var
  var __agenticRepository: ReturnType<typeof createRepository> | undefined;
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

export async function runDocsBuild() {
  await execFileAsync(process.execPath, ["./scripts/render-docs.mjs"], {
    cwd: process.cwd(),
    timeout: 60_000
  });
  const result = await execFileAsync(process.execPath, ["./scripts/validate-docs.mjs"], {
    cwd: process.cwd(),
    timeout: 60_000
  });

  return {
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}
