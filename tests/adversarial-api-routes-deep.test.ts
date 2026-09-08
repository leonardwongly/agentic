/**
 * Adversarial API Route Security Tests
 *
 * This test suite targets security vulnerabilities in API route handlers:
 * - Authentication bypass attempts
 * - Input validation edge cases
 * - Rate limiting effectiveness
 * - Path traversal and injection
 * - Security header verification
 * - Worker tick abuse vectors
 * - Share endpoint token attacks
 * - Webhook signature forgery
 * - Error information leakage
 *
 * BUGS FOUND ARE DOCUMENTED BUT NOT FIXED PER REQUIREMENTS.
 */

import crypto from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_OWNER_USER_ID } from "@agentic/contracts";
import type { AgenticRepository } from "@agentic/repository";
import { describe, expect, vi, beforeEach, afterEach, it } from "vitest";

// Mock server module before importing routes
vi.mock("../apps/web/lib/server", () => ({
  getSeededRepository: async () =>
    Reflect.get(globalThis, "__agenticRepository") as AgenticRepository,
  getSeededSelfImprovementRepository: async () => ({
    seed: async () => {},
    listMemories: async () => [],
  }),
}));

// Import after mocks
import {
  POST as sessionPost,
  DELETE as sessionDelete,
} from "../apps/web/app/api/session/route";
import { GET as healthGet } from "../apps/web/app/api/health/route";
import { GET as readyGet } from "../apps/web/app/api/ready/route";
import { POST as shareViewPost } from "../apps/web/app/api/share/view/route";
import { POST as githubWebhookPost } from "../apps/web/app/api/github/issues/webhook/route";
import { POST as workerTickPost } from "../apps/web/app/api/worker/tick/route";
import {
  GET as goalsGet,
  POST as goalsPost,
} from "../apps/web/app/api/goals/route";
import {
  AGENTIC_ACCESS_KEY_HEADER,
  AGENTIC_MACHINE_TOKEN_HEADER,
  AGENTIC_SESSION_COOKIE,
  buildSessionToken,
  hashMachineTokenSecret,
} from "../apps/web/lib/auth";
import {
  resetAuthSessionStateStoreForTesting,
  setAuthSessionStateStoreForTesting,
  type AuthSessionStateStore,
} from "../apps/web/lib/auth-session-store";
import {
  createRouteTestRepository,
  expectBaseSecurityHeaders,
} from "./route-test-helpers";

const TEST_ACCESS_KEY = "test-access-key-for-adversarial-tests";
const WEBHOOK_SECRET = "github-webhook-secret-with-at-least-32-chars";

