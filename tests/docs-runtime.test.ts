import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.hoisted(() =>
  vi.fn(
    (
      _file: string,
      _args: readonly string[],
      _options: Record<string, unknown>,
      callback: (error: Error | null, result: { stdout: string; stderr: string }) => void
    ) => {
      callback(null, {
        stdout: "docs ok\n",
        stderr: ""
      });
    }
  )
);

vi.mock("node:child_process", () => ({
  execFile: execFileMock
}));

import { runDocsBuild } from "@agentic/docs-runtime";

describe("docs runtime", () => {
  const repositoryRoot = process.cwd();

  afterEach(() => {
    process.chdir(repositoryRoot);
    Reflect.set(globalThis, "__agenticDocsBuild", undefined);
    execFileMock.mockClear();
  });

  it("runs document scripts from the repository root even when the worker cwd differs", async () => {
    process.chdir(path.join(repositoryRoot, "apps", "worker"));

    const result = await runDocsBuild();

    expect(result).toEqual({
      stdout: "docs ok",
      stderr: ""
    });
    expect(execFileMock).toHaveBeenCalledTimes(2);
    expect(execFileMock).toHaveBeenNthCalledWith(
      1,
      process.execPath,
      [path.join(repositoryRoot, "scripts", "render-docs.mjs")],
      expect.objectContaining({
        cwd: repositoryRoot
      }),
      expect.any(Function)
    );
    expect(execFileMock).toHaveBeenNthCalledWith(
      2,
      process.execPath,
      [path.join(repositoryRoot, "scripts", "validate-docs.mjs")],
      expect.objectContaining({
        cwd: repositoryRoot
      }),
      expect.any(Function)
    );
  });
});
