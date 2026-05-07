import { mkdir, rmdir, stat } from "node:fs/promises";
import path from "node:path";

const FILE_STORE_LOCK_STALE_MS = 60_000;
const FILE_STORE_LOCK_RETRY_MS = 25;

function isErrnoException(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function waitForFileStoreLock(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, FILE_STORE_LOCK_RETRY_MS);
  });
}

async function tryRemoveStaleFileStoreLock(lockPath: string, now = Date.now()): Promise<boolean> {
  try {
    const lockStat = await stat(lockPath);

    if (now - lockStat.mtimeMs < FILE_STORE_LOCK_STALE_MS) {
      return false;
    }

    await rmdir(lockPath);
    return true;
  } catch (error) {
    if (isErrnoException(error, "ENOENT")) {
      return true;
    }

    return false;
  }
}

export async function acquireFileStoreLock(storePath: string): Promise<() => Promise<void>> {
  const lockPath = `${storePath}.lock`;

  await mkdir(path.dirname(storePath), { recursive: true });

  for (;;) {
    try {
      await mkdir(lockPath);
      return async () => {
        await rmdir(lockPath).catch(() => {});
      };
    } catch (error) {
      if (!isErrnoException(error, "EEXIST")) {
        throw error;
      }

      if (await tryRemoveStaleFileStoreLock(lockPath)) {
        continue;
      }

      await waitForFileStoreLock();
    }
  }
}
