import { DEFAULT_AUTOPILOT_RELIABILITY_CONTROLS, type AutopilotEvent, type AutopilotSettings, type Watcher } from "@agentic/contracts";

export type FeatureCapabilitySurface = "core" | "advanced";
export type FeatureCapabilityReadiness = "prototype" | "preview" | "operational" | "production";
export type FeatureCapabilityLoopStage = "decide" | "approve" | "execute" | "observe" | "improve" | "setup";
export type FeatureCapabilityOwnerLane =
  | "agent-intelligence"
  | "platform-security"
  | "product-platform"
  | "runtime-platform";

export type FeatureCapabilityContract = {
  route: string;
  routeFile: string;
  methods: readonly ("GET" | "POST" | "PUT" | "PATCH" | "DELETE")[];
};

export type FeatureCapabilityMaturityBlocker =
  | {
      type: "issue";
      issue: number;
      title: string;
      url: string;
    }
  | {
      type: "none";
      reason: string;
    };

export type FeatureCapabilityMaturity = {
  ownerLane: FeatureCapabilityOwnerLane;
  targetReadiness: FeatureCapabilityReadiness;
  blocker: FeatureCapabilityMaturityBlocker;
  requiredGates: readonly string[];
  nextValidationGate: string;
  rolloutNotes: string;
  rollbackNotes: string;
  lastValidationEvidence: readonly string[];
  productionEvidence?: readonly string[];
};

export type FeatureCapabilityDefinition = {
  id: string;
  label: string;
  surface: FeatureCapabilitySurface;
  readiness: FeatureCapabilityReadiness;
  loopStage: FeatureCapabilityLoopStage;
  uiModules: readonly string[];
  contracts: readonly FeatureCapabilityContract[];
  maturity: FeatureCapabilityMaturity;
  notes?: string;
};

export type FeatureCapabilityResolvedDefinition = FeatureCapabilityDefinition & {
  runtimeReason: string;
};

