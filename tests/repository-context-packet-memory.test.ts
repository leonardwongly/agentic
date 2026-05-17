import { listContextPacketMemoryWithPool } from "../packages/repository/src/repository-context-packet-memory";

describe("repository context packet memory", () => {
  it("uses JSONB-aware permission filtering for agent-scoped Postgres queries", async () => {
    const rows = [
      {
        id: "memory-1",
        user_id: "user-1",
        category: "preferences",
        memory_type: "observed",
        content: "Visible context packet.",
        confidence: 0.8,
        source: "test",
        sensitivity: "internal",
        permissions: ["knowledge"],
        actor_context: null,
        context_packet_consent: null,
        agent_id: "agent-primary",
        agent_scope: "agent-only",
        review_at: null,
        expiry_at: null,
        created_at: "2026-04-16T00:00:00.000Z",
        updated_at: "2026-04-17T00:00:00.000Z"
      }
    ];
    const queries: Array<{ text: string; values: unknown[] }> = [];
    const pool = {
      query: async (text: string, values: unknown[]) => {
        queries.push({ text, values });
        return { rows };
      }
    };

    const memories = await listContextPacketMemoryWithPool(pool as never, {
      userId: "user-1",
      agent: "knowledge",
      agentId: "agent-primary",
      now: Date.parse("2026-04-18T00:00:00.000Z")
    });

    expect(memories.map((memory) => memory.id)).toEqual(["memory-1"]);
    expect(memories[0]).toMatchObject({
      agentId: "agent-primary",
      agentScope: "agent-only"
    });
    expect(queries).toHaveLength(1);
    expect(queries[0].text).toContain("permissions @> jsonb_build_array($3::text)");
    expect(queries[0].text).toContain("(agent_id is null or agent_id = $4)");
    expect(queries[0].text).not.toContain("= any(permissions)");
    expect(queries[0].values).toEqual(["user-1", "2026-04-18T00:00:00.000Z", "knowledge", "agent-primary", 50]);
  });

  it("does not expose agent-scoped Postgres memory through global context queries", async () => {
    const queries: Array<{ text: string; values: unknown[] }> = [];
    const pool = {
      query: async (text: string, values: unknown[]) => {
        queries.push({ text, values });
        return { rows: [] };
      }
    };

    const memories = await listContextPacketMemoryWithPool(pool as never, {
      userId: "user-1",
      agent: "knowledge",
      now: Date.parse("2026-04-18T00:00:00.000Z")
    });

    expect(memories).toEqual([]);
    expect(queries).toHaveLength(1);
    expect(queries[0].text).toContain("agent_id is null");
    expect(queries[0].values).toEqual(["user-1", "2026-04-18T00:00:00.000Z", "knowledge", 50]);
  });
});
