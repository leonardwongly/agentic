import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_OWNER_USER_ID } from "@agentic/contracts";
import { POST as goalsCreateRoute } from "../apps/web/app/api/goals/route";
import { GET as calibrationRoute } from "../apps/web/app/api/calibration/route";
import { POST as memoryCreateRoute } from "../apps/web/app/api/memory/route";
import { PATCH as memoryUpdateRoute } from "../apps/web/app/api/memory/[id]/route";
import { POST as workspacesRoute } from "../apps/web/app/api/workspaces/route";
import {
  AGENTIC_ACCESS_KEY_HEADER,
  AGENTIC_SESSION_COOKIE,
  buildSessionToken
} from "../apps/web/lib/auth";
import {
  resetAuthSessionStateStoreForTesting,
  setAuthSessionStateStoreForTesting,
  type AuthSessionStateStore
} from "../apps/web/lib/auth-session-store";
import { expectNoStoreHeaders } from "./route-test-helpers";

/**
 * Adversarial coverage for Next.js route handlers invoked fully in-process
 * (Request -> Response). This file deliberately targets hostile *request shapes*
 * that the dense happy-path route suites and tests/api-validation.test.ts do not
 * assert. Documented gaps NOT re-covered here (already asserted elsewhere):
 *  - malformed JSON body (`{`) and non-JSON content types -> api-validation.test.ts
 *  - unknown/nested extra fields -> api-validation.test.ts
 *  - unsupported query fields + out-of-range limits -> calibration-route.test.ts
 *  - cross-owner 404 disclosure -> share-route / memory-route / route-user-scope tests
 * What is genuinely new here: valid-JSON *non-object* bodies, duplicated query
 * params, hostile dynamic path params (traversal / %00 / overlong / control
 * chars), authentication-header edge shapes, cookie spoofing, and a strict
 * error-hygiene sweep proving 4xx bodies never leak stacks, internal paths, or
 * the configured access key.
 */

const TEST_ACCESS_KEY = "test-access-key";
const tempDirs: string[] = [];

function allowAllAuthStateStore(): AuthSessionStateStore {
  // Neutralise the shared abuse/session limiter so hostile-input probes reach
  // the validation & parameter-parsing logic deterministically (no 429 noise).
  return {
    scope: "process-local",
    async checkRateLimit() {
      return { allowed: true, retryAfterMs: 0 };
    },
    async clearRateLimit() {},
    async revokeSession() {},
    async isSessionRevoked() {
      return false;
    },
    async reset() {}
  };
}

function jsonHostileRequest(url: string, rawBody: string, method = "POST"): Request {
  return new Request(url, {
    method,
    headers: {
      "content-type": "application/json",
      [AGENTIC_ACCESS_KEY_HEADER]: TEST_ACCESS_KEY
    },
    body: rawBody
  });
}

