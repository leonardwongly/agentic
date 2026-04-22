import type { AutopilotEvent, AutopilotSettings, Watcher } from "@agentic/contracts";

export type FeatureCapabilitySurface = "core" | "advanced";
export type FeatureCapabilityReadiness = "prototype" | "preview" | "operational" | "production";
export type FeatureCapabilityLoopStage = "decide" | "approve" | "execute" | "observe" | "improve" | "setup";

export type FeatureCapabilityContract = {
  route: string;
  routeFile: string;
  methods: readonly ("GET" | "POST" | "PUT" | "PATCH" | "DELETE")[];
};

export type FeatureCapabilityDefinition = {
  id: string;
  label: string;
  surface: FeatureCapabilitySurface;
  readiness: FeatureCapabilityReadiness;
  loopStage: FeatureCapabilityLoopStage;
  uiModules: readonly string[];
  contracts: readonly FeatureCapabilityContract[];
  notes?: string;
};

export type FeatureCapabilityResolvedDefinition = FeatureCapabilityDefinition & {
  runtimeReason: string;
};

export type FeatureCapabilityRuntimeContext = {
  activeWorkspaceName: string | null;
  watcherCount: number;
  autopilotMode: string;
  operations:
    | {
        asyncExecutionStatus: "healthy" | "attention" | "critical" | "idle";
        asyncIssueCount: number;
        connectorHealthStatus: "healthy" | "attention" | "critical" | "idle";
        connectorIssueCount: number;
        autonomyPostureStatus: "healthy" | "attention" | "critical" | "idle";
        hasOverridePaths: boolean;
      }
    | null;
};

const READINESS_RANK: Record<FeatureCapabilityReadiness, number> = {
  prototype: 0,
  preview: 1,
  operational: 2,
  production: 3
};

