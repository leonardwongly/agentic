import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_OWNER_USER_ID,
  WatcherSchema,
  WorkspaceMemberSchema,
  WorkspaceSchema,
  createHumanActorContext,
  createSystemActorContext,
  nowIso
} from "@agentic/contracts";
import { createRepository } from "@agentic/repository";
import { processUserRequest } from "@agentic/orchestrator";
import { vi } from "vitest";
import * as authModule from "../apps/web/lib/auth";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import { GET as listWatchersRoute, POST as watchersRoute } from "../apps/web/app/api/watchers/route";
import { PATCH as watcherUpdateRoute } from "../apps/web/app/api/watchers/[id]/route";

describe("watchers route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  async function createGoalForUser(
    repository: ReturnType<typeof createRepository>,
    userId: string,
    request: string,
    workspaceId?: string | null
  ) {
    const bundle = await processUserRequest({
      userId,
      workspaceId,
      request,
      memories: await repository.listMemory(userId),
      integrations: await repository.listIntegrations(userId)
    });

    await repository.saveGoalBundle(bundle);
    return bundle;
  }

  async function createSharedWorkspace(
    repository: ReturnType<typeof createRepository>,
    ownerUserId: string,
    memberUserId: string
  ) {
    const timestamp = "2026-04-22T00:00:00.000Z";
    const ownerActor = createSystemActorContext(ownerUserId);
    const workspaceId = "workspace-shared-watchers";

    await repository.saveWorkspace(
      WorkspaceSchema.parse({
        id: workspaceId,
        ownerUserId,
        slug: "shared-watchers",
        name: "Shared Watchers Workspace",
        description: "Shared workspace for watcher permission tests.",
        isPersonal: false,
        createdAt: timestamp,
        updatedAt: timestamp
      }),
      ownerActor
    );
    await repository.saveWorkspaceMember(
      WorkspaceMemberSchema.parse({
        id: "workspace-shared-watchers-owner",
        workspaceId,
        userId: ownerUserId,
        role: "owner",
        joinedAt: timestamp,
        updatedAt: timestamp
      }),
      ownerActor
    );

    return {
      workspaceId,
      addMember: async (role: "editor" | "viewer") =>
        repository.saveWorkspaceMember(
          WorkspaceMemberSchema.parse({
            id: `workspace-shared-watchers-${memberUserId}-${role}`,
            workspaceId,
            userId: memberUserId,
            role,
            joinedAt: timestamp,
            updatedAt: timestamp
          }),
          ownerActor
        )
    };
  }

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-watchers-route-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  function buildAuthorizedPatchRequest(watcherId: string, body: unknown) {
    return new Request(`http://localhost/api/watchers/${watcherId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
      },
      body: JSON.stringify(body)
    });
  }

  it("returns 404 when creating a watcher for a missing goal", async () => {
    const response = await watchersRoute(
      new Request("http://localhost/api/watchers", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        },
        body: JSON.stringify({
          goalId: "goal-does-not-exist",
          targetEntity: "priority-inbox",
          condition: "urgent thread appears",
          frequency: "hourly",
          triggerAction: "notify me"
        })
      })
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(404);
    expect(payload.error).toContain("Goal goal-does-not-exist was not found.");
  });

  it("returns 404 when creating a watcher for another user's goal", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const secondaryUserId = "user-secondary";

    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    await repository.seedDefaults(secondaryUserId);

    const secondaryBundle = await createGoalForUser(repository, secondaryUserId, "Watch someone else's private workflow.");

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await watchersRoute(
      new Request("http://localhost/api/watchers", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        },
        body: JSON.stringify({
          goalId: secondaryBundle.goal.id,
          targetEntity: "priority-inbox",
          condition: "urgent thread appears",
          frequency: "hourly",
          triggerAction: "notify me"
        })
      })
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(404);
    expect(payload.error).toContain(`Goal ${secondaryBundle.goal.id} was not found.`);
  });

  it("stamps the system actor when creating a watcher with an access key", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);

    const bundle = await createGoalForUser(repository, DEFAULT_OWNER_USER_ID, "Watch my inbox for urgent replies.");
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await watchersRoute(
      new Request("http://localhost/api/watchers", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        },
        body: JSON.stringify({
          goalId: bundle.goal.id,
          targetEntity: "priority-inbox",
          condition: "an urgent reply arrives",
          frequency: "hourly",
          triggerAction: "draft a response"
        })
      })
    );
    const payload = (await response.json()) as {
      watcher: { id: string; actorContext: unknown };
    };
    const savedWatcher = (await repository.listWatchers({ userId: DEFAULT_OWNER_USER_ID })).find(
      (watcher) => watcher.id === payload.watcher.id
    );

    expect(response.status).toBe(200);
    expect(payload.watcher.actorContext).toEqual(createSystemActorContext(DEFAULT_OWNER_USER_ID));
    expect(savedWatcher?.actorContext).toEqual(createSystemActorContext(DEFAULT_OWNER_USER_ID));
  });

  it("stamps the human actor when creating a watcher from a session principal", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const secondaryUserId = "user-secondary";

    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    await repository.seedDefaults(secondaryUserId);

    const bundle = await createGoalForUser(repository, secondaryUserId, "Watch my own inbox for escalation risk.");
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const requireApiSessionSpy = vi.spyOn(authModule, "requireApiSession").mockResolvedValue({
      authMethod: "session",
      userId: secondaryUserId,
      sessionId: "session-secondary",
      expiresAt: "2026-12-31T00:00:00.000Z"
    });

    let response: Response;
    let payload: { watcher: { id: string; actorContext: unknown } };
    try {
      response = await watchersRoute(
        new Request("http://localhost/api/watchers", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            goalId: bundle.goal.id,
            targetEntity: "priority-inbox",
            condition: "an urgent reply arrives",
            frequency: "hourly",
            triggerAction: "draft a response"
          })
        })
      );
      payload = (await response.json()) as { watcher: { id: string; actorContext: unknown } };
    } finally {
      requireApiSessionSpy.mockRestore();
    }

    const savedWatcher = (await repository.listWatchers({ userId: secondaryUserId })).find(
      (watcher) => watcher.id === payload.watcher.id
    );

    expect(response.status).toBe(200);
    expect(payload.watcher.actorContext).toEqual(createHumanActorContext(secondaryUserId, "session-secondary"));
    expect(savedWatcher?.actorContext).toEqual(createHumanActorContext(secondaryUserId, "session-secondary"));
  });

  it("allows editors to create shared workspace watchers with normalized responsibility metadata", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const editorUserId = "user-editor";

    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    await repository.seedDefaults(editorUserId);

    const workspace = await createSharedWorkspace(repository, DEFAULT_OWNER_USER_ID, editorUserId);
    await workspace.addMember("editor");

    const bundle = await createGoalForUser(
      repository,
      DEFAULT_OWNER_USER_ID,
      "Watch shared inbox escalations for the team.",
      workspace.workspaceId
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const requireApiSessionSpy = vi.spyOn(authModule, "requireApiSession").mockResolvedValue({
      authMethod: "session",
      userId: editorUserId,
      sessionId: "session-editor",
      expiresAt: "2026-12-31T00:00:00.000Z"
    });

    let response: Response;
    let payload: {
      watcher: {
        id: string;
        actorContext: unknown;
        responsibility: {
          owner: { userId: string | null };
          delegate: { kind: string; workspaceRole: string | null } | null;
        };
      };
    };
    try {
      response = await watchersRoute(
        new Request("http://localhost/api/watchers", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            goalId: bundle.goal.id,
            targetEntity: "shared-priority-inbox",
            condition: "a shared escalation appears",
            frequency: "hourly",
            triggerAction: "draft the next response"
          })
        })
      );
      payload = (await response.json()) as typeof payload;
    } finally {
      requireApiSessionSpy.mockRestore();
    }

    const savedWatcher = (await repository.listWatchers({ userId: editorUserId })).find(
      (watcher) => watcher.id === payload.watcher.id
    );

    expect(response.status).toBe(200);
    expect(payload.watcher.actorContext).toEqual(createHumanActorContext(editorUserId, "session-editor"));
    expect(payload.watcher.responsibility.owner.userId).toBe(DEFAULT_OWNER_USER_ID);
    expect(payload.watcher.responsibility.delegate).toMatchObject({
      kind: "workspace_role",
      workspaceRole: "editor"
    });
    expect(savedWatcher?.responsibility.owner.userId).toBe(DEFAULT_OWNER_USER_ID);
    expect(savedWatcher?.responsibility.delegate).toMatchObject({
      kind: "workspace_role",
      workspaceRole: "editor"
    });
  });

  it("returns 403 when a viewer tries to create a shared workspace watcher", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const viewerUserId = "user-viewer";

    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    await repository.seedDefaults(viewerUserId);

    const workspace = await createSharedWorkspace(repository, DEFAULT_OWNER_USER_ID, viewerUserId);
    await workspace.addMember("viewer");

    const bundle = await createGoalForUser(
      repository,
      DEFAULT_OWNER_USER_ID,
      "Watch shared workspace inbox escalations.",
      workspace.workspaceId
    );
    const watchersBefore = await repository.listWatchers({ userId: viewerUserId });
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const requireApiSessionSpy = vi.spyOn(authModule, "requireApiSession").mockResolvedValue({
      authMethod: "session",
      userId: viewerUserId,
      sessionId: "session-viewer",
      expiresAt: "2026-12-31T00:00:00.000Z"
    });

    let response: Response;
    let payload: { error?: string };
    try {
      response = await watchersRoute(
        new Request("http://localhost/api/watchers", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            goalId: bundle.goal.id,
            targetEntity: "shared-priority-inbox",
            condition: "a shared escalation appears",
            frequency: "hourly",
            triggerAction: "draft the next response"
          })
        })
      );
      payload = (await response.json()) as { error?: string };
    } finally {
      requireApiSessionSpy.mockRestore();
    }

    expect(response.status).toBe(403);
    expect(payload.error).toBe(
      "Viewers can inspect shared workflow watchers, but only workspace owners and editors can create or change them."
    );
    const watchersAfter = await repository.listWatchers({ userId: viewerUserId });

    expect(watchersAfter).toHaveLength(watchersBefore.length);
    expect(
      watchersAfter.some(
        (watcher) => watcher.goalId === bundle.goal.id && watcher.targetEntity === "shared-priority-inbox"
      )
    ).toBe(false);
  }, 10_000);

  it("lists only watchers for the authenticated user's goals", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const secondaryUserId = "user-secondary";

    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    await repository.seedDefaults(secondaryUserId);

    const primaryBundle = await createGoalForUser(repository, DEFAULT_OWNER_USER_ID, "Watch my calendar for conflicts.");
    const secondaryBundle = await createGoalForUser(repository, secondaryUserId, "Watch another user's inbox.");

    await repository.saveWatcher(
      WatcherSchema.parse({
        id: "watcher-primary",
        goalId: primaryBundle.goal.id,
        targetEntity: "calendar",
        condition: "focus block changes",
        frequency: "hourly",
        triggerAction: "notify me",
        sourceSystems: ["calendar"],
        status: "active",
        expiryAt: null,
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
    );

    await repository.saveWatcher(
      WatcherSchema.parse({
        id: "watcher-secondary",
        goalId: secondaryBundle.goal.id,
        targetEntity: "inbox",
        condition: "vip mail arrives",
        frequency: "hourly",
        triggerAction: "draft reply",
        sourceSystems: ["email"],
        status: "active",
        expiryAt: null,
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
    );

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await listWatchersRoute(
      new Request("http://localhost/api/watchers", {
        method: "GET",
        headers: {
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        }
      })
    );
    const payload = (await response.json()) as { watchers: Array<{ id: string; goalId: string }> };

    expect(response.status).toBe(200);
    expect(payload.watchers.some((watcher) => watcher.id === "watcher-primary")).toBe(true);
    expect(payload.watchers.every((watcher) => watcher.goalId === primaryBundle.goal.id)).toBe(true);
    expect(payload.watchers.some((watcher) => watcher.id === "watcher-secondary")).toBe(false);
  });

  it("uses the session principal instead of the system user when listing watchers", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const secondaryUserId = "user-secondary";

    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    await repository.seedDefaults(secondaryUserId);

    const primaryBundle = await createGoalForUser(repository, DEFAULT_OWNER_USER_ID, "Watch my calendar for conflicts.");
    const secondaryBundle = await createGoalForUser(repository, secondaryUserId, "Watch my own inbox.");

    await repository.saveWatcher(
      WatcherSchema.parse({
        id: "watcher-system-only",
        goalId: primaryBundle.goal.id,
        targetEntity: "calendar",
        condition: "focus block changes",
        frequency: "hourly",
        triggerAction: "notify me",
        sourceSystems: ["calendar"],
        status: "active",
        expiryAt: null,
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
    );

    await repository.saveWatcher(
      WatcherSchema.parse({
        id: "watcher-session-user",
        goalId: secondaryBundle.goal.id,
        targetEntity: "inbox",
        condition: "vip mail arrives",
        frequency: "hourly",
        triggerAction: "draft reply",
        sourceSystems: ["email"],
        status: "active",
        expiryAt: null,
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
    );

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const requireApiSessionSpy = vi.spyOn(authModule, "requireApiSession").mockResolvedValue({
      authMethod: "session",
      userId: secondaryUserId,
      sessionId: "session-secondary",
      expiresAt: "2026-12-31T00:00:00.000Z"
    });

    let response: Response;
    let payload: { watchers: Array<{ id: string; goalId: string }> };
    try {
      response = await listWatchersRoute(
        new Request("http://localhost/api/watchers", {
          method: "GET"
        })
      );
      payload = (await response.json()) as { watchers: Array<{ id: string; goalId: string }> };
    } finally {
      requireApiSessionSpy.mockRestore();
    }

    expect(response.status).toBe(200);
    expect(payload.watchers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "watcher-session-user",
          goalId: secondaryBundle.goal.id
        })
      ])
    );
    expect(payload.watchers.some((watcher) => watcher.id === "watcher-system-only")).toBe(false);
    expect(payload.watchers.some((watcher) => watcher.goalId === primaryBundle.goal.id)).toBe(false);
  });

  it("pauses an active watcher and returns refreshed dashboard data", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);

    const bundle = await createGoalForUser(repository, DEFAULT_OWNER_USER_ID, "Watch my inbox for priority threads.");
    const watcher = WatcherSchema.parse({
      id: "watcher-active",
      goalId: bundle.goal.id,
      targetEntity: "priority inbox",
      condition: "vip mail arrives",
      frequency: "hourly",
      triggerAction: "notify me",
      sourceSystems: ["email"],
      status: "active",
      expiryAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    await repository.saveWatcher(watcher);
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await watcherUpdateRoute(buildAuthorizedPatchRequest(watcher.id, { action: "pause" }), {
      params: Promise.resolve({ id: watcher.id })
    });
    const payload = (await response.json()) as {
      watcher: { id: string; status: string; actorContext: unknown };
      dashboard: { watchers: Array<{ id: string; status: string }> };
    };
    const savedWatcher = (await repository.listWatchers({ userId: DEFAULT_OWNER_USER_ID })).find(
      (candidate) => candidate.id === watcher.id
    );

    expect(response.status).toBe(200);
    expect(payload.watcher).toMatchObject({
      id: watcher.id,
      status: "paused"
    });
    expect(payload.watcher.actorContext).toEqual(createSystemActorContext(DEFAULT_OWNER_USER_ID));
    expect(savedWatcher?.actorContext).toEqual(createSystemActorContext(DEFAULT_OWNER_USER_ID));
    expect(payload.dashboard.watchers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: watcher.id,
          status: "paused"
        })
      ])
    );
  });

  it("returns 404 when updating another user's watcher", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const secondaryUserId = "user-secondary";

    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    await repository.seedDefaults(secondaryUserId);

    const secondaryBundle = await createGoalForUser(repository, secondaryUserId, "Watch another user's inbox.");
    const secondaryWatcher = WatcherSchema.parse({
      id: "watcher-secondary-private",
      goalId: secondaryBundle.goal.id,
      targetEntity: "priority inbox",
      condition: "urgent thread appears",
      frequency: "hourly",
      triggerAction: "notify me",
      sourceSystems: ["email"],
      status: "active",
      expiryAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    await repository.saveWatcher(secondaryWatcher);
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await watcherUpdateRoute(buildAuthorizedPatchRequest(secondaryWatcher.id, { action: "pause" }), {
      params: Promise.resolve({ id: secondaryWatcher.id })
    });
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(404);
    expect(payload.error).toContain(`Watcher ${secondaryWatcher.id} was not found.`);
  });

  it("returns 403 when a viewer tries to update a shared workspace watcher", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const viewerUserId = "user-viewer";

    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    await repository.seedDefaults(viewerUserId);

    const workspace = await createSharedWorkspace(repository, DEFAULT_OWNER_USER_ID, viewerUserId);
    await workspace.addMember("viewer");

    const bundle = await createGoalForUser(
      repository,
      DEFAULT_OWNER_USER_ID,
      "Watch shared inbox escalations for the team.",
      workspace.workspaceId
    );
    const watcher = await repository.saveWatcher(
      WatcherSchema.parse({
        id: "watcher-shared-viewer-denied",
        goalId: bundle.goal.id,
        targetEntity: "shared-priority-inbox",
        condition: "a shared escalation appears",
        frequency: "hourly",
        triggerAction: "draft the next response",
        sourceSystems: ["email"],
        status: "active",
        expiryAt: null,
        actorContext: createSystemActorContext(DEFAULT_OWNER_USER_ID),
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const requireApiSessionSpy = vi.spyOn(authModule, "requireApiSession").mockResolvedValue({
      authMethod: "session",
      userId: viewerUserId,
      sessionId: "session-viewer",
      expiresAt: "2026-12-31T00:00:00.000Z"
    });

    let response: Response;
    let payload: { error?: string };
    try {
      response = await watcherUpdateRoute(
        new Request(`http://localhost/api/watchers/${watcher.id}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({ action: "pause" })
        }),
        {
          params: Promise.resolve({ id: watcher.id })
        }
      );
      payload = (await response.json()) as { error?: string };
    } finally {
      requireApiSessionSpy.mockRestore();
    }

    const persisted = (await repository.listWatchers({ userId: DEFAULT_OWNER_USER_ID })).find((candidate) => candidate.id === watcher.id);

    expect(response.status).toBe(403);
    expect(payload.error).toBe(
      "Viewers can inspect shared workflow watchers, but only workspace owners and editors can create or change them."
    );
    expect(persisted?.status).toBe("active");
  });
});
