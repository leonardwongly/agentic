import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_AUTOPILOT_RELIABILITY_CONTROLS } from "@agentic/contracts";
import {
  FEATURE_CAPABILITIES,
  deriveFeatureCapabilityReadiness,
  summarizeFeatureCapabilities
} from "../apps/web/lib/feature-capabilities";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("feature capability registry", () => {
  it("keeps feature ids unique and route contracts backed by files", () => {
    const seenIds = new Set<string>();

    for (const feature of FEATURE_CAPABILITIES) {
      expect(seenIds.has(feature.id)).toBe(false);
      seenIds.add(feature.id);

      for (const contract of feature.contracts) {
        expect(existsSync(path.resolve(repoRoot, contract.routeFile))).toBe(true);
      }
    }
  });

  it("tracks the agent memory contract and readiness summary", () => {
    const summary = summarizeFeatureCapabilities();
    const agentMemoryFeature = FEATURE_CAPABILITIES.find((feature) => feature.id === "agent-memory");

    expect(agentMemoryFeature).toBeDefined();
    expect(agentMemoryFeature?.contracts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          route: "/api/agents/[id]/memories",
          routeFile: "apps/web/app/api/agents/[id]/memories/route.ts"
        })
      ])
    );
    expect(summary.totalFeatures).toBe(FEATURE_CAPABILITIES.length);
    expect(summary.trackedContracts).toBeGreaterThan(0);
    expect(summary.core.total).toBeGreaterThan(0);
    expect(summary.advanced.total).toBeGreaterThan(0);
  });

  it("graduates watcher and autopilot readiness when runtime reliability signals stay inside the control envelope", () => {
    const readiness = deriveFeatureCapabilityReadiness({
      autopilotSettings: {
        reliabilityControls: DEFAULT_AUTOPILOT_RELIABILITY_CONTROLS
      },
      autopilotEvents: [
        {
          createdAt: new Date().toISOString(),
          status: "executed"
        }
      ],
      watchers: [
        {
          status: "active"
        }
      ],
      diagnostics: {
        items: []
      }
    });
    const summary = summarizeFeatureCapabilities(readiness);

    expect(readiness.watchers).toBe("operational");
    expect(readiness["autopilot-control"]).toBe("operational");
    expect(summary.advanced.operationalOrBetter).toBeGreaterThan(0);
  });

  it("keeps watcher and autopilot readiness in preview when reliability diagnostics or failures breach the thresholds", () => {
    const readiness = deriveFeatureCapabilityReadiness({
      autopilotSettings: {
        reliabilityControls: {
          ...DEFAULT_AUTOPILOT_RELIABILITY_CONTROLS,
          maxConsecutiveFailures: 1
        }
      },
      autopilotEvents: [
        {
          createdAt: new Date().toISOString(),
          status: "failed"
        }
      ],
      watchers: [
        {
          status: "active"
        }
      ],
      diagnostics: {
        items: [
          {
            kind: "async_execution_issues"
          }
        ]
      }
    });

    expect(readiness.watchers).toBe("preview");
    expect(readiness["autopilot-control"]).toBe("preview");
  });
});