export const FEATURE_CAPABILITIES: readonly FeatureCapabilityDefinition[] = [
  {
    id: "request-work",
    label: "Request work intake",
    surface: "core",
    readiness: "operational",
    loopStage: "decide",
    uiModules: ["apps/web/components/dashboard.tsx", "apps/web/components/command-palette.tsx"],
    contracts: [
      {
        route: "/api/nl/intent",
        routeFile: "apps/web/app/api/nl/intent/route.ts",
        methods: ["POST"]
      },
      {
        route: "/api/goals",
        routeFile: "apps/web/app/api/goals/route.ts",
        methods: ["GET", "POST"]
      }
    ],
    notes: "Translates operator intent into governed goal creation and bounded next actions."
  },
  {
    id: "commitments-inbox",
    label: "Commitments inbox",
    surface: "core",
    readiness: "operational",
    loopStage: "execute",
    uiModules: ["apps/web/components/dashboard.tsx"],
    contracts: [
      {
        route: "/api/commitments",
        routeFile: "apps/web/app/api/commitments/route.ts",
        methods: ["GET"]
      },
      {
        route: "/api/commitments/[id]",
        routeFile: "apps/web/app/api/commitments/[id]/route.ts",
        methods: ["PATCH"]
      }
    ],
    notes: "Server-derived sequencing keeps the operating queue bounded and urgency-aware."
  },
  {
    id: "approvals-queue",
    label: "Approvals queue",
    surface: "core",
    readiness: "operational",
    loopStage: "approve",
    uiModules: ["apps/web/components/dashboard.tsx"],
    contracts: [
      {
        route: "/api/approvals/[id]/respond",
        routeFile: "apps/web/app/api/approvals/[id]/respond/route.ts",
        methods: ["POST"]
      }
    ],
    notes: "High-risk actions stay gated behind explicit approval decisions."
  },
  {
    id: "startup-briefing",
    label: "Startup briefing",
    surface: "core",
    readiness: "operational",
    loopStage: "observe",
    uiModules: ["apps/web/components/dashboard.tsx"],
    contracts: [
      {
        route: "/api/briefing",
        routeFile: "apps/web/app/api/briefing/route.ts",
        methods: ["GET"]
      },
      {
        route: "/api/briefing/schedule",
        routeFile: "apps/web/app/api/briefing/schedule/route.ts",
        methods: ["PATCH"]
      }
    ]
  },
  {
    id: "memories-workbench",
    label: "Shared memory workbench",
    surface: "advanced",
    readiness: "operational",
    loopStage: "improve",
    uiModules: ["apps/web/components/dashboard.tsx"],
    contracts: [
      {
        route: "/api/memory",
        routeFile: "apps/web/app/api/memory/route.ts",
        methods: ["GET", "POST"]
      },
      {
        route: "/api/memory/[id]",
        routeFile: "apps/web/app/api/memory/[id]/route.ts",
        methods: ["PATCH", "DELETE"]
      }
    ]
  },
  {
    id: "agent-memory",
    label: "Agent-scoped memory",
    surface: "advanced",
    readiness: "preview",
    loopStage: "improve",
    uiModules: ["apps/web/components/ui/agent-memory.tsx"],
    contracts: [
      {
        route: "/api/agents/[id]/memories",
        routeFile: "apps/web/app/api/agents/[id]/memories/route.ts",
        methods: ["GET", "POST"]
      },
      {
        route: "/api/memory/[id]",
        routeFile: "apps/web/app/api/memory/[id]/route.ts",
        methods: ["PATCH", "DELETE"]
      }
    ],
    notes: "Preview surface that now has an explicit backing contract instead of a phantom endpoint."
  },
  {
    id: "agents-catalog",
    label: "Custom agents catalog",
    surface: "advanced",
    readiness: "operational",
    loopStage: "setup",
    uiModules: ["apps/web/components/dashboard.tsx", "apps/web/components/agents/agent-builder.tsx"],
    contracts: [
      {
        route: "/api/agents",
        routeFile: "apps/web/app/api/agents/route.ts",
        methods: ["GET", "POST"]
      },
      {
        route: "/api/agents/[id]",
        routeFile: "apps/web/app/api/agents/[id]/route.ts",
        methods: ["GET", "PUT"]
      },
      {
        route: "/api/agents/[id]/clone",
        routeFile: "apps/web/app/api/agents/[id]/clone/route.ts",
        methods: ["POST"]
      }
    ]
  },
  {
    id: "integrations-workspace",
    label: "Integration and workspace setup",
    surface: "advanced",
    readiness: "preview",
    loopStage: "setup",
    uiModules: ["apps/web/components/dashboard.tsx"],
    contracts: [
      {
        route: "/api/integrations",
        routeFile: "apps/web/app/api/integrations/route.ts",
        methods: ["GET", "PATCH"]
      },
      {
        route: "/api/workspaces",
        routeFile: "apps/web/app/api/workspaces/route.ts",
        methods: ["GET", "POST"]
      }
    ]
  },
  {
    id: "watchers",
    label: "Watchers",
    surface: "advanced",
    readiness: "preview",
    loopStage: "observe",
    uiModules: ["apps/web/components/dashboard.tsx"],
    contracts: [
      {
        route: "/api/watchers",
        routeFile: "apps/web/app/api/watchers/route.ts",
        methods: ["GET", "POST"]
      },
      {
        route: "/api/watchers/[id]",
        routeFile: "apps/web/app/api/watchers/[id]/route.ts",
        methods: ["PATCH", "DELETE"]
      }
    ]
  },
  {
    id: "workflow-templates",
    label: "Workflow templates",
    surface: "advanced",
    readiness: "preview",
    loopStage: "improve",
    uiModules: ["apps/web/components/dashboard.tsx"],
    contracts: [
      {
        route: "/api/workflow-templates",
        routeFile: "apps/web/app/api/workflow-templates/route.ts",
        methods: ["GET", "POST"]
      },
      {
        route: "/api/workflow-templates/[id]",
        routeFile: "apps/web/app/api/workflow-templates/[id]/route.ts",
        methods: ["PATCH", "DELETE"]
      }
    ]
  },
  {
    id: "autopilot-control",
    label: "Autopilot control",
    surface: "advanced",
    readiness: "preview",
    loopStage: "execute",
    uiModules: ["apps/web/components/dashboard.tsx"],
    contracts: [
      {
        route: "/api/autopilot/settings",
        routeFile: "apps/web/app/api/autopilot/settings/route.ts",
        methods: ["GET", "PATCH"]
      },
      {
        route: "/api/autopilot/events",
        routeFile: "apps/web/app/api/autopilot/events/route.ts",
        methods: ["GET", "POST"]
      }
    ],
    notes: "Runtime readiness graduates from preview once backlog, failure, and event-budget thresholds stay inside the bounded reliability controls."
  }
] as const;

