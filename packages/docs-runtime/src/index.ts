import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DOCS_BUILD_TIMEOUT_MS = 60_000;
const DOCS_BUILD_MAX_BUFFER_BYTES = 256 * 1024;
const DOCS_RENDER_SCRIPT = "render-docs.mjs";
const DOCS_VALIDATE_SCRIPT = "validate-docs.mjs";
const MAX_REPOSITORY_ROOT_SEARCH_DEPTH = 8;

let cachedRepositoryRoot: string | undefined;

declare global {
  // eslint-disable-next-line no-var
  var __agenticDocsBuild: Promise<{ stdout: string; stderr: string }> | undefined;
}

function normalizeDocsBuildError(error: unknown, step: "render" | "validate"): Error {
  if (error instanceof Error && error.message.startsWith("Document ")) {
    return error;
  }

  if (error instanceof Error && "killed" in error && error.killed) {
    return new Error(`Document ${step} timed out after ${DOCS_BUILD_TIMEOUT_MS / 1000} seconds.`);
  }

  if (error instanceof Error && "code" in error && error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
    return new Error(`Document ${step} produced too much output.`);
  }

  return new Error(`Document ${step} failed.`);
}

function hasDocsScripts(candidateRoot: string): boolean {
  return (
    existsSync(path.join(candidateRoot, "package.json")) &&
    existsSync(path.join(candidateRoot, "scripts", DOCS_RENDER_SCRIPT)) &&
    existsSync(path.join(candidateRoot, "scripts", DOCS_VALIDATE_SCRIPT))
  );
}

function resolveRepositoryRoot(): string {
  if (cachedRepositoryRoot) {
    return cachedRepositoryRoot;
  }

  let candidate = path.dirname(fileURLToPath(import.meta.url));

  for (let depth = 0; depth <= MAX_REPOSITORY_ROOT_SEARCH_DEPTH; depth += 1) {
    if (hasDocsScripts(candidate)) {
      cachedRepositoryRoot = candidate;
      return candidate;
    }

    const parent = path.dirname(candidate);

    if (parent === candidate) {
      break;
    }

    candidate = parent;
  }

  throw new Error("Document build repository root could not be located.");
}

async function runDocsScript(scriptName: string, step: "render" | "validate") {
  const repositoryRoot = resolveRepositoryRoot();
  const scriptPath = path.join(repositoryRoot, "scripts", scriptName);

  if (!existsSync(scriptPath)) {
    throw new Error(`Document ${step} script is missing.`);
  }

  try {
    return await execFileAsync(process.execPath, [scriptPath], {
      cwd: repositoryRoot,
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
      await runDocsScript(DOCS_RENDER_SCRIPT, "render");
      const result = await runDocsScript(DOCS_VALIDATE_SCRIPT, "validate");

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
