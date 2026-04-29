import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID } from "@agentic/contracts";
import { createMemoryRecord } from "@agentic/memory";
import { createRepository } from "@agentic/repository";
import {
  buildAuthorizedGetRequest,
  buildAuthorizedJsonRequest,
  expectNoStoreHeaders
} from "./route-test-helpers";
import {
  GET as listContextPackets,
  POST as createContextPacket
} from "../apps/web/app/api/context/packets/route";

describe("context packets route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-context-packets-route-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  it("lists policy-filtered context packets without exposing another user's records", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.seedDefaults("other-user");
    await repository.saveMemory(
      createMemoryRecord({
        id: "visible-memory",
        userId: SYSTEM_USER_ID,
        category: "preferences",
        memoryType: "observed",
        content: "Visible context packet.",
        confidence: 0.8,
        source: "test",
        sensitivity: "diagnostic-visible",
        permissions: ["knowledge"]
      })
    );
    await repository.saveMemory(
      createMemoryRecord({
        id: "other-user-memory",
        userId: "other-user",
        category: "preferences",
        memoryType: "observed",
        content: "Other user's context packet.",
        confidence: 0.8,
        source: "test",
        sensitivity: "internal",
        permissions: ["knowledge"]
      })
    );
    await repository.saveMemory(
      createMemoryRecord({
        id: "restricted-memory",
        userId: SYSTEM_USER_ID,
        category: "preferences",
        memoryType: "observed",
        content: "Restricted context packet.",
        confidence: 0.8,
        source: "test",
        sensitivity: "restricted",
        permissions: ["knowledge"]
      })
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await listContextPackets(
      buildAuthorizedGetRequest("http://localhost/api/context/packets?agent=knowledge&sensitivity=diagnostic-visible")
    );
    const payload = (await response.json()) as { packets: Array<{ id: string; content?: string }> };

    expect(response.status).toBe(200);
    expectNoStoreHeaders(response);
    expect(payload.packets.map((packet) => packet.id)).toEqual(["ctx_visible-memory"]);
    expect(payload.packets[0]).not.toHaveProperty("content");
  });

  it("creates a packet through memory capture with explicit consent and retention metadata", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    await repository.seedDefaults(SYSTEM_USER_ID);
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await createContextPacket(
      buildAuthorizedJsonRequest("http://localhost/api/context/packets", {
        category: "preferences",
        content: "Prefers action-oriented summaries.",
        memoryType: "confirmed",
        sensitivity: "internal",
        permissions: ["knowledge"],
        reviewAt: "2026-05-01T00:00:00.000Z",
        expiryAt: "2026-06-01T00:00:00.000Z",
        consentBasis: "explicit"
      })
    );
    const payload = (await response.json()) as {
      packet: {
        id: string;
        consent: { basis: string; grantedBy: string };
        retention: { reviewAt: string; expiryAt: string };
        lineage: { sourceMemoryIds: string[] };
      };
      memoryId: string;
    };

    expect(response.status).toBe(201);
    expect(payload.packet.id).toBe(`ctx_${payload.memoryId}`);
    expect(payload.packet.consent).toMatchObject({
      basis: "explicit",
      grantedBy: SYSTEM_USER_ID
    });
    expect(payload.packet.retention).toEqual({
      reviewAt: "2026-05-01T00:00:00.000Z",
      expiryAt: "2026-06-01T00:00:00.000Z"
    });
    expect(payload.packet.lineage.sourceMemoryIds).toEqual([payload.memoryId]);
  });

  it("rejects unknown fields at the packet creation boundary", async () => {
    const response = await createContextPacket(
      buildAuthorizedJsonRequest("http://localhost/api/context/packets", {
        category: "preferences",
        content: "Valid content.",
        unexpected: true
      })
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain("Unrecognized key");
  });
});