/** 4xx/5xx bodies must be a single structured `{ error }` and never leak internals. */
async function expectCleanErrorResponse(response: Response) {
  expect(response.status).toBeGreaterThanOrEqual(400);
  const text = await response.text();

  // Must be parseable JSON (structured, not a stack dump / HTML error page).
  let payload: unknown;

  expect(() => {
    payload = JSON.parse(text);
  }).not.toThrow();

  expect(payload).toBeTypeOf("object");
  expect(payload).toHaveProperty("error");
  expect(Object.keys(payload as Record<string, unknown>)).toEqual(["error"]);

  // Error hygiene: no stack frames, source files, internal absolute paths, or secrets.
  const lowered = text.toLowerCase();
  expect(/\bat [A-Za-z_$][\w$]*\s+\(|at async |at module \(|\.ts:\d+:\d+/.test(lowered)).toBe(false);
  expect(lowered).not.toContain("stack trace");
  expect(lowered).not.toContain("node:");
  expect(lowered).not.toContain("/users/");
  expect(lowered).not.toContain("/app/api/");
  expect(lowered).not.toContain("zoderror");
  expect(lowered).not.toContain(TEST_ACCESS_KEY.toLowerCase());
  expect(text.length).toBeLessThan(2_000);
}

describe("adversarial route handlers: hostile requests", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = TEST_ACCESS_KEY;
    process.env.NODE_ENV = "test";

    const dir = await mkdtemp(path.join(process.cwd(), "build", "adversarial-routes-"));
    tempDirs.push(dir);
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(dir, "runtime-store.json");

    Reflect.set(globalThis, "__agenticRepository", undefined);
    Reflect.set(globalThis, "__agenticSelfImprovementRepository", undefined);
    setAuthSessionStateStoreForTesting(allowAllAuthStateStore());
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    process.env.NODE_ENV = originalNodeEnv;
    Reflect.set(globalThis, "__agenticRepository", undefined);
    Reflect.set(globalThis, "__agenticSelfImprovementRepository", undefined);
    resetAuthSessionStateStoreForTesting();
  });

  afterAll(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  describe("valid-JSON non-object bodies", () => {
    // Existing suites only feed malformed JSON (`{`) or object bodies with extra
    // keys. A syntactically valid JSON scalar/array where an object is required is
    // a distinct attack path into `.strict()` and discriminated-union schemas.
    const hostileBodies: Array<[string, string]> = [
      ["array of objects", `[{"request":"x"},{"request":"y"}]`],
      ["bare array", "[]"],
      ["JSON string", "\"just a string\""],
      ["JSON number", "42"],
      ["JSON boolean", "true"],
      ["JSON null", "null"]
    ];

    it.each(hostileBodies)("rejects a %s body with a structured 400 (no 5xx)", async (_label, rawBody) => {
      const response = await memoryCreateRoute(
        jsonHostileRequest("http://localhost/api/memory", rawBody)
      );

      expect(response.status).toBe(400);
      await expectCleanErrorResponse(response);
      expectNoStoreHeaders(response);
    });

    it("rejects non-object bodies for goals without enqueuing anything", async () => {
      const response = await goalsCreateRoute(
        jsonHostileRequest("http://localhost/api/goals", "[\"plan my week\"]")
      );

      expect(response.status).toBe(400);
      await expectCleanErrorResponse(response);
    });

    it("rejects non-object bodies for the workspaces discriminated union", async () => {
      const response = await workspacesRoute(
        jsonHostileRequest("http://localhost/api/workspaces", "123")
      );

      expect(response.status).toBe(400);
      await expectCleanErrorResponse(response);
    });
  });

  describe("hostile dynamic path params", () => {
    // Route tests pass well-formed ids. These probe whether attacker-controlled
    // path segments can push a handler into a 500 or leak an internal message.
    const hostilePathIds: Array<[string, string]> = [
      ["encoded traversal", "bar%2F%2E%2E"],
      ["literal traversal", "../../etc/passwd"],
      ["null byte", "mem\u0000-1"],
      ["newlines + control chars", "mem\r\n id\u0001"],
      ["sql-ish", "mem' OR '1'='1"],
      ["overlong (>200)", "m".repeat(400)]
    ];

    it.each(hostilePathIds)("never 5xx and stays structured for %s", async (_label, hostileId) => {
      const url = `http://localhost/api/memory/${encodeURIComponent(hostileId)}`;
      const response = await memoryUpdateRoute(
        jsonHostileRequest(url, JSON.stringify({ action: "review" }), "PATCH"),
        { params: Promise.resolve({ id: hostileId }) }
      );

      // Overlong ids are rejected by the bounded schema (400); everything else must
      // be a clean not-found (404). Neither may become a 500 or leak internals.
      expect([400, 404]).toContain(response.status);
      await expectCleanErrorResponse(response);
      expectNoStoreHeaders(response);
    });
  });

  describe("duplicated & hostile query params", () => {
    // calibration-route.test.ts covers unknown fields and out-of-range limits but
    // never duplicated keys. `Object.fromEntries(searchParams.entries())` collapses
    // duplicates last-wins; this pins the behaviour so a split-brain parser cannot
    // silently drift, and confirms no 5xx.
    it("collapses a duplicated in-range limit deterministically (last wins)", async () => {
      const response = await calibrationRoute(
        new Request("http://localhost/api/calibration?limit=999&limit=5", {
          headers: { [AGENTIC_ACCESS_KEY_HEADER]: TEST_ACCESS_KEY }
        })
      );

      // The first (out-of-range) value must not win; last-wins keeps it valid => 200.
      expect(response.status).toBe(200);
    });

    it("returns a structured 400 when the surviving duplicate is invalid", async () => {
      const response = await calibrationRoute(
        new Request("http://localhost/api/calibration?limit=1&limit=999", {
          headers: { [AGENTIC_ACCESS_KEY_HEADER]: TEST_ACCESS_KEY }
        })
      );

      expect(response.status).toBe(400);
      await expectCleanErrorResponse(response);
    });

    it("rejects an overlong query value without echoing it back", async () => {
      const giant = "a".repeat(4_000);
      const response = await calibrationRoute(
        new Request(`http://localhost/api/calibration?agentId=${giant}`, {
          headers: { [AGENTIC_ACCESS_KEY_HEADER]: TEST_ACCESS_KEY }
        })
      );

      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).not.toContain(giant);
    });
  });

  describe("authentication header shapes", () => {
    // api-validation and auth.test.ts cover the happy key path and malformed JSON
    // but not the empty-header / blank-bearer distinction at the route boundary.
    it("treats an empty access-key header as unauthenticated (401, not 500)", async () => {
      const response = await memoryCreateRoute(
        new Request("http://localhost/api/memory", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [AGENTIC_ACCESS_KEY_HEADER]: ""
          },
          body: JSON.stringify({ category: "style", content: "x" })
        })
      );

      expect(response.status).toBe(401);
      await expectCleanErrorResponse(response);
    });

    it("rejects a bearer header with no credential", async () => {
      const response = await goalsCreateRoute(
        new Request("http://localhost/api/goals", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer "
          },
          body: JSON.stringify({ request: "Plan my week" })
        })
      );

      expect(response.status).toBe(401);
      await expectCleanErrorResponse(response);
    });

    it("does not let a spoofed leading duplicate session cookie override auth", async () => {
      // Attacker injects a garbage `agentic_session` BEFORE the real one. The parser
      // must fail closed on the first match rather than concatenate/guess.
      const response = await memoryCreateRoute(
        new Request("http://localhost/api/memory", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: `${AGENTIC_SESSION_COOKIE}=garbage; ${AGENTIC_SESSION_COOKIE}=${buildSessionToken(DEFAULT_OWNER_USER_ID)}`
          },
          body: JSON.stringify({ category: "style", content: "x" })
        })
      );

      expect(response.status).toBe(401);
      await expectCleanErrorResponse(response);
    });
  });
});
