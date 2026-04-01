import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLocalNote, listLocalNotes, readLocalNote, searchLocalNotes, updateLocalNote } from "@agentic/integrations";

describe("local notes adapter", () => {
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
    expect(updated.content).toContain("Chargers");
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
});
