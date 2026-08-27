import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { MemoryRecord } from "@agentic/contracts";
import { MemoryRecordSchema } from "@agentic/contracts";
import { createMemoryRecord, queryContextPackets, rankRelevantMemories } from "@agentic/memory";
import {
  createLocalNote,
  listLocalNotes,
  readLocalNote,
  searchLocalNotes,
  updateLocalNote
} from "@agentic/integrations";
import {
  createSelfImprovementRepository,
  EpisodeRecordSchema,
  SelfImprovementValidationError,
  type EpisodeRecord,
  type SelfImprovementRepository
} from "@agentic/self-improvement-memory";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratchRoot = path.join(repoRoot, "build", "adversarial-memory-paths");

const tempDirs: string[] = [];

async function createScratchDir(prefix: string): Promise<string> {
  await mkdir(scratchRoot, { recursive: true });

  const tempDir = await mkdtemp(path.join(scratchRoot, `${prefix}-`));
  tempDirs.push(tempDir);

  return tempDir;
}

async function collectFiles(root: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      const child = path.join(current, entry.name);

      if (entry.isDirectory()) {
        await walk(child);
      } else {
        found.push(child);
      }
    }
  }

  await walk(root);

  return found;
}

function buildEpisode(overrides: Record<string, unknown> = {}): EpisodeRecord {
  return EpisodeRecordSchema.parse({
    id: "ep-2026-04-02-001",
    timestamp: "2026-04-02T09:00:00.000Z",
    skill: "debugger",
    task: "Repair callback refresh flow",
    outcome: "success",
    situation: "The UI stopped refreshing after a user action.",
    rootCause: "An empty callback was passed into the refresh boundary.",
    solution: "Wire the real refresh handler into the callback prop.",
    lesson: "Confirm callback props execute meaningful state changes.",
    ...overrides
  });
}

function buildMemoryRecord(id: string, overrides: Record<string, unknown> = {}): MemoryRecord {
  return createMemoryRecord({
    id,
    userId: "owner",
    category: "preferences",
    memoryType: "confirmed",
    content: "Prefers aisle seats on long-haul flights.",
    confidence: 0.9,
    source: "ui",
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    ...overrides
  }) as MemoryRecord;
}

afterAll(async () => {
  for (const tempDir of tempDirs) {
    await rm(tempDir, { recursive: true, force: true });
  }

  await rm(scratchRoot, { recursive: true, force: true }).catch(() => undefined);
});