export type FeatureCapabilityRuntimeContext = {
  activeWorkspaceName: string | null;
  watcherCount: number;
  emittingWatcherCount?: number;
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

const NO_BLOCKER_REASON =
  "No open graduation blocker; continue using the listed gates as release evidence before any production claim.";

function issueBlocker(issue: number, title: string): FeatureCapabilityMaturityBlocker {
  return {
    type: "issue",
    issue,
    title,
    url: `https://github.com/leonardwongly/agentic/issues/${issue}`
  };
}

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
        methods: ["GET", "POST"]
      },
      {
        route: "/api/goals",
        routeFile: "apps/web/app/api/goals/route.ts",
        methods: ["GET", "POST"]
      }
    ],
    maturity: {
      ownerLane: "product-platform",
      targetReadiness: "production",
      blocker: {
        type: "none",
        reason: NO_BLOCKER_REASON
      },
      requiredGates: ["npm exec -- vitest run tests/nl-intent-route.test.ts tests/goal-detail-panel.test.tsx"],
      nextValidationGate: "Capture production intake evidence through the release closeout package.",
      rolloutNotes: "Keep intake enabled for authenticated operators after route and governance smoke checks pass.",
      rollbackNotes: "Disable NL intake entry points and fall back to direct goal creation if intent parsing regresses.",
      lastValidationEvidence: ["tests/feature-capabilities.test.ts", "npm run test:smoke:capabilities"]
    },
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
    maturity: {
      ownerLane: "runtime-platform",
      targetReadiness: "production",
      blocker: {
        type: "none",
        reason: NO_BLOCKER_REASON
      },
      requiredGates: ["npm exec -- vitest run tests/action-execution-contract.test.ts tests/execution-dispatch.test.ts"],
      nextValidationGate: "Refresh queue sequencing evidence with the next production closeout run.",
      rolloutNotes: "Keep the commitments inbox backed by server-derived ordering and idempotent PATCH handling.",
      rollbackNotes: "Hide commitment mutation controls and keep the queue read-only if sequencing evidence fails.",
      lastValidationEvidence: ["tests/feature-capabilities.test.ts", "npm run test:smoke:capabilities"]
    },
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
    maturity: {
      ownerLane: "platform-security",
      targetReadiness: "production",
      blocker: {
        type: "none",
        reason: NO_BLOCKER_REASON
      },
      requiredGates: ["npm exec -- vitest run tests/action-execution-contract.test.ts tests/operational-routes.test.ts"],
      nextValidationGate: "Attach approval decision evidence to the next release closeout packet.",
      rolloutNotes: "Keep high-risk execution paths behind explicit approval responses.",
      rollbackNotes: "Fail closed by disabling approval mutations if authorization or audit evidence regresses.",
      lastValidationEvidence: ["tests/feature-capabilities.test.ts", "npm run test:smoke:capabilities"]
    },
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
        methods: ["POST"]
      },
      {
        route: "/api/briefing/schedule",
        routeFile: "apps/web/app/api/briefing/schedule/route.ts",
        methods: ["GET", "POST"]
      }
    ],
    maturity: {
      ownerLane: "product-platform",
      targetReadiness: "production",
      blocker: {
        type: "none",
        reason: NO_BLOCKER_REASON
      },
      requiredGates: ["npm exec -- vitest run tests/dashboard-first-run-checklist.test.tsx tests/operational-routes.test.ts"],
      nextValidationGate: "Refresh briefing smoke evidence alongside runtime readiness checks.",
      rolloutNotes: "Expose startup briefing when readiness and schedule route checks are green.",
      rollbackNotes: "Keep briefing manual and suppress scheduling controls if readiness or schedule evidence fails.",
      lastValidationEvidence: ["tests/feature-capabilities.test.ts", "npm run test:smoke:capabilities"]
    }
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
        methods: ["PATCH"]
      }
    ],
    maturity: {
      ownerLane: "agent-intelligence",
      targetReadiness: "production",
      blocker: {
        type: "none",
        reason: NO_BLOCKER_REASON
      },
      requiredGates: ["npm exec -- vitest run tests/memory.test.ts tests/feature-capabilities.test.ts"],
      nextValidationGate: "Refresh shared-memory provenance evidence before production positioning.",
      rolloutNotes: "Keep shared memory edits available where audit and rollback controls are visible.",
      rollbackNotes: "Disable write controls and leave memory browse-only if provenance checks regress.",
      lastValidationEvidence: ["tests/feature-capabilities.test.ts", "npm run test:smoke:capabilities"]
    }
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
        methods: ["PATCH"]
      }
    ],
    maturity: {
      ownerLane: "agent-intelligence",
      targetReadiness: "operational",
      blocker: issueBlocker(152, "plan(roadmap): close Agentic capability and operations gaps after production proof"),
      requiredGates: ["npm exec -- vitest run tests/feature-capabilities.test.ts tests/route-user-scope.test.ts"],
      nextValidationGate: "Prove agent-scoped memory isolation and graduation evidence under #152.",
      rolloutNotes: "Keep the agent memory UI preview-labeled until scoped provenance and route evidence are attached.",
      rollbackNotes: "Remove the agent-scoped memory entry point while preserving shared memory routes.",
      lastValidationEvidence: ["tests/feature-capabilities.test.ts", "npm run test:smoke:capabilities"]
    },
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
        methods: ["GET", "PUT", "DELETE"]
      },
      {
        route: "/api/agents/[id]/clone",
        routeFile: "apps/web/app/api/agents/[id]/clone/route.ts",
        methods: ["POST"]
      }
    ],
    maturity: {
      ownerLane: "product-platform",
      targetReadiness: "production",
      blocker: {
        type: "none",
        reason: NO_BLOCKER_REASON
      },
      requiredGates: ["npm exec -- vitest run tests/agents-route.test.ts tests/feature-capabilities.test.ts"],
      nextValidationGate: "Refresh custom agent create, clone, and delete evidence before production positioning.",
      rolloutNotes: "Keep catalog operations enabled after route contract and permission checks pass.",
      rollbackNotes: "Disable catalog mutation controls and leave existing agents readable if route evidence regresses.",
      lastValidationEvidence: ["tests/feature-capabilities.test.ts", "npm run test:smoke:capabilities"]
    }
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
        methods: ["GET", "POST"]
      },
      {
        route: "/api/workspaces",
        routeFile: "apps/web/app/api/workspaces/route.ts",
        methods: ["GET", "POST"]
      }
    ],
    maturity: {
      ownerLane: "platform-security",
      targetReadiness: "operational",
      blocker: issueBlocker(142, "sec(config): configure GitHub App sync runtime and repo settings"),
      requiredGates: ["npm exec -- vitest run tests/integration-readiness.test.ts tests/google-provider-routes.test.ts"],
      nextValidationGate: "Prove connector configuration, scopes, and recovery state under #142.",
      rolloutNotes: "Keep setup surfaces preview-labeled until live connector and workspace settings are verified.",
      rollbackNotes: "Hide provider mutation controls and keep integration status read-only if configuration proof fails.",
      lastValidationEvidence: ["tests/feature-capabilities.test.ts", "npm run test:smoke:capabilities"]
    }
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
        methods: ["PATCH"]
      }
    ],
    maturity: {
      ownerLane: "runtime-platform",
      targetReadiness: "operational",
      blocker: issueBlocker(144, "ops(worker): verify deployed worker durability and recovery behavior"),
      requiredGates: ["npm exec -- vitest run tests/action-execution-idempotency.test.ts tests/runtime-readiness.test.ts"],
      nextValidationGate: "Verify deployed watcher durability, replay, and recovery behavior under #144.",
      rolloutNotes: "Promote watchers only when active event emission and durable queue recovery stay healthy.",
      rollbackNotes: "Return watchers to dry-run or notification-only mode if queue durability evidence regresses.",
      lastValidationEvidence: ["tests/feature-capabilities.test.ts", "npm run test:smoke:capabilities"]
    }
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
        methods: ["GET", "PUT", "DELETE"]
      }
    ],
    maturity: {
      ownerLane: "product-platform",
      targetReadiness: "operational",
      blocker: issueBlocker(152, "plan(roadmap): close Agentic capability and operations gaps after production proof"),
      requiredGates: ["npm exec -- vitest run tests/feature-capabilities.test.ts tests/dashboard-advanced-operations-card.test.tsx"],
      nextValidationGate: "Attach template graduation scope and execution evidence under #152.",
      rolloutNotes: "Keep templates preview-labeled until they have owner, rollback, and execution evidence.",
      rollbackNotes: "Hide template mutation controls while preserving existing workflow execution paths.",
      lastValidationEvidence: ["tests/feature-capabilities.test.ts", "npm run test:smoke:capabilities"]
    }
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
        methods: ["GET", "POST"]
      },
      {
        route: "/api/autopilot/events",
        routeFile: "apps/web/app/api/autopilot/events/route.ts",
        methods: ["POST"]
      }
    ],
    maturity: {
      ownerLane: "runtime-platform",
      targetReadiness: "operational",
      blocker: issueBlocker(144, "ops(worker): verify deployed worker durability and recovery behavior"),
      requiredGates: ["npm exec -- vitest run tests/policy.test.ts tests/runtime-readiness.test.ts"],
      nextValidationGate: "Prove deployed autopilot queue durability, event budgets, and override paths under #144.",
      rolloutNotes: "Promote autopilot control only when bounded reliability controls and operator overrides are green.",
      rollbackNotes: "Force notify-only mode and suppress automation controls if event budgets or override paths regress.",
      lastValidationEvidence: ["tests/feature-capabilities.test.ts", "npm run test:smoke:capabilities"]
    },
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

