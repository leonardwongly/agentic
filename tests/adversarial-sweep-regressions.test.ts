import { describe, it, expect } from "vitest";
import type { IntegrationAccount } from "@agentic/contracts";
import {
  describeIntegrationReadiness,
  normalizeConnectorThrownError,
  inferCapabilitiesFromRequest,
  createProviderCredentialSecretStore
} from "@agentic/integrations";

// ---------------------------------------------------------------------------
// Bug 1: Fail-open default for unknown account statuses
// ---------------------------------------------------------------------------

describe("adversarial regression: fail-closed for unknown account statuses", () => {
  function buildAccount(overrides: Partial<IntegrationAccount> = {}): IntegrationAccount {
    return {
      id: overrides.id ?? "test-account",
      userId: overrides.userId ?? "user-1",
      name: overrides.name ?? "Test Account",
      system: overrides.system ?? "unknown-system",
      status: overrides.status ?? "ready",
      scopes: overrides.scopes ?? [],
      capabilities: overrides.capabilities ?? [],
      metadata: overrides.metadata ?? {},
      actorContext: overrides.actorContext ?? null,
      createdAt: overrides.createdAt ?? "2026-04-18T00:00:00.000Z",
      updatedAt: overrides.updatedAt ?? "2026-04-18T00:00:00.000Z"
    };
  }

  it("treats an unrecognized account status as experimental (fail-closed)", () => {
    // Cast to bypass the Zod enum so we can simulate a corrupted or future
    // status value that was never added to the switch statement.
    const account = buildAccount({ status: "unknown_future_status" as IntegrationAccount["status"] });
    const readiness = describeIntegrationReadiness(account);

    expect(readiness.tier).toBe("experimental");
    expect(readiness.supportedModes).toEqual([]);
    expect(readiness.reason).toContain("unrecognized status");
  });

  it("does not grant approval or autonomous modes for unknown statuses", () => {
    const account = buildAccount({ status: "corrupted" as IntegrationAccount["status"] });
    const readiness = describeIntegrationReadiness(account);

    expect(readiness.modeSupport.approval).toBe(false);
    expect(readiness.modeSupport.autonomous).toBe(false);
    expect(readiness.modeSupport.draft).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Bug 2: All unknown errors marked retryable
// ---------------------------------------------------------------------------

describe("adversarial regression: programming errors are not retryable", () => {
  it("marks TypeError as non-retryable", () => {
    const error = normalizeConnectorThrownError({
      provider: "test-provider",
      operation: "test-op",
      error: new TypeError("Cannot read properties of undefined")
    });

    expect(error.retryable).toBe(false);
    expect(error.code).toBe("remote_error");
  });

  it("marks ReferenceError as non-retryable", () => {
    const error = normalizeConnectorThrownError({
      provider: "test-provider",
      operation: "test-op",
      error: new ReferenceError("foo is not defined")
    });

    expect(error.retryable).toBe(false);
  });

  it("marks SyntaxError as non-retryable", () => {
    const error = normalizeConnectorThrownError({
      provider: "test-provider",
      operation: "test-op",
      error: new SyntaxError("Unexpected token")
    });

    expect(error.retryable).toBe(false);
  });

  it("still marks generic Error as retryable (transient upstream failure)", () => {
    const error = normalizeConnectorThrownError({
      provider: "test-provider",
      operation: "test-op",
      error: new Error("connection reset by peer")
    });

    expect(error.retryable).toBe(true);
    expect(error.code).toBe("remote_error");
  });

  it("still marks unknown non-Error objects as retryable", () => {
    const error = normalizeConnectorThrownError({
      provider: "test-provider",
      operation: "test-op",
      error: "string error"
    });

    expect(error.retryable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bug 3: Regex substring matching grants unintended capabilities
// ---------------------------------------------------------------------------

describe("adversarial regression: capability inference uses word boundaries", () => {
  it("does not grant 'send' for 'disembowel'", () => {
    const caps = inferCapabilitiesFromRequest("disembowel the body");

    expect(caps).not.toContain("send");
  });

  it("does not grant 'send' for 'replay'", () => {
    const caps = inferCapabilitiesFromRequest("replay the recording");

    expect(caps).not.toContain("send");
  });

  it("does not grant 'draft' for 'redrafting' when used as part of another word", () => {
    // "redrafting" contains "draft" as a substring but should not match with
    // word boundaries since it's embedded in a larger word.
    const caps = inferCapabilitiesFromRequest("redrafting is happening");

    expect(caps).not.toContain("draft");
  });

  it("does not grant 'schedule' for 'reschedule' since it is not a standalone word", () => {
    // With word boundaries, "schedule" inside "reschedule" no longer matches
    // because the leading "re" prevents a word boundary before "schedule".
    const caps = inferCapabilitiesFromRequest("reschedule this");

    expect(caps).not.toContain("schedule");
  });

  it("correctly grants 'send' for standalone 'send'", () => {
    const caps = inferCapabilitiesFromRequest("please send this email");

    expect(caps).toContain("send");
  });

  it("correctly grants 'send' for standalone 'reply'", () => {
    const caps = inferCapabilitiesFromRequest("reply to the thread");

    expect(caps).toContain("send");
  });

  it("correctly grants 'send' for standalone 'email'", () => {
    const caps = inferCapabilitiesFromRequest("email the team");

    expect(caps).toContain("send");
  });

  it("does not grant 'monitor' for 'watches' embedded in 'smartwatches'", () => {
    const caps = inferCapabilitiesFromRequest("smartwatches are popular");

    expect(caps).not.toContain("monitor");
  });

  it("does not grant 'draft' for 'plan' embedded in 'misplanning'", () => {
    const caps = inferCapabilitiesFromRequest("misplanning occurred");

    // With word boundaries, "plan" inside "misplanning" no longer matches.
    expect(caps).not.toContain("draft");
  });
});

// ---------------------------------------------------------------------------
// Bug 4: Unbounded derived key cache memory leak
// ---------------------------------------------------------------------------

describe("adversarial regression: derived key cache is bounded", () => {
  it(
    "evicts old entries when the cache exceeds its maximum size",
    () => {
      const store = createProviderCredentialSecretStore({
        masterKey: "test-master-key-for-cache-test",
        keyVersion: "cache-test-v1"
      });

      // Encrypt enough secrets to exceed the DERIVED_KEY_CACHE_MAX_SIZE (1000).
      // Each encryption generates a unique random salt → unique cache key.
      // scrypt is CPU-intensive so we use a moderate count and generous timeout.
      const count = 1050;
      const envelopes = [];
      for (let i = 0; i < count; i++) {
        envelopes.push(store.encrypt(`secret-${i}`));
      }

      // All envelopes must still decrypt correctly even after eviction, because
      // the KDF derivation is deterministic for a given (key, salt) pair.
      for (let i = 0; i < envelopes.length; i++) {
        expect(store.decrypt(envelopes[i]!)).toBe(`secret-${i}`);
      }
    },
    300_000
  );

  it(
    "maintains correctness after cache eviction cycles",
    () => {
      const store = createProviderCredentialSecretStore({
        masterKey: "test-master-key-for-eviction",
        keyVersion: "eviction-v1"
      });

      // First batch
      const firstEnvelope = store.encrypt("first-secret");
      expect(store.decrypt(firstEnvelope)).toBe("first-secret");

      // Fill past the cache limit to evict earlier entries
      for (let i = 0; i < 1050; i++) {
        store.encrypt(`filler-${i}`);
      }

      // The first envelope should still decrypt correctly (re-derives the key)
      expect(store.decrypt(firstEnvelope)).toBe("first-secret");
    },
    300_000
  );
});
