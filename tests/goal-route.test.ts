import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID, createHumanActorContext, createSystemActorContext } from "@agentic/contracts";
import { createRepository } from "@agentic/repository";
import { processUserRequest } from "@agentic/orchestrator";
import { vi } from "vitest";
import * as authModule from "../apps/web/lib/auth";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import { GET as goalRoute } from "../apps/web/app/api/goals/[id]/route";
import { POST as goalRefineRoute } from "../apps/web/app/api/goals/[id]/refine/route";

describe("goal route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  async function createGoalForUser(
    repository: ReturnType<typeof createRepository>,
    userId: string,
    request: string
  ) {
    const bundle = await processUserRequest({
      userId,
      request,
      memories: await repository.listMemory(userId),
      integrations: await repository.listIntegrations(userId)
    });

    await repository.saveGoalBundle(bundle);
    return bundle;
  }

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-goal-route-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  it("returns 404 for a goal owned by another user", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const secondaryUserId = "user-secondary";

    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.seedDefaults(secondaryUserId);

    const secondaryBundle = await createGoalForUser(repository, secondaryUserId, "Keep another user's planning private.");

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await goalRoute(
      new Request(`http://localhost/api/goals/${secondaryBundle.goal.id}`, {
        method: "GET",
        headers: {
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        }
      }),
      {
        params: Promise.resolve({ id: secondaryBundle.goal.id })
      }
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(404);
    expect(payload.error).toContain(`Goal ${secondaryBundle.goal.id} was not found.`);
  });

  it("returns 404 when attempting to refine another user's goal", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const secondaryUserId = "user-secondary";

    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.seedDefaults(secondaryUserId);

    const secondaryBundle = await createGoalForUser(repository, secondaryUserId, "Keep another user's planning private.");

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await goalRefineRoute(
      new Request(`http://localhost/api/goals/${secondaryBundle.goal.id}/refine`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        },
        body: JSON.stringify({
          message: "Expose a cross-user refinement attempt."
        })
      }),
      {
        params: Promise.resolve({ id: secondaryBundle.goal.id })
      }
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(404);
    expect(payload.error).toContain(`Goal ${secondaryBundle.goal.id} was not found.`);
  });

  it("stamps access-key actor context onto goal refinement logs", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(SYSTEM_USER_ID);
    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Plan follow-ups for my open client work.");

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await goalRefineRoute(
      new Request(`http://localhost/api/goals/${bundle.goal.id}/refine`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        },
        body: JSON.stringify({
          message: "Also include a handoff summary for the reviewer."
        })
      }),
      {
        params: Promise.resolve({ id: bundle.goal.id })
      }
    );
    const payload = (await response.json()) as { bundle: { actionLogs: Array<{ kind: string; details: Record<string, unknown> }> } };
    const refinementLogs = payload.bundle.actionLogs.filter((log) => log.kind === "goal.refined");

    expect(response.status).toBe(200);
    expect(refinementLogs.length).toBeGreaterThanOrEqual(1);
    expect(refinementLogs.every((log) => log.details.actorContext)).toBe(true);
    expect(refinementLogs[0]?.details.actorContext).toEqual(createSystemActorContext(SYSTEM_USER_ID));
  });

  it("stamps session actor context onto goal refinement logs", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const secondaryUserId = "user-secondary";

    await repository.seedDefaults(secondaryUserId);
    const bundle = await createGoalForUser(repository, secondaryUserId, "Prepare a weekly planning summary.");
    const requireApiSessionSpy = vi.spyOn(authModule, "requireApiSession").mockResolvedValue({
      authMethod: "session",
      userId: secondaryUserId,
      sessionId: "session-secondary",
      expiresAt: null
    });

    Reflect.set(globalThis, "__agenticRepository", undefined);

    try {
      const response = await goalRefineRoute(
        new Request(`http://localhost/api/goals/${bundle.goal.id}/refine`, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            message: "Add an explicit risks section for leadership."
          })
        }),
        {
          params: Promise.resolve({ id: bundle.goal.id })
        }
      );
      const payload = (await response.json()) as { bundle: { actionLogs: Array<{ kind: string; details: Record<string, unknown> }> } };
      const refinementLogs = payload.bundle.actionLogs.filter((log) => log.kind === "goal.refined");

      expect(response.status).toBe(200);
      expect(refinementLogs.length).toBeGreaterThanOrEqual(1);
      expect(refinementLogs[0]?.details.actorContext).toEqual(createHumanActorContext(secondaryUserId, "session-secondary"));
    } finally {
      requireApiSessionSpy.mockRestore();
    }
  });
});