export type FeatureCapabilityMaturityIssue = {
  featureId: string;
  message: string;
};

export type FeatureCapabilityMaturityBoardItem = {
  id: string;
  label: string;
  ownerLane: FeatureCapabilityOwnerLane;
  surface: FeatureCapabilitySurface;
  readiness: FeatureCapabilityReadiness;
  targetReadiness: FeatureCapabilityReadiness;
  blocker: FeatureCapabilityMaturityBlocker;
  nextValidationGate: string;
  requiredGates: readonly string[];
  lastValidationEvidence: readonly string[];
  productionEvidence: readonly string[];
  contracts: number;
  releaseBlocked: boolean;
};

export type FeatureCapabilityMaturityLaneSummary = {
  ownerLane: FeatureCapabilityOwnerLane;
  total: number;
  preview: number;
  operationalOrBetter: number;
  releaseBlocked: number;
};

export type FeatureCapabilityMaturityBoard = {
  totalFeatures: number;
  previewFeatures: number;
  productionClaims: number;
  releaseBlocked: boolean;
  lanes: readonly FeatureCapabilityMaturityLaneSummary[];
  items: readonly FeatureCapabilityMaturityBoardItem[];
  issues: readonly FeatureCapabilityMaturityIssue[];
};

function humanizeReadiness(value: FeatureCapabilityReadiness): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function hasText(value: string): boolean {
  return value.trim().length > 0;
}

function isProductionEvidenceMissing(feature: FeatureCapabilityDefinition): boolean {
  return feature.readiness === "production" && (feature.maturity.productionEvidence?.length ?? 0) === 0;
}

