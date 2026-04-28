import { z } from "zod";
import { SYSTEM_USER_ID } from "@agentic/contracts";
import { createGovernedMutationRoute } from "../apps/web/lib/governed-route";
import { authenticatedJson } from "../apps/web/lib/api-response";
import {
  resetAuthSessionStateStoreForTesting,
  setAuthSessionStateStoreForTesting,
  type AuthSessionStateStore
} from "../apps/web/lib/auth-session-store";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import { expectNoStoreHeaders } from "./route-test-helpers";

const TestMutationSchema = z
  .object({
    name: z.string().trim().min(1).max(20)
  })
  .strict();

function buildRoute() {
  return createGovernedMutationRoute({
    route: "api.test.governed_mutation",
    fallbackError: "Failed to run governed mutation.",
    bodySchema: TestMutationSchema,
    rateLimit: {
      namespace: "test-governed-mutation",
      error: "Too many test mutation requests."
    },
    idempotency: "optional"
  }, async ({ principal, actorContext, body, idempotencyKey }) =>
    authenticatedJson({
      userId: principal.userId,
      actorKind: actorContext.initiator.kind,
      body,
      idempotencyKey
    })
  );
}

describe("governed mutation route wrapper", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;

  beforeEach(() => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    resetAuthSessionStateStoreForTesting();
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    resetAuthSessionStateStoreForTesting();
  });

  it("composes auth, validation, actor context, idempotency-key parsing, and safe responses", async () => {
    const route = buildRoute();
    const response = await route(
      new Request("http://localhost/api/test-governed-mutation", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key",
          "x-idempotency-key": "test-governed-mutation-1"
        },
        body: JSON.stringify({
          name: "  Ada  "
        })
      }),
      undefined
    );
    const payload = (await response.json()) as {
      userId: string;
      actorKind: string;
      body: { name: string };
      idempotencyKey: string | null;
    };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      userId: SYSTEM_USER_ID,
      actorKind: "system",
      body: {
        name: "Ada"
      },
      idempotencyKey: "test-governed-mutation-1"
    });
    expectNoStoreHeaders(response);
  });

  it("rejects unauthenticated mutations before invoking the handler", async () => {
    const route = buildRoute();
    const response = await route(
      new Request("http://localhost/api/test-governed-mutation", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          name: "Ada"
        })
      }),
      undefined
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(401);
    expect(payload.error).toContain("Unauthorized");
    expectNoStoreHeaders(response);
  });

  it("returns a shared 429 response when the route abuse limit is exceeded", async () => {
    const seenKeys: string[] = [];
    const store: AuthSessionStateStore = {
      scope: "shared",
      async checkRateLimit(key) {
        seenKeys.push(key);
        return { allowed: false, retryAfterMs: 42_000 };
      },
      async clearRateLimit() {},
      async revokeSession() {},
      async isSessionRevoked() {
        return false;
      },
      async reset() {}
    };

    setAuthSessionStateStoreForTesting(store);

    const route = buildRoute();
    const response = await route(
      new Request("http://localhost/api/test-governed-mutation", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        },
        body: JSON.stringify({
          name: "Ada"
        })
      }),
      undefined
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(429);
    expect(payload.error).toBe("Too many test mutation requests.");
    expect(response.headers.get("retry-after")).toBe("42");
    expect(seenKeys).toHaveLength(1);
    expect(seenKeys[0]).toContain(`test-governed-mutation:user:${SYSTEM_USER_ID}:`);
    expectNoStoreHeaders(response);
  });
});