type SurfaceSummary = {
  total: number;
  operationalOrBetter: number;
  productionReady: number;
};

export type FeatureCapabilitySummary = {
  totalFeatures: number;
  trackedContracts: number;
  core: SurfaceSummary;
  advanced: SurfaceSummary;
};

function humanizeReadiness(value: FeatureCapabilityReadiness): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

type FeatureCapabilitySummaryOverrides = Partial<Record<string, FeatureCapabilityReadiness>>;

type FeatureCapabilityRuntimeReadinessParams = {
  autopilotSettings: Pick<AutopilotSettings, "reliabilityControls">;
  autopilotEvents: Pick<AutopilotEvent, "createdAt" | "status">[];
  watchers: Pick<Watcher, "status">[];
  diagnostics: {
    items: Array<{
      kind: string;
    }>;
  };
};

function formatCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function resolveAutomationRuntimeCapability(
  feature: FeatureCapabilityDefinition,
  context: FeatureCapabilityRuntimeContext
): FeatureCapabilityResolvedDefinition {
  const fallbackReason =
    feature.notes ??
    "This surface stays in preview until the runtime control plane exposes stable queue, recovery, and policy signals.";

  if (!context.activeWorkspaceName) {
    return {
      ...feature,
      runtimeReason: "Select a workspace before treating this surface as operational.",
      readiness: "preview"
    };
  }

  if (!context.operations) {
    return {
      ...feature,
      runtimeReason: "Operational telemetry is unavailable, so this surface remains fail-closed in preview.",
      readiness: "preview"
    };
  }

  if (context.operations.asyncExecutionStatus === "critical") {
    return {
      ...feature,
      runtimeReason: "Queue recovery is still critical, so this surface remains preview until replayable execution is healthy again.",
      readiness: "preview"
    };
  }

  if (context.operations.connectorHealthStatus === "critical") {
    return {
      ...feature,
      runtimeReason: "Connector health is still critical, so this surface remains preview until credential recovery completes.",
      readiness: "preview"
    };
  }

  if (feature.id === "autopilot-control" && !context.operations.hasOverridePaths) {
    return {
      ...feature,
      runtimeReason: "Operator recovery paths are unavailable, so autopilot control stays preview.",
      readiness: "preview"
    };
  }

  const degradedSignals: string[] = [];
  if (context.operations.asyncExecutionStatus === "attention") {
    degradedSignals.push(formatCount(context.operations.asyncIssueCount, "queue issue"));
  }
  if (context.operations.connectorHealthStatus === "attention") {
    degradedSignals.push(formatCount(context.operations.connectorIssueCount, "connector issue"));
  }
  if (context.operations.autonomyPostureStatus === "attention") {
    degradedSignals.push("autonomy posture needs review");
  }

  if (feature.id === "watchers") {
    const watcherSummary =
      context.watcherCount > 0
        ? `${formatCount(context.watcherCount, "active watcher")} are already feeding the durable automation path.`
        : "No active watchers are configured yet, but the durable automation path is available.";

    return {
      ...feature,
      readiness: "operational",
      runtimeReason:
        degradedSignals.length > 0
          ? `${watcherSummary} Operational with attention: ${degradedSignals.join(", ")}.`
          : `${watcherSummary} Watchers now run with queue recovery, connector diagnostics, and operator remediation paths.`
    };
  }

  const modeLabel = context.autopilotMode.replaceAll("_", " ");
  return {
    ...feature,
    readiness: "operational",
    runtimeReason:
      degradedSignals.length > 0
        ? `Autopilot control is operational in ${modeLabel} mode with replay and recovery tooling. Current attention signals: ${degradedSignals.join(", ")}.`
        : `Autopilot control is operational in ${modeLabel} mode with durable execution, replay, and operator recovery tooling.`
  };
}

export function resolveFeatureCapabilities(
  context?: FeatureCapabilityRuntimeContext
): readonly FeatureCapabilityResolvedDefinition[] {
  return FEATURE_CAPABILITIES.map((feature) => {
    if (!context || (feature.id !== "watchers" && feature.id !== "autopilot-control")) {
      return {
        ...feature,
        runtimeReason: feature.notes ?? `Capability remains ${humanizeReadiness(feature.readiness).toLowerCase()}.`
      };
    }

    return resolveAutomationRuntimeCapability(feature, context);
  });
}

