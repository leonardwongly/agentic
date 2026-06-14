import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type MemoryRecord } from "@agentic/contracts";
import {
  createMemoryRecord,
  detectMemoryConflicts,
  queryContextPackets,
  rankRelevantMemories,
  supersedeMemory
} from "@agentic/memory";
import { createRepository } from "@agentic/repository";
import { describe, expect, it } from "vitest";

function mem(id: string, content: string, overrides: Record<string, unknown> = {}): MemoryRecord {
  return createMemoryRecord({
    id,
    userId: "owner",
    category: "preferences",
    memoryType: "confirmed",
    content,
    confidence: 0.9,
    source: "ui",
    ...overrides
  });
}

describe("memory belief-revision (AOS-24)", () => {
  it("defaults version/supersedes/validFrom for legacy records", () => {
    const record = mem("m1", "Standup is at 9am.");
    expect(record.version).toBe(1);
    expect(record.supersedes).toBeNull();
    expect(record.validFrom).toBeNull();
  });

  it("supersede-on-write marks the prior contradicted and links the replacement", () => {
    const { contradicted, replacement } = supersedeMemory(mem("m1", "Standup is on Mondays."), mem("m2", "Standup is on Tuesdays."));

    expect(contradicted.memoryType).toBe("contradicted");
    expect(replacement.version).toBe(2);
    expect(replacement.supersedes).toBe("m1");
    expect(replacement.validFrom).not.toBeNull();
  });

  it("a corrected memory yields no read-time conflict", () => {
    const prior = mem("m1", "Standup is on Mondays.");
    const next = mem("m2", "Standup is on Tuesdays.");

    // Conflicting peers before supersede.
    expect(detectMemoryConflicts([prior, next]).length).toBeGreaterThanOrEqual(1);

    // After supersede, the prior is contradicted and drops out -> no conflict.
    const { contradicted, replacement } = supersedeMemory(prior, next);
    expect(detectMemoryConflicts([contradicted, replacement])).toEqual([]);
  });

  it("excludes contradicted and superseded records from ranking", () => {
    const { contradicted, replacement } = supersedeMemory(
      mem("m1", "Project codename is Atlas."),
      mem("m2", "Project codename is Borealis.")
    );

    expect(rankRelevantMemories("project codename", [contradicted, replacement]).map((record) => record.id)).toEqual(["m2"]);
  });

  it("excludes contradicted records from context packet queries", () => {
    const { contradicted, replacement } = supersedeMemory(mem("m1", "Likes window seats."), mem("m2", "Prefers aisle seats."));

    expect(queryContextPackets([contradicted, replacement], { userId: "owner" }).map((packet) => packet.source.id)).toEqual([
      "m2"
    ]);
  });

  it("treats the stored expired assertion state as non-retrievable", () => {
    const expired = mem("m1", "Old preference.", { memoryType: "expired" });
    const active = mem("m2", "Current preference.");

    expect(rankRelevantMemories("preference", [expired, active]).map((record) => record.id)).toEqual(["m2"]);
  });

  it("persists belief-revision fields and supersession through the repository", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-memory-bv-"));
    const repository = createRepository({ storePath: path.join(tempDir, "runtime-store.json") });
    await repository.seedDefaults("owner");

    const { contradicted, replacement } = supersedeMemory(mem("m1", "X is A."), mem("m2", "X is B."));
    await repository.saveMemory(contradicted);
    await repository.saveMemory(replacement);

    const stored = await repository.listMemory("owner");
    const storedReplacement = stored.find((record) => record.id === "m2");
    const storedPrior = stored.find((record) => record.id === "m1");

    expect(storedReplacement?.version).toBe(2);
    expect(storedReplacement?.supersedes).toBe("m1");
    expect(storedReplacement?.validFrom).not.toBeNull();
    expect(storedPrior?.memoryType).toBe("contradicted");
  });
});
