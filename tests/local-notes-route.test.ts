import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import { GET as localNotesRouteGet, POST as localNotesRoutePost } from "../apps/web/app/api/integrations/local-notes/route";
import { GET as localNoteRouteGet, PUT as localNoteRoutePut } from "../apps/web/app/api/integrations/local-notes/[slug]/route";
import { expectNoStoreHeaders } from "./route-test-helpers";

function buildAuthorizedHeaders() {
  return {
    "content-type": "application/json",
    [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
  };
}

describe("local notes routes", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalLocalNotesEnabled = process.env.AGENTIC_LOCAL_NOTES_ENABLED;
  const originalLocalNotesAllowedRoot = process.env.AGENTIC_LOCAL_NOTES_ALLOWED_ROOT;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;
  const originalNotesPath = process.env.AGENTIC_NOTES_PATH;

  beforeEach(async () => {
    const sandboxRoot = await mkdtemp(path.join(os.tmpdir(), "agentic-local-notes-route-"));

    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(sandboxRoot, "runtime-store.json");
    process.env.AGENTIC_NOTES_PATH = path.join(sandboxRoot, "notes");
    process.env.AGENTIC_LOCAL_NOTES_ALLOWED_ROOT = sandboxRoot;
    process.env.AGENTIC_LOCAL_NOTES_ENABLED = "true";
    process.env.NODE_ENV = originalNodeEnv;
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_LOCAL_NOTES_ENABLED = originalLocalNotesEnabled;
    process.env.AGENTIC_LOCAL_NOTES_ALLOWED_ROOT = originalLocalNotesAllowedRoot;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    process.env.AGENTIC_NOTES_PATH = originalNotesPath;
    process.env.NODE_ENV = originalNodeEnv;
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  it("rejects unauthenticated list requests", async () => {
    const response = await localNotesRouteGet(new Request("http://localhost/api/integrations/local-notes?q=travel", { method: "GET" }));
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(401);
    expect(payload.error).toContain("Unauthorized");
    expectNoStoreHeaders(response);
  });

  it("rejects unauthenticated create requests", async () => {
    const response = await localNotesRoutePost(
      new Request("http://localhost/api/integrations/local-notes", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          title: "Unauthorized note",
          content: "This should not be accepted."
        })
      })
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(401);
    expect(payload.error).toContain("Unauthorized");
    expectNoStoreHeaders(response);
  });

  it("rejects oversized local-note create payloads", async () => {
    const response = await localNotesRoutePost(
      new Request("http://localhost/api/integrations/local-notes", {
        method: "POST",
        headers: buildAuthorizedHeaders(),
        body: JSON.stringify({
          title: "Oversized note",
          content: "x".repeat(10_001)
        })
      })
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain("10000");
    expectNoStoreHeaders(response);
  });

  it("rejects oversized local-note search queries", async () => {
    const response = await localNotesRouteGet(
      new Request(`http://localhost/api/integrations/local-notes?q=${"x".repeat(201)}`, {
        method: "GET",
        headers: buildAuthorizedHeaders()
      })
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain("q must be at most 200 characters.");
    expectNoStoreHeaders(response);
  });

  it("rejects oversized local-note update payloads", async () => {
    const createdResponse = await localNotesRoutePost(
      new Request("http://localhost/api/integrations/local-notes", {
        method: "POST",
        headers: buildAuthorizedHeaders(),
        body: JSON.stringify({
          title: "Route test note",
          content: "safe body"
        })
      })
    );
    const createdPayload = (await createdResponse.json()) as { note: { slug: string } };

    expect(createdResponse.status).toBe(200);
    expect(createdPayload.note).not.toHaveProperty("path");

    const updateResponse = await localNoteRoutePut(
      new Request(`http://localhost/api/integrations/local-notes/${createdPayload.note.slug}`, {
        method: "PUT",
        headers: buildAuthorizedHeaders(),
        body: JSON.stringify({
          title: "Route test note",
          content: "x".repeat(10_001)
        })
      }),
      { params: Promise.resolve({ slug: createdPayload.note.slug }) }
    );
    const updatePayload = (await updateResponse.json()) as { error?: string };

    expect(updateResponse.status).toBe(400);
    expect(updatePayload.error).toContain("10000");
    expectNoStoreHeaders(updateResponse);
  });

  it("rejects malformed note slugs without touching the filesystem", async () => {
    const response = await localNoteRouteGet(
      new Request("http://localhost/api/integrations/local-notes/../outside", {
        method: "GET",
        headers: {
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        }
      }),
      { params: Promise.resolve({ slug: "../outside" }) }
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain("Invalid string");
    expectNoStoreHeaders(response);
  });

  it("rejects symlinked direct-note reads without leaking outside paths", async () => {
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "agentic-local-notes-outside-target-"));
    const outsideNotePath = path.join(outsideRoot, "outside.md");
    const notesPath = process.env.AGENTIC_NOTES_PATH!;

    await mkdir(notesPath, { recursive: true });
    await writeFile(outsideNotePath, "# Outside Secret\n\nleaked-through-symlink\n", "utf8");
    await symlink(outsideNotePath, path.join(notesPath, "linked-note.md"));

    const response = await localNoteRouteGet(
      new Request("http://localhost/api/integrations/local-notes/linked-note", {
        method: "GET",
        headers: {
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        }
      }),
      { params: Promise.resolve({ slug: "linked-note" }) }
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(404);
    expect(payload.error).toBe("Local note was not found.");
    expect(JSON.stringify(payload)).not.toContain(outsideRoot);
    expectNoStoreHeaders(response);
  });

  it("fails closed without leaking local paths when production local notes are not explicitly enabled", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.AGENTIC_LOCAL_NOTES_ENABLED;

    const response = await localNotesRouteGet(
      new Request("http://localhost/api/integrations/local-notes?q=travel", {
        method: "GET",
        headers: buildAuthorizedHeaders()
      })
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(403);
    expect(payload.error).toContain("Local notes are disabled in production");
    expect(payload.error).not.toContain(process.env.AGENTIC_NOTES_PATH!);
    expectNoStoreHeaders(response);
  });

  it("fails closed when production local notes are outside the allowed root", async () => {
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "agentic-local-notes-outside-"));

    process.env.NODE_ENV = "production";
    process.env.AGENTIC_LOCAL_NOTES_ENABLED = "true";
    process.env.AGENTIC_NOTES_PATH = path.join(outsideRoot, "notes");

    const response = await localNotesRoutePost(
      new Request("http://localhost/api/integrations/local-notes", {
        method: "POST",
        headers: buildAuthorizedHeaders(),
        body: JSON.stringify({
          title: "Outside root",
          content: "This should not be written."
        })
      })
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(403);
    expect(payload.error).toContain("Local notes are disabled in production");
    expect(payload.error).not.toContain(outsideRoot);
    expectNoStoreHeaders(response);
  });
});