function buildSurfaceSummaryFromFeatures(
  surface: FeatureCapabilitySurface,
  features: readonly Pick<FeatureCapabilityDefinition, "surface" | "readiness">[]
): SurfaceSummary {
  const scopedFeatures = features.filter((feature) => feature.surface === surface);

  return {
    total: scopedFeatures.length,
    operationalOrBetter: scopedFeatures.filter(
      (feature) => READINESS_RANK[feature.readiness] >= READINESS_RANK.operational
    ).length,
    productionReady: scopedFeatures.filter((feature) => feature.readiness === "production").length
  };
}

function buildSurfaceSummaryFromOverrides(
  surface: FeatureCapabilitySurface,
  readinessOverrides: FeatureCapabilitySummaryOverrides
): SurfaceSummary {
  const features = FEATURE_CAPABILITIES.filter((feature) => feature.surface === surface);

  return {
    total: features.length,
    operationalOrBetter: features.filter((feature) => {
      const readiness = readinessOverrides[feature.id] ?? feature.readiness;
      return READINESS_RANK[readiness] >= READINESS_RANK.operational;
    }).length,
    productionReady: features.filter((feature) => (readinessOverrides[feature.id] ?? feature.readiness) === "production")
      .length
  };
}

export function deriveFeatureCapabilityReadiness(
  params: FeatureCapabilityRuntimeReadinessParams
): FeatureCapabilitySummaryOverrides {
  const cutoff = Date.now() - params.autopilotSettings.reliabilityControls.budgetWindowMinutes * 60 * 1000;
  const recentEvents = params.autopilotEvents.filter((event) => Date.parse(event.createdAt) >= cutoff);
  const recentBudgetedEvents = recentEvents.filter(
    (event) => event.status === "pending" || event.status === "notified" || event.status === "executed" || event.status === "failed"
  );
  const pendingEvents = recentEvents.filter((event) => event.status === "pending");
  const failureEvents = recentEvents.filter((event) => event.status === "failed");
  const watcherDiagnostics = new Set(["orphan_watchers"]);
  const autopilotDiagnostics = new Set(["async_execution_issues", "stuck_workflows"]);
  const hasWatcherDiagnostics = params.diagnostics.items.some((item) => watcherDiagnostics.has(item.kind));
  const hasAutopilotDiagnostics = params.diagnostics.items.some((item) => autopilotDiagnostics.has(item.kind));
  const hasActiveWatchers = params.watchers.some((watcher) => watcher.status === "active");
  const watchersOperational =
    hasActiveWatchers &&
    !hasWatcherDiagnostics &&
    failureEvents.length < params.autopilotSettings.reliabilityControls.maxConsecutiveFailures;
  const autopilotOperational =
    !hasWatcherDiagnostics &&
    !hasAutopilotDiagnostics &&
    pendingEvents.length < params.autopilotSettings.reliabilityControls.maxPendingEvents &&
    recentBudgetedEvents.length < params.autopilotSettings.reliabilityControls.maxEventsPerWindow &&
    failureEvents.length < params.autopilotSettings.reliabilityControls.maxConsecutiveFailures;

  return {
    watchers: watchersOperational ? "operational" : "preview",
    "autopilot-control": autopilotOperational ? "operational" : "preview"
  };
}

export function summarizeFeatureCapabilities(
  input:
    | FeatureCapabilitySummaryOverrides
    | readonly Pick<FeatureCapabilityDefinition, "surface" | "readiness" | "contracts">[] = FEATURE_CAPABILITIES
): FeatureCapabilitySummary {
  if (Array.isArray(input)) {
    return {
      totalFeatures: input.length,
      trackedContracts: input.reduce((count, feature) => count + feature.contracts.length, 0),
      core: buildSurfaceSummaryFromFeatures("core", input),
      advanced: buildSurfaceSummaryFromFeatures("advanced", input)
    };
  }

  return {
    totalFeatures: FEATURE_CAPABILITIES.length,
    trackedContracts: FEATURE_CAPABILITIES.reduce((count, feature) => count + feature.contracts.length, 0),
    core: buildSurfaceSummaryFromOverrides("core", input),
    advanced: buildSurfaceSummaryFromOverrides("advanced", input)
  };
}
