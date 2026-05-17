import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_AUTOPILOT_RELIABILITY_CONTROLS } from "@agentic/contracts";
import {
  collectFeatureCapabilityContractDrift,
  extractRouteHandlerMethods,
  formatFeatureCapabilityContractDrift
} from "../scripts/lib/feature-capability-contracts";
import {
  FEATURE_CAPABILITIES,
  resolveFeatureCapabilities,
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

  it("keeps feature capability route methods synchronized with route exports", () => {
    const drift = collectFeatureCapabilityContractDrift(FEATURE_CAPABILITIES, repoRoot);

    expect(drift.map(formatFeatureCapabilityContractDrift)).toEqual([]);
  });

  it("detects stale and missing method declarations in capability contracts", () => {
    expect(extractRouteHandlerMethods("export async function GET() {}\nexport const POST = async () => {}")).toEqual([
      "GET",
      "POST"
    ]);

    const drift = collectFeatureCapabilityContractDrift(
      [
        {
          id: "fixture",
          contracts: [
            {
              route: "/api/fixture",
              routeFile: "tests/fixtures/feature-capability-fixture-route.ts",
              methods: ["GET", "DELETE"]
            }
          ]
        }
      ],
      repoRoot
    );

    expect(drift).toEqual([
      expect.objectContaining({
        actualMethods: [],
        declaredMethods: ["GET", "DELETE"],
        missingDeclaredMethods: [],
        staleDeclaredMethods: ["GET", "DELETE"]
      })
    ]);
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

  it("promotes watchers and autopilot control when runtime recovery signals are healthy", () => {
    const resolved = resolveFeatureCapabilities({
      activeWorkspaceName: "Operations",
      watcherCount: 3,
      autopilotMode: "notify_only",
      operations: {
        asyncExecutionStatus: "healthy",
        asyncIssueCount: 0,
        connectorHealthStatus: "healthy",
        connectorIssueCount: 0,
        autonomyPostureStatus: "healthy",
        hasOverridePaths: true
      }
    });
    const summary = summarizeFeatureCapabilities(resolved);
    const watcherCapability = resolved.find((feature) => feature.id === "watchers");
    const autopilotCapability = resolved.find((feature) => feature.id === "autopilot-control");

    expect(watcherCapability?.readiness).toBe("operational");
    expect(watcherCapability?.runtimeReason).toContain("Watchers now run with queue recovery");
    expect(autopilotCapability?.readiness).toBe("operational");
    expect(autopilotCapability?.runtimeReason).toContain("notify only mode");
    expect(summary.advanced.operationalOrBetter).toBe(
      FEATURE_CAPABILITIES.filter(
        (feature) =>
          feature.surface === "advanced" &&
          (feature.readiness === "operational" ||
            feature.readiness === "production" ||
            feature.id === "watchers" ||
            feature.id === "autopilot-control")
      ).length
    );
  });

  it("keeps runtime-promoted automation surfaces fail-closed when telemetry or recovery paths are missing", () => {
    const resolvedWithoutTelemetry = resolveFeatureCapabilities({
      activeWorkspaceName: "Operations",
      watcherCount: 1,
      autopilotMode: "notify_only",
      operations: null
    });
    const watcherWithoutTelemetry = resolvedWithoutTelemetry.find((feature) => feature.id === "watchers");
    const autopilotWithoutTelemetry = resolvedWithoutTelemetry.find((feature) => feature.id === "autopilot-control");

    expect(watcherWithoutTelemetry?.readiness).toBe("preview");
    expect(watcherWithoutTelemetry?.runtimeReason).toContain("Operational telemetry is unavailable");
    expect(autopilotWithoutTelemetry?.readiness).toBe("preview");
    expect(autopilotWithoutTelemetry?.runtimeReason).toContain("Operational telemetry is unavailable");

    const resolvedCriticalRuntime = resolveFeatureCapabilities({
      activeWorkspaceName: "Operations",
      watcherCount: 2,
      autopilotMode: "auto_run",
      operations: {
        asyncExecutionStatus: "critical",
        asyncIssueCount: 2,
        connectorHealthStatus: "healthy",
        connectorIssueCount: 0,
        autonomyPostureStatus: "attention",
        hasOverridePaths: false
      }
    });
    const watcherCritical = resolvedCriticalRuntime.find((feature) => feature.id === "watchers");
    const autopilotCritical = resolvedCriticalRuntime.find((feature) => feature.id === "autopilot-control");

    expect(watcherCritical?.readiness).toBe("preview");
    expect(watcherCritical?.runtimeReason).toContain("Queue recovery is still critical");
    expect(autopilotCritical?.readiness).toBe("preview");
    expect(autopilotCritical?.runtimeReason).toContain("Queue recovery is still critical");
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