describe("adversarial local notes path edges", () => {
  it("refuses separator smuggling, control characters, and oversized slugs without writing anything", async () => {
    const tempDir = await createScratchDir("notes-traversal");
    const basePath = path.join(tempDir, "notes");
    const sentinelPath = path.join(tempDir, "escape.md");

    await mkdir(basePath, { recursive: true });
    await writeFile(sentinelPath, "# Do not touch\n\nSentinel content.\n", "utf8");
    await writeFile(path.join(basePath, "inside.md"), "# Inside\n\nbody\n", "utf8");

    const hostileSlugs = [
      "",
      "   ",
      "..",
      ".",
      "%2e%2e%2fescape",
      "..\\escape",
      "a/../../escape",
      "notes/inside",
      "/etc/passwd",
      ".inside",
      "inside\u0000",
      "ｉｎｓｉｄｅ",
      "inside.md",
      "inside.".repeat(30)
    ];

    for (const slug of hostileSlugs) {
      await expect(readLocalNote(slug, basePath)).rejects.toThrow();
      await expect(updateLocalNote({ slug, content: "Should never be written." }, basePath)).rejects.toThrow();
    }

    // Nothing outside the notes folder changed and no partial file appeared inside it.
    expect(await readFile(sentinelPath, "utf8")).toBe("# Do not touch\n\nSentinel content.\n");
    expect(await readdir(basePath)).toEqual(["inside.md"]);
  });

  it("lists stray markdown files that its own read path refuses to open", async () => {
    const basePath = await createScratchDir("notes-stray");
    const created = await createLocalNote({ title: "Owned Note", content: "written by the adapter" }, basePath);

    await writeFile(path.join(basePath, "Roadmap_v2.md"), "# Roadmap v2\n\nstray\n", "utf8");
    await writeFile(path.join(basePath, "Meeting Notes.md"), "# Meeting Notes\n\nstray\n", "utf8");
    await writeFile(path.join(basePath, "Ünicode.md"), "# Ünicode\n\nstray\n", "utf8");
    await mkdir(path.join(basePath, "Sub Folder.md"));

    const listed = await listLocalNotes(basePath);

    // A directory whose name ends in .md is skipped instead of crashing the listing.
    expect(listed.map((note) => note.id).sort()).toEqual(
      ["Meeting Notes", "Roadmap_v2", "Ünicode", created.slug].sort()
    );

    // DEFECT: the lister accepts any *.md file, but readLocalNote() validates the slug against
    // /^[a-z0-9-]+$/. Every externally added file whose name contains a space, an underscore or
    // a non-ASCII character is therefore advertised by listLocalNotes()/searchLocalNotes() (and
    // handed to consumers as an openable id) while reading it back throws. Suggested fix: apply
    // the same slug contract while listing (skip + log), or relax the read contract to whatever
    // basename the lister was willing to surface.
    for (const note of listed) {
      if (note.id === created.id) {
        expect(await readLocalNote(note.id, basePath)).toMatchObject({ id: created.id });
        continue;
      }

      expect(note.id).not.toMatch(/^[a-z0-9-]+$/);
      await expect(readLocalNote(note.id, basePath)).rejects.toThrow();
    }

    expect(await searchLocalNotes("stray", basePath)).toHaveLength(3);
  });

  it("skips symlinked markdown entries in listings but still opens them by slug", async () => {
    const tempDir = await createScratchDir("notes-symlink");
    const basePath = path.join(tempDir, "notes");
    const secretPath = path.join(tempDir, "outside-secret.md");

    await mkdir(basePath, { recursive: true });
    await writeFile(secretPath, "# Secret\n\nconfidential\n", "utf8");

    try {
      await symlink(secretPath, path.join(basePath, "shared-note.md"));
    } catch {
      return; // Platform without unprivileged symlink support; nothing to assert.
    }

    // Dirent.isFile() is false for a symlink, so the lister never exposes or reads through it.
    expect(await listLocalNotes(basePath)).toEqual([]);
    expect(await searchLocalNotes("confidential", basePath)).toEqual([]);

    // NOTE: readLocalNote() only checks the slug lexically (path.resolve, never realpath), so a
    // symlinked name that the lister hides is still readable and returns out-of-base content.
    // Reaching it already requires write access to the notes directory, but realpath would close
    // the list/read inconsistency for free.
    await expect(readLocalNote("shared-note", basePath)).resolves.toMatchObject({
      id: "shared-note",
      title: "Secret"
    });
  });

  it("passes CRLF notes through verbatim and normalises line endings on rewrite", async () => {
    const basePath = await createScratchDir("notes-crlf");

    await writeFile(
      path.join(basePath, "crlf-note.md"),
      "# Release Plan\r\n\r\nShip on Tuesday\r\nHold the rollback door\r\n",
      "utf8"
    );

    const listed = await listLocalNotes(basePath);

    // \r is whitespace, so the heading still resolves but the raw content is returned untouched.
    expect(listed).toHaveLength(1);
    expect(listed[0]?.title).toBe("Release Plan");
    expect(listed[0]?.content).toContain("\r\n");
    expect(await searchLocalNotes("rollback door", basePath)).toHaveLength(1);

    const updated = await updateLocalNote({ slug: "crlf-note", content: "Ship on Wednesday" }, basePath);

    expect(updated.content).not.toContain("\r");
    expect(updated.content).toBe("# Release Plan\n\nShip on Wednesday\n");
  });

  // DEFECT: parseLocalNote() finds the heading with `line.trim().startsWith("# ")` but strips the
  // marker with `titleLine.replace(/^#\s+/, "")` against the *raw* line. U+FEFF is ECMAScript
  // whitespace, so a BOM-prefixed file matches the finder yet defeats the anchored replace: the
  // document id/slug stay correct but the title is reported as "# Release Plan". Worse,
  // updateLocalNote() reuses `existing.title` and re-prefixes it, so the first edit permanently
  // rewrites the file heading to "# # Release Plan" (it then plateaus, but the note can never
  // self-heal and every consumer sees the marker in the title).
  // Suggested fix: strip a leading BOM once after readFile (or normalise `titleLine.trim()`
  // before the replace) so detection and stripping operate on the same string.
  it("reports a BOM-prefixed heading as part of the title and bakes it into the file", async () => {
    const basePath = await createScratchDir("notes-bom");

    await writeFile(path.join(basePath, "bom-note.md"), "\uFEFF# Release Plan\n\nShip on Tuesday\n", "utf8");

    const note = await readLocalNote("bom-note", basePath);

    expect(note).toMatchObject({ slug: "bom-note", title: "# Release Plan" });
    expect(note.content.startsWith("\uFEFF")).toBe(true);

    const updated = await updateLocalNote({ slug: "bom-note", content: "Ship on Wednesday" }, basePath);

    expect(updated.title).toBe("# Release Plan");
    expect(updated.content.startsWith("# # Release Plan")).toBe(true);
  });

  it("keeps concurrent note writes atomic and leaves no temp files behind", async () => {
    const basePath = await createScratchDir("notes-concurrency");
    const creates = await Promise.all(
      Array.from({ length: 10 }, () => createLocalNote({ title: "Identical Title", content: "payload" }, basePath))
    );

    expect(new Set(creates.map((note) => note.slug)).size).toBe(10);
    expect(await listLocalNotes(basePath)).toHaveLength(10);

    const target = creates[0]!;
    const targetPath = path.join(basePath, `${target.slug}.md`);

    await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        updateLocalNote({ slug: target.slug, content: `winner ${index}` }, basePath)
      )
    );

    const persisted = await readFile(targetPath, "utf8");
    const finalNote = await readLocalNote(target.slug, basePath);

    // rename() is the publish step: a reader never sees a half-written document.
    expect(persisted).toMatch(/^# Identical Title\n\nwinner \d\n$/u);
    expect(finalNote.content).toBe(persisted);
    expect((await readdir(basePath)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("enforces title and content boundaries without corrupting the existing document", async () => {
    const basePath = await createScratchDir("notes-boundary");
    const boundaryTitle = "t".repeat(120);
    const created = await createLocalNote({ title: boundaryTitle, content: "x".repeat(10_000) }, basePath);

    expect(created.title).toBe(boundaryTitle);
    expect(created.slug.length).toBeLessThanOrEqual(80 + 1 + 8);

    await expect(createLocalNote({ title: "t".repeat(121), content: "ok" }, basePath)).rejects.toThrow();
    await expect(createLocalNote({ title: "   ", content: "ok" }, basePath)).rejects.toThrow();
    await expect(createLocalNote({ title: "Valid", content: "   " }, basePath)).rejects.toThrow();
    expect(await readdir(basePath)).toEqual([`${created.slug}.md`]);

    // A rejected update leaves the previous revision byte-for-byte intact.
    const before = await readFile(path.join(basePath, `${created.slug}.md`), "utf8");

    await expect(updateLocalNote({ slug: created.slug, content: "y".repeat(10_001) }, basePath)).rejects.toThrow();
    expect(await readFile(path.join(basePath, `${created.slug}.md`), "utf8")).toBe(before);

    // An emoji-only title sanitises to the "note" fallback and still round-trips.
    const emoji = await createLocalNote({ title: "🎉🎉🎉", content: "party" }, basePath);

    expect(emoji.slug).toMatch(/^note-[a-z0-9]{1,8}$/);
    expect(await readdir(basePath)).toContain(`${emoji.slug}.md`);
    await expect(readLocalNote(emoji.slug, basePath)).resolves.toMatchObject({ title: "🎉🎉🎉" });
  });
});

describe("adversarial self-improvement memory paths", () => {
  let repository: SelfImprovementRepository;
  let baseDir: string;

  const hostileEpisodes = [
    buildEpisode({ id: "../../outside", skill: "../../etc", task: "passwd", timestamp: "2026-04-03T09:00:00.000Z" }),
    buildEpisode({ id: "ep-nul\u0000", skill: "日本語のスキル", task: "emoji 🎉 outcome", timestamp: "2026-04-03T10:00:00.000Z" }),
    buildEpisode({ id: "..\\escape", skill: "  padded skill  ", task: "x".repeat(300), timestamp: "2026-04-03T11:00:00.000Z" })
  ];

  beforeAll(async () => {
    const tempDir = await createScratchDir("self-improvement");

    baseDir = path.join(tempDir, "memory");
    repository = createSelfImprovementRepository({ baseDir });
    await repository.seed();

    for (const episode of hostileEpisodes) {
      await repository.appendEpisode(episode);
    }
  });

  it("keeps hostile episode identifiers and skills inside the base directory", async () => {
    const files = await collectFiles(baseDir);

    expect(files.length).toBeGreaterThan(0);

    for (const filePath of files) {
      expect(filePath.startsWith(`${baseDir}${path.sep}`)).toBe(true);
      expect(filePath.split(path.sep)).not.toContain("..");
    }

    for (const episode of hostileEpisodes) {
      await expect(repository.getEpisode(episode.id, "2026")).resolves.toMatchObject({ id: episode.id });
    }

    await expect(repository.listEpisodes({ year: "../.." })).rejects.toBeInstanceOf(SelfImprovementValidationError);
    await expect(repository.listEpisodes({ year: "99" })).rejects.toBeInstanceOf(SelfImprovementValidationError);
    await expect(repository.getEpisode(hostileEpisodes[0]!.id, "20")).rejects.toBeInstanceOf(
      SelfImprovementValidationError
    );
    await expect(repository.listEpisodes({ year: "2099" })).resolves.toEqual([]);
  });

  it("silently overwrites a stored episode when sanitised slug collisions exhaust the single retry", async () => {
    const sharedShape = { skill: "collision-probe", task: "Same task text", timestamp: "2026-04-04T09:00:00.000Z" };
    const first = buildEpisode({ ...sharedShape, id: "ep-alpha!" });
    const second = buildEpisode({ ...sharedShape, id: "ep-alpha?" });
    const third = buildEpisode({ ...sharedShape, id: "ep-alpha." });

    await expect(repository.appendEpisode(first)).resolves.toMatchObject({ id: first.id });
    await expect(repository.appendEpisode(second)).resolves.toMatchObject({ id: second.id });

    // DEFECT: appendEpisode() disambiguates only once. sanitizeSlug() maps "ep-alpha!",
    // "ep-alpha?" and "ep-alpha." to the same "ep-alpha" suffix, so the third write reuses the
    // second write's already-taken path and renames over it: the call resolves (no
    // SelfImprovementConflictError), the second episode is destroyed, and it can no longer be
    // found by id. Suggested fix: keep escalating the suffix (counter or stable hash of the
    // full id) until the path is free, and raise a conflict if the chosen path already holds a
    // different episode id.
    await expect(repository.appendEpisode(third)).resolves.toMatchObject({ id: third.id });

    const alphaIds = (await repository.listEpisodes({ year: "2026" }))
      .filter((episode) => episode.skill === "collision-probe")
      .map((episode) => episode.id)
      .sort();

    expect(alphaIds).toEqual([first.id, third.id].sort());
    await expect(repository.getEpisode(second.id, "2026")).resolves.toBeNull();
  });

  it("cannot read any episode when a stray non-directory entry sits under episodic/", async () => {
    const strayPath = path.join(baseDir, "episodic", "README.txt");

    await writeFile(strayPath, "dropped in by an operator (or a macOS .DS_Store)\n", "utf8");

    // DEFECT: listEpisodeFiles() assumes every entry under episodic/ is a year directory.
    // readdir() on a plain file throws ENOTDIR, which escapes without even being wrapped in
    // SelfImprovementStorageError, so one stray entry - opening the folder in Finder on macOS
    // is enough to create one - breaks listEpisodes(), getEpisode() and learning export for
    // every healthy episode. Suggested fix: restrict the year listing to /^\d{4}$/ entries
    // (YearSchema already encodes that) or filter to directories and tolerate failures.
    await expect(repository.listEpisodes()).rejects.toThrow(/ENOTDIR/);
    await expect(repository.getEpisode(hostileEpisodes[0]!.id)).rejects.toThrow(/ENOTDIR/);
    await expect(repository.exportLearningEpisodes!({ userId: "owner", workspaceId: null })).rejects.toThrow(/ENOTDIR/);

    await rm(strayPath, { force: true });

    expect((await repository.listEpisodes({ year: "2026" })).length).toBeGreaterThan(0);
    // A caller that supplies the year hint bypasses the poisoned enumeration entirely,
    // which is why the failure looks random to operators.
    await expect(repository.getEpisode(hostileEpisodes[0]!.id, "2026")).resolves.toMatchObject({
      id: hostileEpisodes[0]!.id
    });
  });

  it("resolves unknown semantic pattern ids through the prototype chain", async () => {
    const stored = await repository.upsertSemanticPattern({
      id: "pattern-real",
      name: "Real pattern",
      source: "unit-test",
      confidence: 0.6,
      applications: 1,
      category: "engineering",
      pattern: "Check the wiring before the payload.",
      problem: "Silent no-op callbacks.",
      solution: {},
      qualityRules: ["assert the handler runs"],
      targetSkills: ["debugger"],
      relatedEpisodeIds: [],
      createdAt: "2026-04-02T09:00:00.000Z",
      updatedAt: "2026-04-02T09:00:00.000Z"
    });

    expect(stored.id).toBe("pattern-real");
    await expect(repository.getSemanticPattern("pattern-missing")).resolves.toBeNull();

    // DEFECT: getSemanticPattern() indexes the parsed `patterns` record with a caller-supplied
    // key, so inherited Object.prototype members are returned as if they were SemanticPattern
    // records. Callers reading .confidence/.updatedAt off the result get undefined instead of
    // the documented null. Suggested fix: guard with Object.hasOwn(patterns, id) (or keep
    // patterns in a null-prototype object / Map).
    await expect(repository.getSemanticPattern("__proto__")).resolves.toBe(Object.prototype);
    await expect(repository.getSemanticPattern("constructor")).resolves.toBe(Object);

    // Upserting a hostile id must not pollute shared prototypes either.
    await expect(
      repository.upsertSemanticPattern({
        ...stored,
        id: "__proto__",
        name: "Hostile key",
        updatedAt: "2026-04-02T10:00:00.000Z"
      })
    ).resolves.toMatchObject({ id: "__proto__" });
    expect(({} as Record<string, unknown>).name).toBeUndefined();
    await expect(repository.getSemanticPattern("pattern-real")).resolves.toMatchObject({ id: "pattern-real" });
  });
});

describe("adversarial memory core degenerate inputs", () => {
  const records = [
    buildMemoryRecord("m-1"),
    buildMemoryRecord("m-2", { sensitivity: "Restricted", content: "Budget ceiling is 50000." }),
    buildMemoryRecord("m-3", { memoryType: "inferred", confidence: 0.2 })
  ];

  it("clamps hostile limits and survives empty collections and empty queries", () => {
    expect(rankRelevantMemories("aisle seat", [])).toEqual([]);
    expect(rankRelevantMemories("", records, 5).length).toBeLessThanOrEqual(5);
    expect(rankRelevantMemories("aisle seat", records, -1)).toEqual([]);
    expect(rankRelevantMemories("aisle seat", records, 1_000)).toHaveLength(3);
    expect(queryContextPackets([], { userId: "owner" })).toEqual([]);
    expect(queryContextPackets(records, { userId: "owner", limit: -3 })).toEqual([]);
    expect(queryContextPackets(records, { userId: "nobody" })).toEqual([]);

    // Restricted records stay hidden until the caller explicitly allows that sensitivity,
    // and the allow-list is matched case- and whitespace-insensitively.
    expect(queryContextPackets(records, { userId: "owner" }).map((packet) => packet.id)).not.toContain("ctx_m-2");
    expect(
      queryContextPackets(records, { userId: "owner", allowedSensitivities: [" RESTricTED "] }).map((packet) => packet.id)
    ).toContain("ctx_m-2");
  });

  it("rejects malformed lifecycle values at the record boundary", () => {
    expect(() => buildMemoryRecord("m-empty", { id: "" })).toThrow();
    expect(() => buildMemoryRecord("m-neg", { confidence: -0.0001 })).toThrow();
    expect(() => buildMemoryRecord("m-review", { reviewAt: "2026-03-01" })).toThrow();
    expect(() => buildMemoryRecord("m-exp", { expiryAt: "not-a-date" })).toThrow();

    // Belief-revision metadata is validated by the contract itself, not the factory helper.
    const wireRecord = {
      id: "m-sup",
      userId: "owner",
      category: "preferences",
      memoryType: "confirmed",
      content: "Prefers aisle seats.",
      confidence: 0.9,
      source: "ui",
      sensitivity: "internal",
      permissions: [],
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z"
    };

    expect(() => MemoryRecordSchema.parse({ ...wireRecord, supersedes: "" })).toThrow();
    expect(() => MemoryRecordSchema.parse({ ...wireRecord, version: 0 })).toThrow();
    expect(() => MemoryRecordSchema.parse({ ...wireRecord, version: 1.5 })).toThrow();
    expect(MemoryRecordSchema.parse({ ...wireRecord, supersedes: "m-other" }).supersedes).toBe("m-other");

    // DEFECT: MemoryRecordSchema validates identity/content with z.string().min(1) and never
    // trims first (unlike LocalNoteMutationSchema and self-improvement-memory's boundedString,
    // which both trim), so whitespace-only ids, userIds and content are legal persisted state.
    // Such a record can be written but never addressed by a route that trims its params, and
    // " " vs "  " stay distinct ids for upsertById while being indistinguishable in the UI.
    // Suggested fix: z.string().trim().min(1) for id/userId/category/content/source/sensitivity.
    const whitespaceRecord = MemoryRecordSchema.safeParse({
      ...wireRecord,
      id: "   ",
      userId: " ",
      content: "  ",
      category: "\t"
    });

    expect(whitespaceRecord.success).toBe(true);

    // A self-superseding record is filtered out of retrieval rather than looping forever.
    const loop = MemoryRecordSchema.parse({ ...wireRecord, id: "m-loop", supersedes: "m-loop" });

    expect(loop.supersedes).toBe("m-loop");
    expect(queryContextPackets([loop], { userId: "owner" })).toEqual([]);
    expect(rankRelevantMemories("aisle seat", [loop])).toEqual([]);
  });
});
