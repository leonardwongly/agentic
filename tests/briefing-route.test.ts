import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID } from "@agentic/contracts";
import { createRepository } from "@agentic/repository";
import { vi } from "vitest";
import * as authModule from "../apps/web/lib/auth";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import { POST as briefingRoute } from "../apps/web/app/api/briefing/route";

describe("briefing route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-briefing-route-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  it("generates the requested briefing type and records it in dashboard history", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(SYSTEM_USER_ID);
    const current = await repository.getBriefingPreferences(SYSTEM_USER_ID);
    await repository.saveBriefingPreferences({
      ...current,
      focus: "urgent",
      timezone: "America/New_York"
    });
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await briefingRoute(
      new Request("http://localhost/api/briefing", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        },
        body: JSON.stringify({ type: "midday" })
      })
    );
    const payload = (await response.json()) as {
      bundle: { goal: { id: string; intent: string; explanation: string; title: string } };
      dashboard: { briefingHistory: Array<{ goalId: string; type: string }>; goals: Array<{ goal: { id: string } }> };
    };

    expect(response.status).toBe(200);
    expect(payload.bundle.goal.intent).toBe("briefing:midday");
    expect(payload.bundle.goal.title).toContain("Midday drift check");
    expect(payload.bundle.goal.explanation).toContain("urgent");
    expect(payload.dashboard.goals.some((bundle) => bundle.goal.id === payload.bundle.goal.id)).toBe(true);
    expect(payload.dashboard.briefingHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          goalId: payload.bundle.goal.id,
          type: "midday"
        })
      ])
    );
  });

  it("defaults empty requests to a startup briefing", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(SYSTEM_USER_ID);
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await briefingRoute(
      new Request("http://localhost/api/briefing", {
        method: "POST",
        headers: {
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        }
      })
    );
    const payload = (await response.json()) as { bundle: { goal: { intent: string; title: string } } };

    expect(response.status).toBe(200);
    expect(payload.bundle.goal.intent).toBe("briefing:startup");
    expect(payload.bundle.goal.title).toContain("Startup briefing");
  });

  it("uses the session principal when resolving briefing preferences and goal ownership", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const secondaryUserId = "user-secondary";

    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.seedDefaults(secondaryUserId);

    await repository.saveBriefingPreferences({
      ...(await repository.getBriefingPreferences(SYSTEM_USER_ID)),
      focus: "urgent"
    });
    await repository.saveBriefingPreferences({
      ...(await repository.getBriefingPreferences(secondaryUserId)),
      focus: "deep",
      timezone: "Europe/London"
    });
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const requireApiSessionSpy = vi.spyOn(authModule, "requireApiSession").mockResolvedValue({
      authMethod: "session",
      userId: secondaryUserId,
      sessionId: "session-secondary",
      expiresAt: "2026-12-31T00:00:00.000Z"
    });

    const response = await briefingRoute(
      new Request("http://localhost/api/briefing", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ type: "midday" })
      })
    );
    const payload = (await response.json()) as {
      bundle: { goal: { userId: string; explanation: string; intent: string } };
      dashboard: { goals: Array<{ goal: { userId: string } }> };
    };
    requireApiSessionSpy.mockRestore();

    expect(response.status).toBe(200);
    expect(payload.bundle.goal.userId).toBe(secondaryUserId);
    expect(payload.bundle.goal.intent).toBe("briefing:midday");
    expect(payload.bundle.goal.explanation).toContain("deep");
    expect(payload.bundle.goal.explanation).not.toContain("urgent");
    expect(payload.dashboard.goals.some((bundle) => bundle.goal.userId === secondaryUserId)).toBe(true);
  });

  it("rejects non-json bodies when a request payload is supplied", async () => {
    const response = await briefingRoute(
      new Request("http://localhost/api/briefing", {
        method: "POST",
        headers: {
          "content-type": "text/plain",
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        },
        body: "midday"
      })
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(415);
    expect(payload.error?.toLowerCase()).toContain("content-type");
  });
});