export function validateFeatureCapabilityMaturity(
  features: readonly FeatureCapabilityDefinition[] = FEATURE_CAPABILITIES
): readonly FeatureCapabilityMaturityIssue[] {
  const issues: FeatureCapabilityMaturityIssue[] = [];

  for (const feature of features) {
    const { maturity } = feature;

    if (!hasText(maturity.ownerLane)) {
      issues.push({
        featureId: feature.id,
        message: "Capability must declare an owner lane."
      });
    }

    if (maturity.requiredGates.length === 0) {
      issues.push({
        featureId: feature.id,
        message: "Capability must declare at least one required validation gate."
      });
    }

    if (!hasText(maturity.nextValidationGate)) {
      issues.push({
        featureId: feature.id,
        message: "Capability must declare the next validation gate."
      });
    }

    if (!hasText(maturity.rolloutNotes) || !hasText(maturity.rollbackNotes)) {
      issues.push({
        featureId: feature.id,
        message: "Capability must declare rollout and rollback notes."
      });
    }

    if (feature.readiness === "preview") {
      if (maturity.blocker.type === "issue") {
        if (maturity.blocker.issue <= 0 || !hasText(maturity.blocker.title) || !hasText(maturity.blocker.url)) {
          issues.push({
            featureId: feature.id,
            message: "Preview capability issue blockers must include issue number, title, and URL."
          });
        }
      } else if (!hasText(maturity.blocker.reason)) {
        issues.push({
          featureId: feature.id,
          message: "Preview capability no-op blockers must explain why no issue is required."
        });
      }
    }

    if (isProductionEvidenceMissing(feature)) {
      issues.push({
        featureId: feature.id,
        message: "Production readiness requires explicit production evidence."
      });
    }
  }

  return issues;
}

export function buildFeatureCapabilityMaturityBoard(
  features: readonly FeatureCapabilityDefinition[] = FEATURE_CAPABILITIES
): FeatureCapabilityMaturityBoard {
  const issues = validateFeatureCapabilityMaturity(features);
  const issueFeatureIds = new Set(issues.map((issue) => issue.featureId));
  const items = features.map((feature): FeatureCapabilityMaturityBoardItem => {
    const productionEvidence = feature.maturity.productionEvidence ?? [];

    return {
      id: feature.id,
      label: feature.label,
      ownerLane: feature.maturity.ownerLane,
      surface: feature.surface,
      readiness: feature.readiness,
      targetReadiness: feature.maturity.targetReadiness,
      blocker: feature.maturity.blocker,
      nextValidationGate: feature.maturity.nextValidationGate,
      requiredGates: feature.maturity.requiredGates,
      lastValidationEvidence: feature.maturity.lastValidationEvidence,
      productionEvidence,
      contracts: feature.contracts.length,
      releaseBlocked: issueFeatureIds.has(feature.id)
    };
  });
  const ownerLanes = Array.from(new Set(items.map((item) => item.ownerLane))).sort();

  return {
    totalFeatures: features.length,
    previewFeatures: features.filter((feature) => feature.readiness === "preview").length,
    productionClaims: features.filter((feature) => feature.readiness === "production").length,
    releaseBlocked: issues.length > 0,
    lanes: ownerLanes.map((ownerLane) => {
      const laneItems = items.filter((item) => item.ownerLane === ownerLane);

      return {
        ownerLane,
        total: laneItems.length,
        preview: laneItems.filter((item) => item.readiness === "preview").length,
        operationalOrBetter: laneItems.filter((item) => READINESS_RANK[item.readiness] >= READINESS_RANK.operational).length,
        releaseBlocked: laneItems.filter((item) => item.releaseBlocked).length
      };
    }),
    items,
    issues
  };
}

type FeatureCapabilitySummaryOverrides = Partial<Record<string, FeatureCapabilityReadiness>>;

function isFeatureCapabilitySummaryOverrides(
  input:
    | FeatureCapabilitySummaryOverrides
    | readonly Pick<FeatureCapabilityDefinition, "surface" | "readiness" | "contracts">[]
): input is FeatureCapabilitySummaryOverrides {
  return !Array.isArray(input);
}

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
    const emittingWatcherCount = context.emittingWatcherCount ?? context.watcherCount;
    if (emittingWatcherCount <= 0) {
      return {
        ...feature,
        readiness: "preview",
        runtimeReason:
          context.watcherCount > 0
            ? `${formatCount(context.watcherCount, "active watcher")} are configured, but all are still dry-run or notification-suppressed, so watcher automation remains manual preview until event emission is enabled.`
            : "No active watchers are configured yet. Watcher automation remains manual preview until a watcher is active and event emission is enabled."
      };
    }

    const watcherSummary = `${formatCount(emittingWatcherCount, "event-emitting watcher")} are feeding the durable automation path.`;

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
  const reliabilityControls = params.autopilotSettings.reliabilityControls ?? DEFAULT_AUTOPILOT_RELIABILITY_CONTROLS;
  const cutoff = Date.now() - reliabilityControls.budgetWindowMinutes * 60 * 1000;
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
    failureEvents.length < reliabilityControls.maxConsecutiveFailures;
  const autopilotOperational =
    !hasWatcherDiagnostics &&
    !hasAutopilotDiagnostics &&
    pendingEvents.length < reliabilityControls.maxPendingEvents &&
    recentBudgetedEvents.length < reliabilityControls.maxEventsPerWindow &&
    failureEvents.length < reliabilityControls.maxConsecutiveFailures;

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
  if (!isFeatureCapabilitySummaryOverrides(input)) {
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
