import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type LocalDevStateTarget = {
  label: "runtime_store" | "notes";
  path: string;
};

export type LocalDevResetResult = LocalDevStateTarget & {
  removed: boolean;
};

function trim(value: string | undefined): string {
  return value?.trim() ?? "";
}

function isInside(base: string, target: string): boolean {
  const relative = path.relative(base, target);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function assertSafeResetTarget(target: LocalDevStateTarget, cwd: string): void {
  const resolved = path.resolve(target.path);
  const allowedRepoStateRoot = path.resolve(cwd, ".agentic");
  const allowedTempRoot = path.resolve(os.tmpdir());
  const forbidden = new Set([
    path.resolve(cwd),
    path.resolve(os.homedir()),
    path.parse(resolved).root,
    allowedRepoStateRoot,
    allowedTempRoot
  ]);

  if (forbidden.has(resolved)) {
    throw new Error(`Refusing to reset unsafe ${target.label} path: ${resolved}`);
  }

  if (!isInside(allowedRepoStateRoot, resolved) && !isInside(allowedTempRoot, resolved)) {
    throw new Error(
      `Refusing to reset ${target.label} outside .agentic or the system temp directory: ${resolved}`
    );
  }
}

export function resolveLocalDevStateTargets(
  env: NodeJS.ProcessEnv,
  cwd = process.cwd()
): LocalDevStateTarget[] {
  const runtimeStorePath = trim(env.AGENTIC_RUNTIME_STORE_PATH) || path.join(cwd, ".agentic", "runtime-store.json");
  const notesPath = trim(env.AGENTIC_NOTES_PATH) || path.join(cwd, ".agentic", "notes");

  return [
    {
      label: "runtime_store",
      path: path.resolve(cwd, runtimeStorePath)
    },
    {
      label: "notes",
      path: path.resolve(cwd, notesPath)
    }
  ];
}

export async function resetLocalDevState(
  env: NodeJS.ProcessEnv,
  options: {
    cwd?: string;
    dryRun?: boolean;
  } = {}
): Promise<LocalDevResetResult[]> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const targets = resolveLocalDevStateTargets(env, cwd);

  targets.forEach((target) => assertSafeResetTarget(target, cwd));

  if (options.dryRun) {
    return targets.map((target) => ({
      ...target,
      removed: false
    }));
  }

  const results: LocalDevResetResult[] = [];

  for (const target of targets) {
    await rm(target.path, {
      force: true,
      recursive: true
    });
    results.push({
      ...target,
      removed: true
    });
  }

  return results;
}
