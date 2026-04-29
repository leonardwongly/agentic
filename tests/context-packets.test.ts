import { createMemoryRecord, buildContextPacketFromMemory, queryContextPackets } from "@agentic/memory";

describe("context packets", () => {
  it("projects memory records into provenance-rich context packets", () => {
    const memory = createMemoryRecord({
      id: "memory-1",
      userId: "user-1",
      category: "preferences",
      memoryType: "confirmed",
      content: "Prefers concise follow-up drafts with explicit next steps.",
      confidence: 0.94,
      source: "ui",
      sensitivity: "internal",
      permissions: ["orchestrator", "knowledge"],
      reviewAt: "2026-05-01T00:00:00.000Z",
      expiryAt: "2026-06-01T00:00:00.000Z",
      createdAt: "2026-04-16T00:00:00.000Z",
      updatedAt: "2026-04-17T00:00:00.000Z"
    });

    const packet = buildContextPacketFromMemory(memory, {
      now: Date.parse("2026-04-18T00:00:00.000Z")
    });

    expect(packet).toMatchObject({
      id: "ctx_memory-1",
      userId: "user-1",
      source: {
        kind: "memory",
        id: "memory-1"
      },
      sensitivity: "internal",
      freshness: {
        status: "fresh",
        observedAt: "2026-04-17T00:00:00.000Z",
        staleAt: "2026-06-01T00:00:00.000Z"
      },
      retention: {
        reviewAt: "2026-05-01T00:00:00.000Z",
        expiryAt: "2026-06-01T00:00:00.000Z"
      },
      lineage: {
        sourceMemoryIds: ["memory-1"],
        transformationIds: ["memory:memory-1:packet"]
      }
    });
    expect(packet.contentSummary).toContain("explicit next steps");
  });

  it("filters expired, restricted, and agent-inaccessible packets by default", () => {
    const fresh = createMemoryRecord({
      id: "fresh",
      userId: "user-1",
      category: "preferences",
      memoryType: "observed",
      content: "Fresh context.",
      confidence: 0.8,
      source: "test",
      sensitivity: "internal",
      permissions: ["knowledge"],
      createdAt: "2026-04-16T00:00:00.000Z",
      updatedAt: "2026-04-16T00:00:00.000Z"
    });
    const expired = createMemoryRecord({
      ...fresh,
      id: "expired",
      content: "Expired context.",
      expiryAt: "2026-04-15T00:00:00.000Z"
    });
    const restricted = createMemoryRecord({
      ...fresh,
      id: "restricted",
      content: "Restricted context.",
      sensitivity: "restricted"
    });
    const otherAgent = createMemoryRecord({
      ...fresh,
      id: "other-agent",
      content: "Workflow-only context.",
      permissions: ["workflow"]
    });

    const packets = queryContextPackets([fresh, expired, restricted, otherAgent], {
      userId: "user-1",
      agent: "knowledge",
      now: Date.parse("2026-04-16T00:00:00.000Z")
    });

    expect(packets.map((packet) => packet.id)).toEqual(["ctx_fresh"]);
  });

  it("allows explicit restricted and expired packet queries for authorized diagnostic views", () => {
    const restrictedExpired = createMemoryRecord({
      id: "restricted-expired",
      userId: "user-1",
      category: "diagnostics",
      memoryType: "observed",
      content: "Restricted expired diagnostic context.",
      confidence: 0.9,
      source: "test",
      sensitivity: "restricted",
      permissions: ["knowledge"],
      expiryAt: "2026-04-15T00:00:00.000Z",
      createdAt: "2026-04-14T00:00:00.000Z",
      updatedAt: "2026-04-14T00:00:00.000Z"
    });

    const packets = queryContextPackets([restrictedExpired], {
      userId: "user-1",
      agent: "knowledge",
      includeExpired: true,
      allowedSensitivities: ["restricted"],
      now: Date.parse("2026-04-16T00:00:00.000Z")
    });

    expect(packets).toHaveLength(1);
    expect(packets[0]).toMatchObject({
      id: "ctx_restricted-expired",
      freshness: {
        status: "expired"
      }
    });
  });
});