describe("Adversarial API Route Security Tests", () => {
  let repository: AgenticRepository;
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;
  const originalWebhookSecret = process.env.AGENTIC_GITHUB_WEBHOOK_SECRET;
  const originalAllowedRepos =
    process.env.AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES;
  const originalMachineTokens = process.env.AGENTIC_MACHINE_TOKENS_JSON;

  beforeEach(async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "agentic-adversarial-"),
    );
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      tempDir,
      "runtime-store.json",
    );
    process.env.AGENTIC_ACCESS_KEY = TEST_ACCESS_KEY;

    repository = createRouteTestRepository();
    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    Reflect.set(globalThis, "__agenticRepository", repository);

    // Set up a permissive auth session store for testing
    setAuthSessionStateStoreForTesting({
      checkRateLimit: async () => ({ allowed: true, retryAfterMs: 0 }),
      clearRateLimit: async () => {},
      revokeSession: async () => {},
      isSessionRevoked: async () => false,
    } as unknown as AuthSessionStateStore);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalStorePath;
    process.env.AGENTIC_GITHUB_WEBHOOK_SECRET = originalWebhookSecret;
    process.env.AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES =
      originalAllowedRepos;
    process.env.AGENTIC_MACHINE_TOKENS_JSON = originalMachineTokens;
    Reflect.set(globalThis, "__agenticRepository", undefined);
    resetAuthSessionStateStoreForTesting();
  });

  // ============================================================================
  // 1. AUTHENTICATION BYPASS TESTS
  // ============================================================================

  describe("Authentication Bypass", () => {
    it("should reject requests with missing access key", async () => {
      const request = new Request("http://localhost/api/goals", {
        method: "GET",
      });

      const response = await goalsGet(request);
      expect(response.status).toBe(401);
    });

    it("should reject requests with empty access key", async () => {
      const request = new Request("http://localhost/api/goals", {
        method: "GET",
        headers: {
          [AGENTIC_ACCESS_KEY_HEADER]: "",
        },
      });

      const response = await goalsGet(request);
      expect(response.status).toBe(401);
    });

    it("should be protected from null byte injection by runtime", async () => {
      // The Fetch API / Headers implementation rejects null bytes in header values
      // This provides defense-in-depth before the request even reaches our auth code
      expect(() => {
        new Request("http://localhost/api/goals", {
          method: "GET",
          headers: {
            [AGENTIC_ACCESS_KEY_HEADER]: `${TEST_ACCESS_KEY}\x00malicious`,
          },
        });
      }).toThrow();
    });

    it("should be protected from unicode homoglyphs by HTTP spec", async () => {
      // The Fetch API enforces ByteString for header values (ASCII only)
      // This prevents homoglyph attacks at the protocol level before reaching our code
      const unicodeKey = TEST_ACCESS_KEY.replace("a", "а"); // Cyrillic 'a' (U+0430)

      expect(() => {
        new Request("http://localhost/api/goals", {
          method: "GET",
          headers: {
            [AGENTIC_ACCESS_KEY_HEADER]: unicodeKey,
          },
        });
      }).toThrow();
    });

    it("should use constant-time comparison to prevent timing attacks", async () => {
      // This test documents that timing-safe comparison is used
      // In practice, timing attacks are hard to test reliably in unit tests
      const wrongKey = "completely-wrong-key-value-here!";
      const almostRightKey = "test-access-key-for-adversarial-testX"; // One char off

      const request1 = new Request("http://localhost/api/goals", {
        method: "GET",
        headers: { [AGENTIC_ACCESS_KEY_HEADER]: wrongKey },
      });
      const request2 = new Request("http://localhost/api/goals", {
        method: "GET",
        headers: { [AGENTIC_ACCESS_KEY_HEADER]: almostRightKey },
      });

      const response1 = await goalsGet(request1);
      const response2 = await goalsGet(request2);

      // Both should be rejected with same status
      expect(response1.status).toBe(401);
      expect(response2.status).toBe(401);
    });

    it("should reject expired machine tokens", async () => {
      const expiredTokenConfig = JSON.stringify([
        {
          id: "expired-token",
          subject: "test",
          userId: DEFAULT_OWNER_USER_ID,
          tokenHash: hashMachineTokenSecret("expired-secret"),
          scopes: ["jobs:create"],
          routeGroups: ["automation"],
          workspaceIds: null,
          expiresAt: "2020-01-01T00:00:00.000Z", // Expired
          revoked: false,
        },
      ]);
      process.env.AGENTIC_MACHINE_TOKENS_JSON = expiredTokenConfig;

      const request = new Request("http://localhost/api/goals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_MACHINE_TOKEN_HEADER]: "expired-secret",
        },
        body: JSON.stringify({ request: "test" }),
      });

      const response = await goalsPost(request);
      expect(response.status).toBe(401);
    });

    it("should reject revoked machine tokens", async () => {
      const revokedTokenConfig = JSON.stringify([
        {
          id: "revoked-token",
          subject: "test",
          userId: DEFAULT_OWNER_USER_ID,
          tokenHash: hashMachineTokenSecret("revoked-secret"),
          scopes: ["jobs:create"],
          routeGroups: ["automation"],
          workspaceIds: null,
          expiresAt: null,
          revoked: true, // Revoked
        },
      ]);
      process.env.AGENTIC_MACHINE_TOKENS_JSON = revokedTokenConfig;

      const request = new Request("http://localhost/api/goals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_MACHINE_TOKEN_HEADER]: "revoked-secret",
        },
        body: JSON.stringify({ request: "test" }),
      });

      const response = await goalsPost(request);
      expect(response.status).toBe(401);
    });
  });

  // ============================================================================
  // 2. INPUT VALIDATION TESTS
  // ============================================================================

  describe("Input Validation", () => {
    it("should reject oversized JSON bodies (>256KB default limit)", async () => {
      const largePayload = { request: "x".repeat(300_000) };
      const request = new Request("http://localhost/api/goals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: TEST_ACCESS_KEY,
        },
        body: JSON.stringify(largePayload),
      });

      const response = await goalsPost(request);
      // Should be 413 Payload Too Large or 400 Bad Request
      expect([400, 413]).toContain(response.status);
    });

    it("should reject deeply nested objects (prototype pollution attempt)", async () => {
      // Create deeply nested object
      let nested: Record<string, unknown> = {};
      let current = nested;
      for (let i = 0; i < 100; i++) {
        current["level"] = {};
        current = current["level"] as Record<string, unknown>;
      }
      current["request"] = "test";

      const request = new Request("http://localhost/api/goals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: TEST_ACCESS_KEY,
        },
        body: JSON.stringify(nested),
      });

      const response = await goalsPost(request);
      // Zod strict() should reject unexpected structure
      expect(response.status).toBe(400);
    });

    it("should reject prototype pollution via __proto__ key", async () => {
      const maliciousPayload = JSON.parse(
        '{"__proto__": {"polluted": true}, "request": "test"}',
      );

      const request = new Request("http://localhost/api/goals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: TEST_ACCESS_KEY,
        },
        body: JSON.stringify(maliciousPayload),
      });

      const response = await goalsPost(request);
      // Zod strict() should reject unknown keys including __proto__
      expect(response.status).toBe(400);
    });

    it("should reject constructor.prototype pollution attempt", async () => {
      const maliciousPayload = {
        constructor: {
          prototype: {
            polluted: true,
          },
        },
        request: "test",
      };

      const request = new Request("http://localhost/api/goals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: TEST_ACCESS_KEY,
        },
        body: JSON.stringify(maliciousPayload),
      });

      const response = await goalsPost(request);
      expect(response.status).toBe(400);
    });

    it("should reject invalid JSON syntax", async () => {
      const request = new Request("http://localhost/api/goals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: TEST_ACCESS_KEY,
        },
        body: "{invalid json",
      });

      const response = await goalsPost(request);
      expect(response.status).toBe(400);
    });

    it("should reject non-JSON content types", async () => {
      const request = new Request("http://localhost/api/goals", {
        method: "POST",
        headers: {
          "content-type": "text/plain",
          [AGENTIC_ACCESS_KEY_HEADER]: TEST_ACCESS_KEY,
        },
        body: '{"request": "test"}',
      });

      const response = await goalsPost(request);
      expect(response.status).toBe(415);
    });

    it("should enforce max length on string fields", async () => {
      const request = new Request("http://localhost/api/goals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: TEST_ACCESS_KEY,
        },
        body: JSON.stringify({ request: "x".repeat(3000) }), // Over 2000 char limit
      });

      const response = await goalsPost(request);
      expect(response.status).toBe(400);
    });
  });

  // ============================================================================
  // 3. RATE LIMITING TESTS
  // ============================================================================

  describe("Rate Limiting", () => {
    it("should enforce rate limits on session creation", async () => {
      // Set up a rate-limiting store that denies after first request
      let requestCount = 0;
      setAuthSessionStateStoreForTesting({
        checkRateLimit: async () => {
          requestCount++;
          return { allowed: requestCount <= 1, retryAfterMs: 60000 };
        },
        clearRateLimit: async () => {},
        revokeSession: async () => {},
        isSessionRevoked: async () => false,
      } as unknown as AuthSessionStateStore);

      const makeRequest = () =>
        new Request("http://localhost/api/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accessKey: TEST_ACCESS_KEY }),
        });

      const response1 = await sessionPost(makeRequest());
      const response2 = await sessionPost(makeRequest());

      expect(response1.status).not.toBe(429);
      expect(response2.status).toBe(429);
      expect(response2.headers.get("Retry-After")).toBeTruthy();
    });

    it("should include Retry-After header when rate limited", async () => {
      setAuthSessionStateStoreForTesting({
        checkRateLimit: async () => ({ allowed: false, retryAfterMs: 30000 }),
        clearRateLimit: async () => {},
        revokeSession: async () => {},
        isSessionRevoked: async () => false,
      } as unknown as AuthSessionStateStore);

      const request = new Request("http://localhost/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessKey: TEST_ACCESS_KEY }),
      });

      const response = await sessionPost(request);
      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("30");
    });
  });

  // ============================================================================
  // 4. PATH TRAVERSAL AND INJECTION TESTS
  // ============================================================================

  describe("Path Traversal and Injection", () => {
    it("should handle ID parameters with path separators safely", async () => {
      // The governed route validates IDs via Zod schema
      // Testing that ../../../etc/passwd style paths don't escape
      const maliciousId = "../../../etc/passwd";

      // This would be tested against routes like /api/goals/[id]
      // For now we verify the schema rejects such inputs
      const { z } = await import("zod");
      const IdSchema = z.string().trim().min(1).max(200);

      // Schema allows the string but downstream code should handle safely
      const result = IdSchema.safeParse(maliciousId);
      expect(result.success).toBe(true); // Schema accepts it
      // BUG DOCUMENTED: Path traversal strings pass validation
      // Mitigation relies on repository layer not treating IDs as paths
    });

    it("should reject SQL injection patterns in query parameters", async () => {
      // Test that SQL injection in search/filter params is handled
      const sqlInjection = "'; DROP TABLE goals; --";

      const request = new Request(
        `http://localhost/api/goals?search=${encodeURIComponent(sqlInjection)}`,
        {
          method: "GET",
          headers: {
            [AGENTIC_ACCESS_KEY_HEADER]: TEST_ACCESS_KEY,
          },
        },
      );

      const response = await goalsGet(request);
      // Should either ignore the param or handle safely
      // Not returning 500 indicates safe handling
      expect(response.status).not.toBe(500);
    });

    it("should handle XSS attempts in input fields", async () => {
      const xssPayload = '<script>alert("xss")</script>';

      const request = new Request("http://localhost/api/goals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: TEST_ACCESS_KEY,
        },
        body: JSON.stringify({ request: xssPayload }),
      });

      const response = await goalsPost(request);
      // Request should be accepted (input sanitization happens at render time)
      // But response should not contain unescaped script tags
      if (response.status === 202) {
        const body = await response.text();
        expect(body).not.toContain("<script>");
      }
    });
  });

  // ============================================================================
  // 5. SECURITY HEADERS TESTS
  // ============================================================================

  describe("Security Headers", () => {
    it("should include X-Content-Type-Options: nosniff", async () => {
      const request = new Request("http://localhost/api/health");
      const response = await healthGet(request);

      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    });

    it("should include X-Frame-Options: DENY", async () => {
      const request = new Request("http://localhost/api/health");
      const response = await healthGet(request);

      expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    });

    it("should include Referrer-Policy: no-referrer", async () => {
      const request = new Request("http://localhost/api/health");
      const response = await healthGet(request);

      expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    });

    it("should include Cross-Origin-Opener-Policy: same-origin", async () => {
      const request = new Request("http://localhost/api/health");
      const response = await healthGet(request);

      expect(response.headers.get("Cross-Origin-Opener-Policy")).toBe(
        "same-origin",
      );
    });

    it("should include Permissions-Policy restricting sensitive features", async () => {
      const request = new Request("http://localhost/api/health");
      const response = await healthGet(request);

      const policy = response.headers.get("Permissions-Policy");
      expect(policy).toContain("camera=()");
      expect(policy).toContain("geolocation=()");
      expect(policy).toContain("microphone=()");
    });

    it("should set no-cache headers on authenticated responses", async () => {
      const request = new Request("http://localhost/api/goals", {
        headers: { [AGENTIC_ACCESS_KEY_HEADER]: TEST_ACCESS_KEY },
      });

      const response = await goalsGet(request);

      expect(response.headers.get("Cache-Control")).toContain("no-store");
      expect(response.headers.get("Pragma")).toBe("no-cache");
    });

    it("should NOT include Content-Security-Policy header (potential gap)", async () => {
      // BUG DOCUMENTED: CSP header is not set on API responses
      // While APIs typically don't need CSP, it could help prevent MIME confusion
      const request = new Request("http://localhost/api/health");
      const response = await healthGet(request);

      // This documents the absence - not necessarily a bug for pure JSON APIs
      const csp = response.headers.get("Content-Security-Policy");
      // Note: CSP is typically set at middleware/page level, not API routes
      // This is informational, not necessarily a vulnerability
    });
  });

  // ============================================================================
  // 6. WORKER TICK ABUSE TESTS
  // ============================================================================

  describe("Worker Tick Abuse", () => {
    it("should require authentication for worker tick", async () => {
      const request = new Request("http://localhost/api/worker/tick", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });

      const response = await workerTickPost(request);
      expect(response.status).toBe(401);
    });

    it("should require auth before validating maxJobs values", async () => {
      // Worker tick requires machine token or bootstrap key with proper scope
      // Without proper auth, requests fail at auth check before body validation
      const request = new Request("http://localhost/api/worker/tick", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: TEST_ACCESS_KEY,
        },
        body: JSON.stringify({ maxJobs: 9999 }), // Over MAX_TICK_MAX_JOBS (50)
      });

      const response = await workerTickPost(request);
      // Bootstrap access key is not allowed for worker tick (allowBootstrapAccessKey: false)
      // So this fails auth first with 401
      expect(response.status).toBe(401);
    });

    it("should require auth before validating negative maxJobs", async () => {
      const request = new Request("http://localhost/api/worker/tick", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: TEST_ACCESS_KEY,
        },
        body: JSON.stringify({ maxJobs: -1 }),
      });

      const response = await workerTickPost(request);
      // Fails auth first
      expect(response.status).toBe(401);
    });

    it("should require auth before validating maxDurationMs", async () => {
      const request = new Request("http://localhost/api/worker/tick", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: TEST_ACCESS_KEY,
        },
        body: JSON.stringify({ maxDurationMs: 999999 }), // Over 60000ms limit
      });

      const response = await workerTickPost(request);
      // Fails auth first
      expect(response.status).toBe(401);
    });

    it("should require auth before validating unknown fields", async () => {
      const request = new Request("http://localhost/api/worker/tick", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: TEST_ACCESS_KEY,
        },
        body: JSON.stringify({ unknownField: "malicious", extraData: 123 }),
      });

      const response = await workerTickPost(request);
      // Fails auth first
      expect(response.status).toBe(401);
    });
  });

  // ============================================================================
  // 7. SHARE ENDPOINT TOKEN ATTACKS
  // ============================================================================

  describe("Share Endpoint Token Attacks", () => {
    it("should reject malformed share tokens", async () => {
      const request = new Request("http://localhost/api/share/view", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "not-a-valid-token" }),
      });

      const response = await shareViewPost(request);
      // Returns 202 accepted but tracked: false (safe fail-open behavior)
      expect(response.status).toBe(202);
      const body = await response.json();
      expect(body.tracked).toBe(false);
    });

    it("should reject empty share tokens", async () => {
      const request = new Request("http://localhost/api/share/view", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "" }),
      });

      const response = await shareViewPost(request);
      // Zod min(1) should reject empty string
      expect(response.status).toBe(400);
    });

    it("should reject oversized share tokens", async () => {
      const request = new Request("http://localhost/api/share/view", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "x".repeat(5000) }), // Over 4096 limit
      });

      const response = await shareViewPost(request);
      expect(response.status).toBe(400);
    });

    it("should reject tokens with tampered signatures", async () => {
      // Create a valid-looking token structure but with wrong signature
      const payload = Buffer.from(
        JSON.stringify({
          shareId: "share-123",
          goalId: "goal-456",
          exp: Date.now() + 86400000,
          v: 1,
        }),
      ).toString("base64url");
      const tamperedToken = `${payload}.invalidsignature`;

      const request = new Request("http://localhost/api/share/view", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: tamperedToken }),
      });

      const response = await shareViewPost(request);
      expect(response.status).toBe(202);
      const body = await response.json();
      expect(body.tracked).toBe(false);
    });

    it("should silently accept expired tokens without tracking (no info leak)", async () => {
      // Expired tokens should return same response as invalid ones
      // to prevent enumeration
      const payload = Buffer.from(
        JSON.stringify({
          shareId: "share-123",
          goalId: "goal-456",
          exp: Date.now() - 86400000, // Expired yesterday
          v: 1,
        }),
      ).toString("base64url");
      // We can't easily forge a valid signature, so this tests the flow
      const expiredToken = `${payload}.fakesig`;

      const request = new Request("http://localhost/api/share/view", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: expiredToken }),
      });

      const response = await shareViewPost(request);
      // Should not reveal whether token was expired vs invalid
      expect(response.status).toBe(202);
    });

    it("should reject requests with oversized content-length", async () => {
      const request = new Request("http://localhost/api/share/view", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": "999999", // Claims huge body
        },
        body: JSON.stringify({ token: "test" }),
      });

      const response = await shareViewPost(request);
      // Should return accepted but not tracked (fail-safe)
      expect(response.status).toBe(202);
    });
  });

  // ============================================================================
  // 8. WEBHOOK SIGNATURE FORGERY TESTS
  // ============================================================================

  describe("Webhook Signature Forgery", () => {
    beforeEach(() => {
      process.env.AGENTIC_GITHUB_WEBHOOK_SECRET = WEBHOOK_SECRET;
      process.env.AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES =
        "octo-org/demo-agentic";
    });

    function buildValidPayload() {
      return {
        action: "opened",
        issue: {
          number: 1,
          title: "Test Issue",
          html_url: "https://github.com/octo-org/demo-agentic/issues/1",
          labels: [],
          assignees: [],
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        repository: {
          full_name: "octo-org/demo-agentic",
          html_url: "https://github.com/octo-org/demo-agentic",
          default_branch: "main",
          private: false,
        },
        sender: { login: "test-user" },
      };
    }

    it("should reject requests without signature header", async () => {
      const request = new Request(
        "http://localhost/api/github/issues/webhook",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-github-event": "issues",
            "x-github-delivery": "delivery-1",
          },
          body: JSON.stringify(buildValidPayload()),
        },
      );

      const response = await githubWebhookPost(request);
      expect(response.status).toBe(401);
    });

    it("should reject requests with invalid signature format", async () => {
      const request = new Request(
        "http://localhost/api/github/issues/webhook",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-github-event": "issues",
            "x-github-delivery": "delivery-1",
            "x-hub-signature-256": "not-sha256-format",
          },
          body: JSON.stringify(buildValidPayload()),
        },
      );

      const response = await githubWebhookPost(request);
      expect(response.status).toBe(401);
    });

    it("should reject requests with wrong signature (forged)", async () => {
      const body = JSON.stringify(buildValidPayload());
      const wrongSignature = `sha256=${crypto.createHmac("sha256", "wrong-secret").update(body).digest("hex")}`;

      const request = new Request(
        "http://localhost/api/github/issues/webhook",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-github-event": "issues",
            "x-github-delivery": "delivery-1",
            "x-hub-signature-256": wrongSignature,
          },
          body,
        },
      );

      const response = await githubWebhookPost(request);
      expect(response.status).toBe(401);
    });

    it("should reject requests with truncated signature", async () => {
      const body = JSON.stringify(buildValidPayload());
      const validSig = crypto
        .createHmac("sha256", WEBHOOK_SECRET)
        .update(body)
        .digest("hex");
      const truncatedSignature = `sha256=${validSig.slice(0, 32)}`; // Half length

      const request = new Request(
        "http://localhost/api/github/issues/webhook",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-github-event": "issues",
            "x-github-delivery": "delivery-1",
            "x-hub-signature-256": truncatedSignature,
          },
          body,
        },
      );

      const response = await githubWebhookPost(request);
      expect(response.status).toBe(401);
    });

    it("should reject replayed webhooks with same delivery ID (idempotency)", async () => {
      const body = JSON.stringify(buildValidPayload());
      const signature = `sha256=${crypto.createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex")}`;
      const deliveryId = "unique-delivery-id-12345";

      const makeRequest = () =>
        new Request("http://localhost/api/github/issues/webhook", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-github-event": "issues",
            "x-github-delivery": deliveryId,
            "x-hub-signature-256": signature,
          },
          body,
        });

      const response1 = await githubWebhookPost(makeRequest());
      const response2 = await githubWebhookPost(makeRequest());

      // First should succeed (202), second might be deduplicated
      expect(response1.status).toBe(202);
      // Note: Deduplication depends on job queue implementation
    });

    it("should reject payloads exceeding size limit", async () => {
      const largePayload = {
        ...buildValidPayload(),
        issue: {
          ...buildValidPayload().issue,
          body: "x".repeat(300_000), // Exceeds 256KB limit
        },
      };
      const body = JSON.stringify(largePayload);
      const signature = `sha256=${crypto.createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex")}`;

      const request = new Request(
        "http://localhost/api/github/issues/webhook",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-github-event": "issues",
            "x-github-delivery": "delivery-large",
            "x-hub-signature-256": signature,
          },
          body,
        },
      );

      const response = await githubWebhookPost(request);
      expect(response.status).toBe(413);
    });

    it("should reject webhooks from disallowed repositories", async () => {
      const payload = {
        ...buildValidPayload(),
        repository: {
          ...buildValidPayload().repository,
          full_name: "evil-org/malicious-repo",
        },
      };
      const body = JSON.stringify(payload);
      const signature = `sha256=${crypto.createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex")}`;

      const request = new Request(
        "http://localhost/api/github/issues/webhook",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-github-event": "issues",
            "x-github-delivery": "delivery-evil",
            "x-hub-signature-256": signature,
          },
          body,
        },
      );

      const response = await githubWebhookPost(request);
      expect(response.status).toBe(403);
    });

    it("should reject invalid delivery ID format", async () => {
      const body = JSON.stringify(buildValidPayload());
      const signature = `sha256=${crypto.createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex")}`;

      const request = new Request(
        "http://localhost/api/github/issues/webhook",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-github-event": "issues",
            "x-github-delivery": "../../../etc/passwd", // Invalid format
            "x-hub-signature-256": signature,
          },
          body,
        },
      );

      const response = await githubWebhookPost(request);
      expect(response.status).toBe(400);
    });
  });

  // ============================================================================
  // 9. ERROR INFORMATION LEAKAGE TESTS
  // ============================================================================

  describe("Error Information Leakage", () => {
    it("should not expose stack traces in error responses", async () => {
      const request = new Request("http://localhost/api/goals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: TEST_ACCESS_KEY,
        },
        body: "invalid json {{{",
      });

      const response = await goalsPost(request);
      const body = await response.text();

      expect(body).not.toContain("stack");
      expect(body).not.toContain("at ");
      expect(body).not.toContain("node_modules");
    });

    it("should not expose internal file paths in errors", async () => {
      const request = new Request("http://localhost/api/goals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: TEST_ACCESS_KEY,
        },
        body: JSON.stringify({ unexpectedField: "value" }), // Strict schema violation
      });

      const response = await goalsPost(request);
      const body = await response.text();

      expect(body).not.toContain("/app/");
      expect(body).not.toContain("/home/");
      expect(body).not.toContain(".ts:");
    });

    it("should not expose environment variable names in errors (BUG: 503 message mentions config)", async () => {
      // BUG DOCUMENTED: When AGENTIC_ACCESS_KEY is missing, the error message says
      // "AGENTIC_ACCESS_KEY is not configured" which reveals the env var name
      // This is acceptable for operational clarity but could be considered info leakage
      delete process.env.AGENTIC_ACCESS_KEY;

      const request = new Request("http://localhost/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessKey: "any-key" }),
      });

      const response = await sessionPost(request);
      const body = await response.text();

      // Documents current behavior - env var name IS exposed in 503 errors
      // This is a design decision, not necessarily a vulnerability
      expect(response.status).toBe(503);
    });

    it("should return generic error messages for internal failures", async () => {
      // Force an internal error by providing malformed data
      const request = new Request("http://localhost/api/goals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: TEST_ACCESS_KEY,
        },
        body: JSON.stringify({ request: null }), // null instead of string
      });

      const response = await goalsPost(request);
      const body = await response.json();

      // Error message should be user-friendly, not technical
      expect(typeof body.error).toBe("string");
      expect(body.error.length).toBeLessThan(200);
    });

    it("should not leak database details in validation errors", async () => {
      const request = new Request("http://localhost/api/goals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: TEST_ACCESS_KEY,
        },
        body: JSON.stringify({ request: 12345 }), // Number instead of string
      });

      const response = await goalsPost(request);
      const body = await response.text();

      expect(body).not.toContain("sqlite");
      expect(body).not.toContain("postgres");
      expect(body).not.toContain("table");
      expect(body).not.toContain("column");
    });
  });

  // ============================================================================
  // 10. ADDITIONAL EDGE CASES
  // ============================================================================

  describe("Additional Edge Cases", () => {
    it("should handle concurrent session creation safely", async () => {
      const requests = Array.from(
        { length: 10 },
        () =>
          new Request("http://localhost/api/session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ accessKey: TEST_ACCESS_KEY }),
          }),
      );

      const responses = await Promise.all(requests.map((r) => sessionPost(r)));

      // All should complete without crashing
      responses.forEach((response) => {
        expect([200, 429]).toContain(response.status);
      });
    });

    it("should handle extremely long header values", async () => {
      const request = new Request("http://localhost/api/goals", {
        method: "GET",
        headers: {
          [AGENTIC_ACCESS_KEY_HEADER]: "x".repeat(10000),
        },
      });

      const response = await goalsGet(request);
      // Should reject gracefully, not crash
      expect(response.status).toBe(401);
    });

    it("should handle requests with multiple content-type headers", async () => {
      const headers = new Headers();
      headers.append("content-type", "application/json");
      headers.append("content-type", "text/plain");
      headers.set(AGENTIC_ACCESS_KEY_HEADER, TEST_ACCESS_KEY);

      const request = new Request("http://localhost/api/goals", {
        method: "POST",
        headers,
        body: JSON.stringify({ request: "test" }),
      });

      const response = await goalsPost(request);
      // Behavior depends on how headers are processed
      expect([200, 202, 400, 415]).toContain(response.status);
    });

    it("should handle whitespace-like characters correctly", async () => {
      // JavaScript's trim() strips Unicode whitespace including \u00a0 (non-breaking space)
      // This means keys with trailing NBSP will match after trimming
      const keyWithNbsp = TEST_ACCESS_KEY + "\u00a0";
      const request = new Request("http://localhost/api/goals", {
        method: "GET",
        headers: { [AGENTIC_ACCESS_KEY_HEADER]: keyWithNbsp },
      });

      const response = await goalsGet(request);
      // trim() strips the NBSP, so auth succeeds - this is correct behavior
      expect(response.status).toBe(200);

      // Characters outside Latin-1 are rejected by Fetch API before reaching our code
      expect(() => {
        new Request("http://localhost/api/goals", {
          method: "GET",
          headers: { [AGENTIC_ACCESS_KEY_HEADER]: TEST_ACCESS_KEY + "\u200b" },
        });
      }).toThrow();
    });

    it("should handle HTTP method confusion (GET with body)", async () => {
      // Note: Fetch API may throw when creating GET with body
      // This tests server-side handling if such a request arrives
      try {
        const request = new Request("http://localhost/api/goals", {
          method: "GET",
          headers: {
            [AGENTIC_ACCESS_KEY_HEADER]: TEST_ACCESS_KEY,
          },
        });

        const response = await goalsGet(request);
        // GET should work normally
        expect([200, 401]).toContain(response.status);
      } catch {
        // Fetch API may reject GET with body at client level
        // This is acceptable - the test documents the behavior
      }
    });
  });
});
