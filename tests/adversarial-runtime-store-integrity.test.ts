import { mkdtemp, mkdir, readFile, readdir, rmdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { MemoryRecord } from "@agentic/contracts";
import {
  DEFAULT_COLLECTION_PAGE_LIMIT,
  DEFAULT_OWNER_USER_ID,
  MAX_COLLECTION_PAGE_LIMIT,
  nowIso
} from "@agentic/contracts";
import { createMemoryRecord } from "@agentic/memory";
import { createRepository } from "@agentic/repository";
import { processUserRequest } from "@agentic/orchestrator";
import { acquireFileStoreLock } from "../packages/repository/src/file-store-lock";
import {
  buildCollectionPage,
  CollectionPageQueryError,
  decodeCollectionCursor,
  encodeCollectionCursor,
  normalizeCollectionPageLimit
} from "../packages/repository/src/collection-pagination";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratchRoot = path.join(repoRoot, "build", "adversarial-runtime-store");

const tempDirs: string[] = [];

async function createScratchDir(prefix: string): Promise<string> {
  await mkdir(scratchRoot, { recursive: true });

  const tempDir = await mkdtemp(path.join(scratchRoot, `${prefix}-`));
  tempDirs.push(tempDir);

  return tempDir;
}

function buildMemory(overrides: Record<string, unknown> = {}): MemoryRecord {
  return createMemoryRecord({
    id: "mem-anchor",
    userId: DEFAULT_OWNER_USER_ID,
    category: "preferences",
    memoryType: "confirmed",
    content: "Prefers aisle seats on long-haul flights.",
    confidence: 0.9,
    source: "unit-test",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  }) as MemoryRecord;
}

async function seedPersistedStore(storePath: string): Promise<string> {
  const repository = createRepository({ storePath });

  await repository.saveMemory(buildMemory());

  return await readFile(storePath, "utf8");
}

function collectionCursorErrorCode(raw: string): unknown {
  try {
    decodeCollectionCursor(raw);
    return "no-throw";
  } catch (error) {
    return (error as CollectionPageQueryError).code;
  }
}

describe("adversarial runtime store integrity", () => {
  afterAll(async () => {
    for (const tempDir of tempDirs) {
      await rm(tempDir, { recursive: true, force: true });
    }

    await rm(scratchRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  it("preserves a truncated store file and reports corruption instead of self-healing", async () => {
    const tempDir = await createScratchDir("truncated");
    const storePath = path.join(tempDir, "runtime-store.json");
    const raw = await seedPersistedStore(storePath);
    const truncated = raw.slice(0, Math.floor(raw.length / 2));

    await writeFile(storePath, truncated, "utf8");

    const repository = createRepository({ storePath });

    await expect(repository.listMemory(DEFAULT_OWNER_USER_ID)).rejects.toThrow(/is corrupted/);
    // A corrupt read must never be "repaired" by overwriting the operator-recoverable bytes.
    expect(await readFile(storePath, "utf8")).toBe(truncated);
    expect((await readdir(tempDir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("rejects a forward schema version without rewriting the persisted bytes", async () => {
    const tempDir = await createScratchDir("version");
    const storePath = path.join(tempDir, "runtime-store.json");
    const raw = await seedPersistedStore(storePath);
    const futureVersion = raw.replace('"version": 1', '"version": 2');

    expect(futureVersion).not.toBe(raw);
    await writeFile(storePath, futureVersion, "utf8");

    const repository = createRepository({ storePath });

    await expect(repository.listMemory(DEFAULT_OWNER_USER_ID)).rejects.toThrow(/is corrupted/);
    expect(await readFile(storePath, "utf8")).toBe(futureVersion);
  });

  it("treats non-object and empty store payloads as corruption rather than fresh empty state", async () => {
    const tempDir = await createScratchDir("shape");

    for (const payload of ["[]", "null", '"store"', "42", "{}"]) {
      const storePath = path.join(tempDir, `runtime-store-${payload.replace(/\W/g, "_")}.json`);
      await writeFile(storePath, payload, "utf8");

      const repository = createRepository({ storePath });

      await expect(repository.listMemory(DEFAULT_OWNER_USER_ID)).rejects.toThrow(/is corrupted/);
      expect(await readFile(storePath, "utf8")).toBe(payload);
    }
  });

  it("ignores a prototype-polluting key in the store file instead of applying it", async () => {
    const tempDir = await createScratchDir("proto");
    const storePath = path.join(tempDir, "runtime-store.json");
    const raw = await seedPersistedStore(storePath);
    const hostile = raw.replace(
      '{\n  "version": 1,',
      '{\n  "__proto__": { "polluted": "yes", "memories": [] },\n  "version": 1,'
    );

    expect(hostile).not.toBe(raw);
    await writeFile(storePath, hostile, "utf8");

    const repository = createRepository({ storePath });
    const memories = await repository.listMemory(DEFAULT_OWNER_USER_ID);

    expect(memories).toHaveLength(1);
    expect(memories[0]?.id).toBe("mem-anchor");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted")).toBe(false);
    expect(Array.prototype.slice).toBeTypeOf("function");
  });

  it("writes to disk from a read-only call while another writer holds the store lock", async () => {
    const tempDir = await createScratchDir("read-write");
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({ storePath });

    // Simulate a second process that is mid-mutation: a fresh (non-stale) lock dir.
    await mkdir(`${storePath}.lock`);

    await expect(repository.listMemory(DEFAULT_OWNER_USER_ID)).resolves.toEqual([]);

    // DEFECT: FileRepository.readStore() auto-initialises a missing store by calling
    // writeStore() from inside the *read* path, which is never wrapped in
    // withMutationLock(). A read-only API therefore (a) requires write access, and
    // (b) can rename an empty store over a concurrent committed mutation (lost update).
    // Repro above: the store file appears even though the lock was held by "someone else".
    const persisted = JSON.parse(await readFile(storePath, "utf8")) as { memories: unknown[] };

    expect(persisted.memories).toEqual([]);

    await rmdir(`${storePath}.lock`);
  });

  it("serialises cross-instance read-modify-write cycles so no update is lost", async () => {
    const tempDir = await createScratchDir("lost-update");
    const storePath = path.join(tempDir, "runtime-store.json");
    const repositoryA = createRepository({ storePath });
    const repositoryB = createRepository({ storePath });

    await Promise.all(
      Array.from({ length: 8 }, (_, index) => {
        const repository = index % 2 === 0 ? repositoryA : repositoryB;

        return repository.saveMemory(
          buildMemory({
            id: `mem-${index}`,
            content: `Interleaved note ${index}.`
          })
        );
      })
    );

    const persisted = JSON.parse(await readFile(storePath, "utf8")) as { memories: Array<{ id: string }> };

    expect(persisted.memories.map((memory) => memory.id).sort()).toEqual(
      Array.from({ length: 8 }, (_, index) => `mem-${index}`).sort()
    );
    expect(await repositoryA.listMemory(DEFAULT_OWNER_USER_ID)).toHaveLength(8);
    expect((await readdir(tempDir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("reclaims a stale lock left behind by a crashed writer and still persists the mutation", async () => {
    const tempDir = await createScratchDir("stale-lock");
    const storePath = path.join(tempDir, "runtime-store.json");
    const lockPath = `${storePath}.lock`;
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    await mkdir(lockPath, { recursive: true });
    await utimes(lockPath, fiveMinutesAgo, fiveMinutesAgo);

    const repository = createRepository({ storePath });

    await expect(repository.saveMemory(buildMemory({ id: "mem-after-crash" }))).resolves.toMatchObject({
      id: "mem-after-crash"
    });
    expect(await repository.listMemory(DEFAULT_OWNER_USER_ID)).toHaveLength(1);
    await expect(stat(lockPath)).rejects.toThrow();
  });

  it("blocks a writer while a live lock is held and proceeds once the owner releases it", async () => {
    const tempDir = await createScratchDir("live-lock");
    const storePath = path.join(tempDir, "runtime-store.json");
    const lockPath = `${storePath}.lock`;

    await mkdir(lockPath, { recursive: true });

    const repository = createRepository({ storePath });
    const pending = repository.saveMemory(buildMemory({ id: "mem-queued" }));

    const firstSettled = await Promise.race([
      pending.then(() => "mutation-completed"),
      Promise.resolve("still-blocked")
    ]);

    expect(firstSettled).toBe("still-blocked");

    await rmdir(lockPath);
    await expect(pending).resolves.toMatchObject({ id: "mem-queued" });

    // The same helper the repository uses must hand back a releasable lock exactly once.
    const release = await acquireFileStoreLock(storePath);

    expect(await readdir(tempDir)).toContain(path.basename(lockPath));

    await release();

    await expect(stat(lockPath)).rejects.toThrow();
  });

  it("silently replaces another user's memory when record ids collide", async () => {
    const tempDir = await createScratchDir("id-collision");
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({ storePath });
    const sharedId = "det-capture-001";

    await repository.saveMemory(buildMemory({ id: sharedId, userId: "user-alpha", content: "Alpha preference." }));
    await repository.saveMemory(buildMemory({ id: sharedId, userId: "user-beta", content: "Beta preference." }));

    // DEFECT: FileRepository.saveMemory() de-duplicates with upsertById(), which keys on
    // `id` alone. Memory ids are caller-supplied (capture paths derive deterministic ids),
    // so user-beta's write destroys user-alpha's record with no error. Sibling collections
    // in the same file already key by `${userId}:${id}` (integrationStoreKey,
    // providerCredentialStoreKey). Fix: key memories by user + id, or reject a save whose
    // id already belongs to a different userId.
    await expect(repository.listMemory("user-alpha")).resolves.toEqual([]);
    await expect(repository.listMemory("user-beta")).resolves.toHaveLength(1);
  });

  it("rejects malformed record boundaries before touching the store file", async () => {
    const tempDir = await createScratchDir("boundaries");
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({ storePath });
    const invalidRecords: Array<Partial<MemoryRecord>> = [
      { id: "" },
      { userId: "" },
      { content: "" },
      { confidence: 1.0000001 },
      { confidence: Number.NaN },
      { createdAt: "2026-01-01" }
    ];

    for (const overrides of invalidRecords) {
      const valid = buildMemory();

      await expect(
        repository.saveMemory({ ...valid, ...overrides } as MemoryRecord)
      ).rejects.toThrow();
    }

    const persisted = JSON.parse(await readFile(storePath, "utf8")) as { memories: unknown[] };

    // Rejected mutations must not leave a half-written record or orphaned temp files behind.
    // (The store file itself exists only because of the read-path auto-init defect documented
    // above; validation still runs before any write of the candidate record.)
    expect(persisted.memories).toEqual([]);
    expect((await readdir(tempDir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("keeps collection reads bounded while the persisted store grows", async () => {
    const tempDir = await createScratchDir("growth");
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({ storePath });
    const largeContent = "x".repeat(250_000);

    for (let index = 0; index < 45; index += 1) {
      await repository.saveMemory(
        buildMemory({ id: `mem-${index}`, content: index === 0 ? largeContent : `Growth probe ${index}.` })
      );
    }

    const all = await repository.listMemory(DEFAULT_OWNER_USER_ID);

    expect(all).toHaveLength(45);
    expect(all.find((memory) => memory.id === "mem-0")?.content).toHaveLength(largeContent.length);

    // An oversized limit falls back to the default instead of being honoured verbatim, so no
    // caller can ask the file store for an unbounded page.
    const oversized = await repository.listMemoryPage({ limit: 500 });

    expect(oversized.limit).toBe(DEFAULT_COLLECTION_PAGE_LIMIT);
    expect(oversized.items).toHaveLength(DEFAULT_COLLECTION_PAGE_LIMIT);

    const maxed = await repository.listMemoryPage({ limit: MAX_COLLECTION_PAGE_LIMIT });

    expect(maxed.limit).toBe(MAX_COLLECTION_PAGE_LIMIT);
    expect(maxed.items).toHaveLength(45);
    expect((await readdir(tempDir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("bricks the aggregate goal read when one goal's workflow reference is orphaned", async () => {
    const tempDir = await createScratchDir("orphan");
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({ storePath });

    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);

    const buildBundle = async (request: string) =>
      await repository.saveGoalBundle(
        await processUserRequest({
          userId: DEFAULT_OWNER_USER_ID,
          request,
          memories: await repository.listMemory(DEFAULT_OWNER_USER_ID),
          integrations: await repository.listIntegrations(DEFAULT_OWNER_USER_ID)
        })
      );

    const healthyBundle = await buildBundle("Summarise the sprint board every Friday.");
    const orphanedBundle = await buildBundle("Rotate the incident commander rota monthly.");

    await expect(repository.listGoals(DEFAULT_OWNER_USER_ID)).resolves.toHaveLength(2);

    const raw = JSON.parse(await readFile(storePath, "utf8")) as {
      workflows: Array<{ id: string }>;
      tasks: Array<Record<string, unknown>>;
    };

    raw.workflows = raw.workflows.filter((workflow) => workflow.id !== orphanedBundle.workflow.id);
    // An orphaned task is tolerated silently, which proves the aggregate path already
    // knows how to degrade for dangling references of other kinds.
    raw.tasks.push({ ...raw.tasks[0]!, id: "task-orphan", goalId: "goal-never-created" });

    await writeFile(storePath, JSON.stringify(raw, null, 2), "utf8");

    // The healthy goal is still individually readable ...
    await expect(repository.getGoalBundle(healthyBundle.goal.id)).resolves.toMatchObject({
      goal: { id: healthyBundle.goal.id }
    });

    // DEFECT: ... but bundleFromStore() throws for a missing workflow, so a single orphaned
    // goal reference takes down listGoals() (and therefore the dashboard) for the whole
    // workspace with no operator repair path. Suggested fix: skip + surface a diagnostic
    // (or auto-repair) for dangling workflow references the same way orphan tasks are
    // filtered, instead of throwing inside the .map().
    await expect(repository.listGoals(DEFAULT_OWNER_USER_ID)).rejects.toThrow(
      new RegExp(`Workflow ${orphanedBundle.workflow.id} is missing for goal ${orphanedBundle.goal.id}`)
    );
  });

  it("normalises hostile page limits and behaves sanely at the beyond-end cursor edge", () => {
    expect(normalizeCollectionPageLimit(undefined)).toBe(DEFAULT_COLLECTION_PAGE_LIMIT);
    expect(normalizeCollectionPageLimit(0)).toBe(DEFAULT_COLLECTION_PAGE_LIMIT);
    expect(normalizeCollectionPageLimit(-25)).toBe(DEFAULT_COLLECTION_PAGE_LIMIT);
    expect(normalizeCollectionPageLimit(Number.NaN)).toBe(DEFAULT_COLLECTION_PAGE_LIMIT);
    expect(normalizeCollectionPageLimit(Number.POSITIVE_INFINITY)).toBe(DEFAULT_COLLECTION_PAGE_LIMIT);
    expect(normalizeCollectionPageLimit(MAX_COLLECTION_PAGE_LIMIT + 1)).toBe(DEFAULT_COLLECTION_PAGE_LIMIT);
    expect(normalizeCollectionPageLimit(MAX_COLLECTION_PAGE_LIMIT)).toBe(MAX_COLLECTION_PAGE_LIMIT);
    expect(normalizeCollectionPageLimit(7.9)).toBe(7);

    const items = Array.from({ length: 5 }, (_, index) => ({
      id: `item-${index}`,
      createdAt: `2026-02-0${index + 1}T00:00:00.000Z`
    }));
    const page = (cursor?: string | null, limit?: number) =>
      buildCollectionPage({
        items,
        limit,
        cursor,
        getCursorKey: (item) => ({ createdAt: item.createdAt, id: item.id }),
        parsePage: (result) => result
      });

    const firstPage = page(undefined, 2);

    expect(firstPage.items.map((item) => item.id)).toEqual(["item-4", "item-3"]);
    expect(firstPage.nextCursor).not.toBeNull();

    // A cursor older than every item is "past the end" for a descending page.
    const beyondEnd = encodeCollectionCursor({ createdAt: "2000-01-01T00:00:00.000Z", id: "aaa" });

    expect(page(beyondEnd, 2).items).toEqual([]);
    expect(page(beyondEnd, 2).nextCursor).toBeNull();

    // Walking to the last page terminates with a null cursor.
    const secondPage = page(firstPage.nextCursor, 2);

    expect(secondPage.items.map((item) => item.id)).toEqual(["item-2", "item-1"]);

    const thirdPage = page(secondPage.nextCursor, 2);

    expect(thirdPage.items.map((item) => item.id)).toEqual(["item-0"]);
    expect(thirdPage.nextCursor).toBeNull();

    // A limit below the item count still mints a continuation cursor (no silent truncation).
    const clampedPage = page(undefined, 3);

    expect(clampedPage.items).toHaveLength(3);
    expect(clampedPage.limit).toBe(3);
    expect(clampedPage.nextCursor).not.toBeNull();

    // Zero-item collections never mint a cursor from a missing last item.
    expect(
      buildCollectionPage({
        items: [],
        limit: 3,
        getCursorKey: (item: { id: string; createdAt: string }) => ({ createdAt: item.createdAt, id: item.id }),
        parsePage: (result) => result
      }).nextCursor
    ).toBeNull();

    expect(decodeCollectionCursor(undefined)).toBeNull();
    expect(decodeCollectionCursor("")).toBeNull();
    expect(() => decodeCollectionCursor("not-base64!!")).toThrow(CollectionPageQueryError);
    expect(() =>
      decodeCollectionCursor(
        Buffer.from(JSON.stringify({ createdAt: "yesterday", id: "x" })).toString("base64url")
      )
    ).toThrow(/cursor is invalid/);
    expect(collectionCursorErrorCode(Buffer.from(JSON.stringify({ createdAt: "yesterday", id: "x" })).toString("base64url"))).toBe(
      "invalid_cursor"
    );
    expect(() =>
      decodeCollectionCursor(Buffer.from(JSON.stringify(["item"])).toString("base64url"))
    ).toThrow(CollectionPageQueryError);
  });

  it("rejects a forged cursor payload that is valid base64url of non-JSON text", async () => {
    const tempDir = await createScratchDir("cursor-route");
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({ storePath });

    await repository.saveMemory(buildMemory({ id: "mem-page", createdAt: nowIso(), updatedAt: nowIso() }));

    await expect(repository.listMemoryPage({ cursor: "////", limit: 1 })).rejects.toMatchObject({
      code: "invalid_cursor"
    });
    await expect(repository.listMemoryPage({ limit: 1 })).resolves.toMatchObject({
      limit: 1,
      items: [{ id: "mem-page" }]
    });
  });
});
