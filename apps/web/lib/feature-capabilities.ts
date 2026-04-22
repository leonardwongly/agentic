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

function buildSurfaceSummary(
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
  readinessOverrides: FeatureCapabilitySummaryOverrides = {}
): FeatureCapabilitySummary {
  return {
    totalFeatures: FEATURE_CAPABILITIES.length,
    trackedContracts: FEATURE_CAPABILITIES.reduce((count, feature) => count + feature.contracts.length, 0),
    core: buildSurfaceSummary("core", readinessOverrides),
    advanced: buildSurfaceSummary("advanced", readinessOverrides)
  };
}
