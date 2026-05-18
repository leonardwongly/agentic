import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createLocalNote,
  isLocalNotesRuntimeEnabled,
  listLocalNotes,
  readLocalNote,
  searchLocalNotes,
  updateLocalNote
} from "@agentic/integrations";

describe("local notes adapter", () => {
  const originalLocalNotesEnabled = process.env.AGENTIC_LOCAL_NOTES_ENABLED;
  const originalLocalNotesAllowedRoot = process.env.AGENTIC_LOCAL_NOTES_ALLOWED_ROOT;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalNotesPath = process.env.AGENTIC_NOTES_PATH;

  afterEach(() => {
    process.env.AGENTIC_LOCAL_NOTES_ENABLED = originalLocalNotesEnabled;
    process.env.AGENTIC_LOCAL_NOTES_ALLOWED_ROOT = originalLocalNotesAllowedRoot;
    process.env.AGENTIC_NOTES_PATH = originalNotesPath;
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("creates, reads, searches, and updates notes in a safe base directory", async () => {
    const basePath = await mkdtemp(path.join(os.tmpdir(), "agentic-notes-"));
    const created = await createLocalNote(
      {
        title: "Travel Checklist",
        content: "Passport\nAisle seat\nAdapters"
      },
      basePath
    );

    expect(created.slug).toContain("travel-checklist");
    expect(created).not.toHaveProperty("path");

    const listed = await listLocalNotes(basePath);
    const searched = await searchLocalNotes("passport", basePath);
    const loaded = await readLocalNote(created.slug, basePath);
    const updated = await updateLocalNote(
      {
        slug: created.slug,
        content: "Passport\nAisle seat\nChargers"
      },
      basePath
    );

    expect(listed.length).toBe(1);
    expect(searched[0]?.id).toBe(created.id);
    expect(loaded.title).toBe("Travel Checklist");
    expect(loaded).not.toHaveProperty("path");
    expect(updated.content).toContain("Chargers");
    expect(updated).not.toHaveProperty("path");
  });

  it("normalizes hostile slugs and rejects missing notes cleanly", async () => {
    const basePath = await mkdtemp(path.join(os.tmpdir(), "agentic-notes-"));

    await expect(readLocalNote("../outside", basePath)).rejects.toThrow();
    await expect(
      updateLocalNote(
        {
          slug: "../../missing",
          title: "Should fail",
          content: "Still missing"
        },
        basePath
      )
    ).rejects.toThrow();
  });

  it("keeps duplicate titles distinct and preserves trimmed unicode-rich titles", async () => {
    const basePath = await mkdtemp(path.join(os.tmpdir(), "agentic-notes-"));
    const first = await createLocalNote(
      {
        title: "  SRE / Incident: 東京 !!!  ",
        content: "first"
      },
      basePath
    );
    const second = await createLocalNote(
      {
        title: "SRE / Incident: 東京 !!!",
        content: "second"
      },
      basePath
    );

    expect(first.slug).not.toBe(second.slug);
    expect(first.slug).toMatch(/^sre-incident-[a-f0-9]{8}$/);
    expect(second.slug).toMatch(/^sre-incident-[a-f0-9]{8}$/);
    expect(first.title).toBe("SRE / Incident: 東京 !!!");
    expect(second.title).toBe("SRE / Incident: 東京 !!!");
  });

  it("rejects oversized direct writes before touching disk", async () => {
    const basePath = await mkdtemp(path.join(os.tmpdir(), "agentic-notes-"));

    await expect(
      createLocalNote(
        {
          title: "Oversized",
          content: "x".repeat(10_001)
        },
        basePath
      )
    ).rejects.toThrow();
  });

  it("fails closed in production unless explicitly enabled and scoped", async () => {
    const allowedRoot = await mkdtemp(path.join(os.tmpdir(), "agentic-notes-root-"));
    const basePath = path.join(allowedRoot, "notes");

    process.env.NODE_ENV = "production";
    process.env.AGENTIC_NOTES_PATH = basePath;
    process.env.AGENTIC_LOCAL_NOTES_ALLOWED_ROOT = allowedRoot;
    delete process.env.AGENTIC_LOCAL_NOTES_ENABLED;

    expect(isLocalNotesRuntimeEnabled(basePath)).toBe(false);
    await expect(listLocalNotes(basePath)).rejects.toThrow("Local notes are disabled in production");

    process.env.AGENTIC_LOCAL_NOTES_ENABLED = "true";

    expect(isLocalNotesRuntimeEnabled(basePath)).toBe(true);
    await expect(listLocalNotes(basePath)).resolves.toEqual([]);
  });

  it("rejects production paths outside the configured local notes root", async () => {
    const allowedRoot = await mkdtemp(path.join(os.tmpdir(), "agentic-notes-allowed-"));
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "agentic-notes-outside-"));
    const basePath = path.join(outsideRoot, "notes");

    process.env.NODE_ENV = "production";
    process.env.AGENTIC_LOCAL_NOTES_ENABLED = "true";
    process.env.AGENTIC_NOTES_PATH = basePath;
    process.env.AGENTIC_LOCAL_NOTES_ALLOWED_ROOT = allowedRoot;

    expect(isLocalNotesRuntimeEnabled(basePath)).toBe(false);
    await expect(createLocalNote({ title: "Blocked", content: "outside" }, basePath)).rejects.toThrow(
      "Local notes are disabled in production"
    );
  });
});
