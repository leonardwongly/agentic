import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  resetAuthSessionStateStoreForTesting,
  setAuthSessionStateStoreForTesting,
  type AuthSessionStateStore
} from "../apps/web/lib/auth-session-store";
import { POST as governanceSimulatePostRoute } from "../apps/web/app/api/governance/simulate/route";
import { buildAuthorizedJsonRequest, expectNoStoreHeaders } from "./route-test-helpers";

describe("governance simulate route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-governance-simulate-route-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
    resetAuthSessionStateStoreForTesting();
  });

  it("simulates custom governance overrides and custom scenarios without mutating stored governance", async () => {
    const response = await governanceSimulatePostRoute(
      buildAuthorizedJsonRequest("http://localhost/api/governance/simulate", {
        governance: {
          requireAuditExports: true,
          externalSendRequiresApproval: false,
          calendarWriteRequiresApproval: true,
          maxAutoRunRiskClass: "R3",
          shadowReplayPolicy: {
            enabled: false,
            promotionMode: "shadow_only",
            rollbackOutcome: "allowed_with_confirmation",
            minimumMatchedEpisodes: 6
          }
        },
        scenarios: [
          {
            id: "custom-send",
            title: "Send customer summary",
            description: "Customer-facing update with external communication risk.",
            capabilities: ["send"],
            confidence: 0.91
          }
        ]
      })
    );
    const payload = (await response.json()) as {
      governance: {
        requireAuditExports: boolean;
        externalSendRequiresApproval: boolean;
        shadowReplayPolicy: {
          enabled: boolean;
          promotionMode: string;
          rollbackOutcome: string;
          minimumMatchedEpisodes: number;
          minimumPrecision: number;
        };
      };
      autonomyBudget: {
        governanceCeilingRiskClass: string;
        r3AutonomyEligible: boolean;
        requiresExplicitApprovalCapabilities: string[];
        shadowReplay: {
          enabled: boolean;
          required: boolean;
        };
      };
      conformance: {
        status: string;
      };
      simulations: Array<{
        id: string;
        result: {
          decision: {
            outcome: string;
            requiresApproval: boolean;
          };
          conformance: {
            status: string;
          };
        };
      }>;
    };

    expect(response.status).toBe(200);
    expect(payload.governance).toMatchObject({
      requireAuditExports: true,
      externalSendRequiresApproval: false,
      shadowReplayPolicy: {
        enabled: false,
        promotionMode: "shadow_only",
        rollbackOutcome: "allowed_with_confirmation",
        minimumMatchedEpisodes: 6,
        minimumPrecision: 0.8
      }
    });
    expect(payload.autonomyBudget).toMatchObject({
      governanceCeilingRiskClass: "R3",
      r3AutonomyEligible: true,
      requiresExplicitApprovalCapabilities: ["schedule"],
      shadowReplay: {
        enabled: false,
        required: true,
        promotionMode: "shadow_only",
        rollbackOutcome: "allowed_with_confirmation"
      }
    });
    expect(payload.conformance).toMatchObject({
      status: "non_conformant"
    });
    expect(payload.simulations).toEqual([
      expect.objectContaining({
        id: "custom-send",
        result: expect.objectContaining({
          decision: expect.objectContaining({
            outcome: "allowed_with_confirmation",
            requiresApproval: true
          }),
          conformance: expect.objectContaining({
            status: "non_conformant"
          })
        })
      })
    ]);
    expectNoStoreHeaders(response);
  });

  it("rate limits repeated governance simulation requests before evaluating scenarios", async () => {
    const seenKeys: string[] = [];
    const store: AuthSessionStateStore = {
      scope: "shared",
      async checkRateLimit(key) {
        seenKeys.push(key);
        return {
          allowed: false,
          retryAfterMs: 45_000
        };
      },
      async clearRateLimit() {},
      async revokeSession() {},
      async isSessionRevoked() {
        return false;
      },
      async reset() {}
    };

    setAuthSessionStateStoreForTesting(store);

    const response = await governanceSimulatePostRoute(
      buildAuthorizedJsonRequest("http://localhost/api/governance/simulate", {
        scenarios: [
          {
            title: "Read current workspace docs",
            capabilities: ["read"],
            confidence: 0.95
          }
        ]
      })
    );
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("45");
    expect(payload).toEqual({
      error: "Too many governance simulation requests. Try again later."
    });
    expect(seenKeys).toHaveLength(1);
    expect(seenKeys[0]).toContain("governance-simulate:user:");
    expect(seenKeys[0]).toContain(":fp:/api/governance/simulate:");
  });
});
