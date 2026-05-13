import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resetLocalDevState, resolveLocalDevStateTargets } from "../scripts/lib/local-dev-state";

describe("local development state reset", () => {
  it("resolves default development state under .agentic", () => {
    const cwd = path.join(os.tmpdir(), "agentic-reset-defaults");

    expect(resolveLocalDevStateTargets({}, cwd)).toEqual([
      {
        label: "runtime_store",
        path: path.join(cwd, ".agentic", "runtime-store.json")
      },
      {
        label: "notes",
        path: path.join(cwd, ".agentic", "notes")
      }
    ]);
  });

  it("resolves configured relative state paths from the provided working directory", () => {
    const cwd = path.join(os.tmpdir(), "agentic-reset-relative");

    expect(
      resolveLocalDevStateTargets(
        {
          AGENTIC_RUNTIME_STORE_PATH: ".agentic/custom-store.json",
          AGENTIC_NOTES_PATH: ".agentic/custom-notes"
        },
        cwd
      )
    ).toEqual([
      {
        label: "runtime_store",
        path: path.join(cwd, ".agentic", "custom-store.json")
      },
      {
        label: "notes",
        path: path.join(cwd, ".agentic", "custom-notes")
      }
    ]);
  });

  it("removes configured state inside the system temp directory", async () => {
    const root = path.join(os.tmpdir(), `agentic-reset-${Date.now()}`);
    const runtimeStore = path.join(root, "runtime-store.json");
    const notesPath = path.join(root, "notes");

    await mkdir(root, { recursive: true });
    await mkdir(notesPath, { recursive: true });
    await writeFile(runtimeStore, "{}");
    await writeFile(path.join(notesPath, "note.md"), "note");

    const results = await resetLocalDevState({
      AGENTIC_RUNTIME_STORE_PATH: runtimeStore,
      AGENTIC_NOTES_PATH: notesPath
    });

    expect(results).toEqual([
      {
        label: "runtime_store",
        path: runtimeStore,
        removed: true
      },
      {
        label: "notes",
        path: notesPath,
        removed: true
      }
    ]);
  });

  it("refuses to remove paths outside .agentic or the system temp directory", async () => {
    await expect(
      resetLocalDevState(
        {
          AGENTIC_RUNTIME_STORE_PATH: path.join(os.homedir(), "runtime-store.json"),
          AGENTIC_NOTES_PATH: path.join(os.tmpdir(), "agentic-safe-notes")
        },
        { cwd: process.cwd(), dryRun: true }
      )
    ).rejects.toThrow("Refusing to reset runtime_store outside .agentic or the system temp directory");
  });
});
