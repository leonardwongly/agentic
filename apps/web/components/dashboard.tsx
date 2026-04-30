"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  commitmentInboxBucketValues,
  privacyOperationKindValues,
  workspaceRoleValues,
  defaultWorkspaceShadowReplayPolicy,
  enterpriseWorkspaceGovernanceDefaults,
  DEFAULT_COMMITMENT_INBOX_LIMIT,
  type OperatorProduct,
  type OperatorProductSelection,
  briefingFocusValues,
  briefingTypeValues,
  type AgentDefinition,
  type AutopilotSettings,
  type ApprovalDecisionScope,
  type AutonomyBudget,
  type BriefingPreferences,
  type BriefingType,
  type CommitmentInboxBucket,
  type CommitmentInboxPage,
  type GoalTemplate,
  type PolicyDecision,
  type PolicyReplayValidation,
  type WorkspaceGovernance
} from "@agentic/contracts";
import type { LocalNoteDocument } from "@agentic/integrations/client";
import type { PolicyLearningInfluenceComparison, PolicyShadowReplayReadiness } from "@agentic/policy";
import type { DashboardData, DashboardDiagnosticTarget } from "@agentic/repository";
import type { WorkflowRecommendation } from "@agentic/self-improvement-memory";
import { DashboardAdvancedOperationsCard } from "./dashboard-advanced-operations-card";
import { DashboardCommandCenter } from "./dashboard-command-center";
import {
  DashboardGoalsCard,
  type RecommendationLoadState
} from "./dashboard-goals-card";
import { DashboardAdvancedSurface } from "./dashboard-advanced-surface";
import type {
  GoalRecommendationsApiResponse,
  OperatorProductPayload,
  PrivacyControlsApiResponse,
  PrivacyControlSummary,
  RecommendationFeedbackApiResponse,
  RequestState
} from "./dashboard-types";
import { DashboardOperationsTowerCard } from "./dashboard-operations-tower-card";
import { CoreLoopViewTracker } from "./core-loop-view-tracker";
import {
  buildDashboardCommandCenterModel,
  getPreferredCommandCenterRole,
  type CommandCenterRole
} from "../lib/command-center";
import { isAdvancedDashboardSection } from "../lib/dashboard-surface";
import { describeCoreLoopHealth, summarizeCoreLoopTelemetry } from "../lib/core-loop-telemetry";
import {
  deriveFeatureCapabilityReadiness,
  resolveFeatureCapabilities,
  summarizeFeatureCapabilities
} from "../lib/feature-capabilities";
import { buildNlCapabilitySummary } from "../lib/nl-capabilities";
import {
  GOAL_SHARE_MUTATION_DENIED_REASON,
  canManageGoalSharesForRole,
  canOperateSharedWorkflow,
  getSharedWorkflowDeniedReason,
  resolveWorkspaceRoleForUser
} from "../lib/workspace-role-permissions";
import {
  buildGoalRecommendationQuery,
  buildRecommendationFeedbackPayload,
  buildRecommendationRefinementSource,
  type RecommendationRefinementSource
} from "../lib/workflow-recommendations";
import { CommandPalette } from "./command-palette";
import {
  buildClientIdempotencyKey,
  type BriefingCreateApiResponse,
  type BriefingJobStatusApiResponse,
  type DocsRenderApiResponse,
  type DocsRenderJobStatusApiResponse,
  type GoalJobStatusApiResponse,
  type GoalQueuedApiResponse,
  loadDashboardSnapshot as fetchDashboardSnapshot,
  loadTemplatesSnapshot as fetchTemplatesSnapshot,
  type NLIntentApiResponse,
  pollJobStatusUntilSettled,
  type TemplateRunApiResponse,
  type TemplateRunJobStatusApiResponse,
  readJson
} from "./dashboard-async";
import { DashboardOperatingSectionsCard } from "./dashboard-operating-sections";
import { DashboardOperationsSections } from "./dashboard-operations-sections";
import { useGoalShareReview } from "./use-goal-share-review";
import {
  StatusBadge,
  RiskBadge,
  ExecutionModeBadge,
  ImplementationTierBadge,
  approvalMatchesExecutionModeFilter,
  bundleMatchesExecutionModeFilter,
  executionModeFilterOptions,
  extractArtifactExecutionMode,
  getExecutionModeFilterOption,
  getImplementationTierPresentation,
  getExecutionModePresentation,
  matchesExecutionModeFilter,
  CopyButton,
  CopyableText,
  RelativeTime,
  KeyboardShortcutsProvider,
  useShortcut,
  FaviconBadge,
  toast,
  ToastContainer,
  SlideOutPanel,
  QuickActionsBar,
  FloatingActionsBar,
  NoApprovalsEmpty,
  NoArtifactsEmpty,
  // 10x Components Phase 1
  StatsBar,
  useStatsBar,
  CollapsibleSection,
  ArtifactPreview,
  ApprovalPreview,
  useSmartDefaults,
  useRecentActions,
  RecentActionsBar,
  useBatchSelection,
  BatchActionsBar,
  SelectableItem,
  FocusMode,
  useFocusMode,
  FocusModeButton,
  UnifiedFeed,
  useUnifiedFeed,
  RiskClassHelp,
  FeatureHelp,
  useDeepLink,
  ShareLinkButton,
  usePinnedItems,
  PinButton,
  sortWithPins,
  // 10x Components Phase 2
  ApprovalNavigationProvider,
  useApprovalNavigation,
  KeyboardApprovalItem,
  ApprovalKeyboardHints,
  UndoProvider,
  useUndo,
  useApprovalGroups,
  ApprovalGroupSelector,
  ApprovalGroupView,
  type GroupBy,
  useTheme,
  ThemeToggle,
  NLFloatingBar,
  useNLExecutor,
  TimelineFilter,
  useFilteredTimeline,
  HealthIndicator,
  InlineGoalProgress,
  useGoalProgress,
  formatConfidencePercentage,
  type ExecutionModeFilterValue
} from "./ui";

type DashboardProps = {
  initialData: DashboardData;
  initialNotes: LocalNoteDocument[];
  initialCommitmentInbox: CommitmentInboxPage;
};

type WorkspaceGovernanceDraft = Omit<WorkspaceGovernance, "workspaceId" | "updatedBy" | "createdAt" | "updatedAt">;

function resolveClientGovernanceDefaults(): WorkspaceGovernanceDraft {
  const profile =
    process.env.NEXT_PUBLIC_AGENTIC_GOVERNANCE_DEFAULT_PROFILE ?? process.env.AGENTIC_GOVERNANCE_DEFAULT_PROFILE;
  if (profile?.trim().toLowerCase() !== "demo") {
    return enterpriseWorkspaceGovernanceDefaults;
  }

  return {
    approvalMode: "risk_based",
    requireAuditExports: true,
    maxAutoRunRiskClass: "R1",
    publicSharingEnabled: true,
    providerAccessRequiresApproval: true,
    escalationRequiresApproval: true,
    externalSendRequiresApproval: true,
    calendarWriteRequiresApproval: true,
    shadowReplayPolicy: defaultWorkspaceShadowReplayPolicy,
    retentionDays: 365
  };
}

function buildWorkspaceGovernanceDraft(governance: WorkspaceGovernance | null): WorkspaceGovernanceDraft {
  const defaults = resolveClientGovernanceDefaults();
  return {
    approvalMode: governance?.approvalMode ?? defaults.approvalMode,
    requireAuditExports: governance?.requireAuditExports ?? defaults.requireAuditExports,
    maxAutoRunRiskClass: governance?.maxAutoRunRiskClass ?? defaults.maxAutoRunRiskClass,
    publicSharingEnabled: governance?.publicSharingEnabled ?? defaults.publicSharingEnabled,
    providerAccessRequiresApproval:
      governance?.providerAccessRequiresApproval ?? defaults.providerAccessRequiresApproval,
    escalationRequiresApproval: governance?.escalationRequiresApproval ?? defaults.escalationRequiresApproval,
    externalSendRequiresApproval:
      governance?.externalSendRequiresApproval ?? defaults.externalSendRequiresApproval,
    calendarWriteRequiresApproval:
      governance?.calendarWriteRequiresApproval ?? defaults.calendarWriteRequiresApproval,
    shadowReplayPolicy: {
      enabled: governance?.shadowReplayPolicy?.enabled ?? defaults.shadowReplayPolicy.enabled,
      promotionMode:
        governance?.shadowReplayPolicy?.promotionMode ?? defaults.shadowReplayPolicy.promotionMode,
      rollbackOutcome:
        governance?.shadowReplayPolicy?.rollbackOutcome ?? defaults.shadowReplayPolicy.rollbackOutcome,
      minimumMatchedEpisodes:
        governance?.shadowReplayPolicy?.minimumMatchedEpisodes ?? defaults.shadowReplayPolicy.minimumMatchedEpisodes,
      minimumPrecision:
        governance?.shadowReplayPolicy?.minimumPrecision ?? defaults.shadowReplayPolicy.minimumPrecision,
      maximumNegativeOutcomeRate:
        governance?.shadowReplayPolicy?.maximumNegativeOutcomeRate ?? defaults.shadowReplayPolicy.maximumNegativeOutcomeRate,
      maximumFailureCostRate:
        governance?.shadowReplayPolicy?.maximumFailureCostRate ?? defaults.shadowReplayPolicy.maximumFailureCostRate
    },
    retentionDays: governance?.retentionDays ?? defaults.retentionDays
  };
}

const briefingTypeLabels: Record<BriefingType, string> = {
  startup: "Startup briefing",
  midday: "Midday drift check",
  pre_meeting: "Pre-meeting prep",
  end_of_day: "End-of-day closure",
  next_day: "Next-day setup"
};

const briefingFocusLabels: Record<BriefingPreferences["focus"], string> = {
  balanced: "Balanced",
  urgent: "Urgent",
  deep: "Deep work"
};

type ApprovalResponseOptions = {
  scope?: ApprovalDecisionScope;
  rationale?: string | null;
};

function getDashboardItemAnchorId(itemId: string): string {
  return `dashboard-item-${itemId}`;
}

function formatCommitmentUrgencyLabel(value: string): string {
  return value.replace(/_/gu, " ");
}

function isCommitmentInboxBucket(value: string | undefined): value is CommitmentInboxBucket {
  return value !== undefined && commitmentInboxBucketValues.includes(value as CommitmentInboxBucket);
}
const commitmentInboxSections: Array<{
  bucket: CommitmentInboxBucket;
  label: string;
}> = [
  { bucket: "unresolved", label: "Needs attention" },
  { bucket: "urgent", label: "Urgent" },
  { bucket: "due_soon", label: "Due soon" },
  { bucket: "waiting_on_others", label: "Waiting" },
  { bucket: "low_confidence", label: "Low confidence" },
  { bucket: "completed", label: "Completed" },
  { bucket: "all", label: "All" }
];

export function Dashboard(props: DashboardProps) {
  return (
    <UndoProvider>
      <DashboardContent {...props} />
    </UndoProvider>
  );
}

function DashboardContent({ initialData, initialNotes, initialCommitmentInbox }: DashboardProps) {
  const [data, setData] = useState(initialData);
  const [notes, setNotes] = useState(initialNotes);
  const [request, setRequest] = useState("");
  const [memoryContent, setMemoryContent] = useState("");
  const [memoryCategory, setMemoryCategory] = useState("working-style");
  const [noteQuery, setNoteQuery] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [selectedNoteSlug, setSelectedNoteSlug] = useState<string | null>(null);
  const [selectedNoteTitle, setSelectedNoteTitle] = useState("");
  const [selectedNoteContent, setSelectedNoteContent] = useState("");
  const [docsState, setDocsState] = useState<RequestState>({ kind: "idle", message: "" });
  const [submitState, setSubmitState] = useState<RequestState>({ kind: "idle", message: "" });
  const [shareState, setShareState] = useState<RequestState>({ kind: "idle", message: "" });
  const [noteState, setNoteState] = useState<RequestState>({ kind: "idle", message: "" });
  const [briefingState, setBriefingState] = useState<RequestState>({ kind: "idle", message: "" });
  const [autopilotState, setAutopilotState] = useState<RequestState>({ kind: "idle", message: "" });
  const [privacyState, setPrivacyState] = useState<RequestState>({ kind: "idle", message: "" });
  const [privacyInventoryState, setPrivacyInventoryState] = useState<RequestState>({ kind: "idle", message: "" });
  const [privacyControls, setPrivacyControls] = useState<PrivacyControlSummary | null>(null);
  const [isPending, setIsPending] = useState(false);
  const {
    lastShareUrl,
    pendingShareReview,
    shareGoal,
    confirmGoalShare,
    cancelGoalShareReview
  } = useGoalShareReview({ setData, setIsPending, setShareState });
  const [templates, setTemplates] = useState<GoalTemplate[]>([]);
  const [templateState, setTemplateState] = useState<RequestState>({ kind: "idle", message: "" });
  const [operatorProducts, setOperatorProducts] = useState<OperatorProduct[]>([]);
  const [operatorProductSelection, setOperatorProductSelection] = useState<OperatorProductSelection | null>(null);
  const [operatorProductAgents, setOperatorProductAgents] = useState<AgentDefinition[]>([]);
  const [operatorProductTemplates, setOperatorProductTemplates] = useState<GoalTemplate[]>([]);
  const [operatorProductState, setOperatorProductState] = useState<RequestState>({ kind: "idle", message: "" });
  const [refinementInputs, setRefinementInputs] = useState<Record<string, string>>({});
  const [refinementSourceByGoal, setRefinementSourceByGoal] = useState<Record<string, RecommendationRefinementSource>>({});
  const [refinementState, setRefinementState] = useState<RequestState>({ kind: "idle", message: "" });
  const [recommendationState, setRecommendationState] = useState<RequestState>({ kind: "idle", message: "" });
  const [recommendationResultsByGoal, setRecommendationResultsByGoal] = useState<Record<string, RecommendationLoadState>>({});
  const [recommendationPendingByGoal, setRecommendationPendingByGoal] = useState<Record<string, boolean>>({});
  const [slideOutPanel, setSlideOutPanel] = useState<{ type: string; data: unknown } | null>(null);
  const [showUnifiedFeed, setShowUnifiedFeed] = useState(true);
  const [showAdvancedOperations, setShowAdvancedOperations] = useState(false);
  const [commandCenterRole, setCommandCenterRole] = useState<CommandCenterRole>("command");
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(undefined);
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  const [commitmentBucket, setCommitmentBucket] = useState<CommitmentInboxBucket>(initialCommitmentInbox.bucket);
  const [commitmentInbox, setCommitmentInbox] = useState(initialCommitmentInbox);
  const [commitmentInboxState, setCommitmentInboxState] = useState<RequestState>({ kind: "idle", message: "" });
  const [approvalNotes, setApprovalNotes] = useState<Record<string, string>>({});
  const [executionModeFilter, setExecutionModeFilter] = useState<ExecutionModeFilterValue>("all");
  const [briefingPreferencesDraft, setBriefingPreferencesDraft] = useState<BriefingPreferences>(initialData.briefingPreferences);
  const [autopilotDraft, setAutopilotDraft] = useState<AutopilotSettings>(initialData.autopilotSettings);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceSlug, setWorkspaceSlug] = useState("");
  const [workspaceDescription, setWorkspaceDescription] = useState("");
  const [workspaceMemberUserId, setWorkspaceMemberUserId] = useState("");
  const [workspaceMemberRole, setWorkspaceMemberRole] = useState<(typeof workspaceRoleValues)[number]>("viewer");
  const [workspaceState, setWorkspaceState] = useState<RequestState>({ kind: "idle", message: "" });
  const [governanceState, setGovernanceState] = useState<RequestState>({ kind: "idle", message: "" });
  const [governanceDraft, setGovernanceDraft] = useState(() => buildWorkspaceGovernanceDraft(initialData.workspaceGovernance));
  const selectedNoteTitleRef = useRef("");
  const selectedNoteContentRef = useRef("");
  const commitmentInboxRequestIdRef = useRef(0);
  const recommendationQueriesRef = useRef<Record<string, string | null>>({});

  // 10x Dashboard Hooks - Phase 1
  const statsBar = useStatsBar(data);
  const smartDefaults = useSmartDefaults();
  const recentActions = useRecentActions();
  const focusMode = useFocusMode();
  const deepLink = useDeepLink();
  const pinnedItems = usePinnedItems();
  const theme = useTheme();
  
  // 10x Dashboard Hooks - Phase 2
  const undo = useUndo();
  const [approvalGroupBy, setApprovalGroupBy] = useState<GroupBy>("none");
  const timelineFilters = useFilteredTimeline(data.actionLogs);
  const pendingApprovals = useMemo(
    () => data.approvals.filter((approval) => approval.decision === "pending"),
    [data.approvals]
  );
  const goalBundleById = useMemo(
    () => new Map(data.goals.map((bundle) => [bundle.goal.id, bundle])),
    [data.goals]
  );
  const goalConfidenceById = useMemo(
    () => new Map(data.goals.map((bundle) => [bundle.goal.id, bundle.goal.confidence])),
    [data.goals]
  );
  const filteredGoalBundles = useMemo(
    () => data.goals.filter((bundle) => bundleMatchesExecutionModeFilter(bundle, executionModeFilter)),
    [data.goals, executionModeFilter]
  );
  const filteredPendingApprovals = useMemo(
    () =>
      pendingApprovals.filter((approval) =>
        approvalMatchesExecutionModeFilter(approval, goalBundleById.get(approval.goalId), executionModeFilter)
      ),
    [executionModeFilter, goalBundleById, pendingApprovals]
  );
  const filteredLatestArtifacts = useMemo(
    () =>
      data.latestArtifacts.filter((artifact) =>
        matchesExecutionModeFilter(extractArtifactExecutionMode(artifact), executionModeFilter)
      ),
    [data.latestArtifacts, executionModeFilter]
  );
  const approvalGroups = useApprovalGroups(filteredPendingApprovals, approvalGroupBy);
  const selectedExecutionModeFilter = getExecutionModeFilterOption(executionModeFilter);
  
  // NL Executor for dashboard commands
  const executeNlIntent = useCallback(
    async (intent: { type: "query" | "command" | "summary"; [key: string]: unknown }): Promise<NLIntentApiResponse> => {
      const payload = await readJson<NLIntentApiResponse>(
        await fetch("/api/nl/intent", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(intent.type === "command"
              ? {
                  "x-idempotency-key": buildClientIdempotencyKey()
                }
              : {})
          },
          body: JSON.stringify(intent)
        })
      );

      if (payload.statusUrl && payload.job?.kind === "goal_create") {
        const settled = await pollGoalJobUntilSettled(payload.statusUrl);

        if (!settled) {
          return {
            ...payload,
            message: "Goal queued and still processing. Refresh in a moment for the final bundle."
          };
        }

        if (settled.job.status === "dead_letter") {
          throw new Error(settled.error ?? "Goal creation failed.");
        }

        const snapshot = await loadDashboardSnapshot();
        startTransition(() => {
          setData(snapshot.dashboard);
          statsBar.updateSync();
        });

        return {
          ...payload,
          dashboard: snapshot.dashboard,
          message: "Created a new goal bundle."
        };
      }

      if (payload.statusUrl && payload.job?.kind === "briefing_create") {
        const settled = await pollBriefingJobUntilSettled(payload.statusUrl);

        if (!settled) {
          const label = payload.job.briefingType ? briefingTypeLabels[payload.job.briefingType] : "Briefing";
          return {
            ...payload,
            message: `${label} queued and still processing. Refresh in a moment for the final briefing.`
          };
        }

        if (settled.job.status === "dead_letter") {
          throw new Error(settled.error ?? "Briefing generation failed.");
        }

        const snapshot = await loadDashboardSnapshot();
        const label = payload.job.briefingType ? briefingTypeLabels[payload.job.briefingType] : "Briefing";
        startTransition(() => {
          setData(snapshot.dashboard);
          statsBar.updateSync();
        });

        return {
          ...payload,
          dashboard: snapshot.dashboard,
          message: `Generated ${label.toLowerCase()}.`
        };
      }

      if (payload.dashboard) {
        startTransition(() => {
          setData(payload.dashboard!);
          statsBar.updateSync();
        });
      }

      return payload;
    },
    [statsBar]
  );

  const nlExecutor = useNLExecutor({
    onQuery: async (target: string, filters?: Record<string, string>) => {
      return executeNlIntent({ type: "query", target, filters });
    },
    onCommand: async (action: string, params: Record<string, unknown>) => {
      return executeNlIntent({ type: "command", action, params });
    },
    onSummary: async (timeRange: string) => {
      return executeNlIntent({ type: "summary", timeRange });
    }
  });
  
  // Batch selection for approvals
  const approvalBatch = useBatchSelection(filteredPendingApprovals, "approval");
  const nlCapabilitySummary = useMemo(
    () =>
      buildNlCapabilitySummary({
        activeWorkspaceName: data.activeWorkspace?.name ?? null,
        approvals: data.approvals,
        integrations: data.integrations,
        workspaceGovernance: data.workspaceGovernance
      }),
    [data.activeWorkspace?.name, data.approvals, data.integrations, data.workspaceGovernance]
  );
  const readyIntegrationCount = useMemo(
    () => data.integrations.filter((integration) => integration.status === "ready").length,
    [data.integrations]
  );
  const resolvedFeatureCapabilities = useMemo(
    () =>
      resolveFeatureCapabilities({
        activeWorkspaceName: data.activeWorkspace?.name ?? null,
        watcherCount: data.watchers.filter((watcher) => watcher.status === "active").length,
        autopilotMode: data.autopilotSettings.mode,
        operations: data.operations
          ? {
              asyncExecutionStatus: data.operations.asyncExecution.status,
              asyncIssueCount: data.operations.asyncExecution.issueCount,
              connectorHealthStatus: data.operations.connectorHealth.status,
              connectorIssueCount: data.operations.connectorHealth.issueCount,
              autonomyPostureStatus: data.operations.autonomyPosture.status,
              hasOverridePaths: data.operations.autonomyPosture.overridePaths.length > 0
            }
          : null
      }),
    [data.activeWorkspace?.name, data.autopilotSettings.mode, data.operations, data.watchers]
  );
  const featureCapabilityReadiness = useMemo(
    () =>
      deriveFeatureCapabilityReadiness({
        autopilotSettings: data.autopilotSettings,
        autopilotEvents: data.autopilotEvents,
        watchers: data.watchers,
        diagnostics: data.diagnostics
      }),
    [data.autopilotEvents, data.autopilotSettings, data.diagnostics, data.watchers]
  );
  const featureCapabilitySummary = useMemo(
    () => summarizeFeatureCapabilities(featureCapabilityReadiness),
    [featureCapabilityReadiness]
  );
  const watcherCapability = useMemo(
    () => resolvedFeatureCapabilities.find((feature) => feature.id === "watchers") ?? null,
    [resolvedFeatureCapabilities]
  );
  const autopilotCapability = useMemo(
    () => resolvedFeatureCapabilities.find((feature) => feature.id === "autopilot-control") ?? null,
    [resolvedFeatureCapabilities]
  );
  const coreLoopSummary = useMemo(() => summarizeCoreLoopTelemetry(data), [data]);
  const coreLoopHealthCopy = useMemo(() => describeCoreLoopHealth(coreLoopSummary), [coreLoopSummary]);

  const selectedOperatorProduct = useMemo(
    () =>
      operatorProductSelection
        ? operatorProducts.find((product) => product.id === operatorProductSelection.operatorProductId) ?? null
        : null,
    [operatorProductSelection, operatorProducts]
  );

  const operatorProductTemplateLookup = templates.length > 0 ? templates : operatorProductTemplates;
  const commandCenterModel = useMemo(
    () =>
      buildDashboardCommandCenterModel({
        data,
        selectedOperatorProduct
      }),
    [data, selectedOperatorProduct]
  );

  const shareStatsByGoal = useMemo(
    () =>
      new Map(
        data.goals.map((bundle) => {
          const goalShares = data.goalShares.filter((share) => share.goalId === bundle.goal.id);

          return [
            bundle.goal.id,
            {
              total: goalShares.length,
              active: goalShares.filter((share) => share.status === "active").length,
              viewed: goalShares.filter((share) => share.lastViewedAt !== null).length
            }
          ];
        })
      ),
    [data.goalShares, data.goals]
  );
  const currentDashboardUserId =
    data.workspaceSelection?.userId ?? data.briefingPreferences.userId ?? data.autopilotSettings.userId ?? null;
  const canManageGoalShares = Boolean(data.activeWorkspace) && canManageGoalSharesForRole(data.operatingSections.roleView.role);
  const goalSharePermissionReason = data.activeWorkspace
    ? GOAL_SHARE_MUTATION_DENIED_REASON
    : "Select a workspace before managing public goal share links.";
  const resolveSharedWorkflowMutationState = useCallback(
    (
      workspaceId: string | null | undefined,
      operation: "refine_goal" | "manage_watchers" | "replay_dead_letter_job"
    ) => {
      const workspaceRole =
        resolveWorkspaceRoleForUser(data.workspaceMembers, workspaceId, currentDashboardUserId) ??
        (workspaceId === data.activeWorkspace?.id ? data.operatingSections.roleView.role : null);
      const allowed = canOperateSharedWorkflow({ workspaceId, role: workspaceRole });

      return {
        allowed,
        reason: allowed ? null : getSharedWorkflowDeniedReason(operation)
      };
    },
    [
      currentDashboardUserId,
      data.activeWorkspace?.id,
      data.operatingSections.roleView.role,
      data.workspaceMembers
    ]
  );
  const goalRefinementStateById = useMemo(
    () =>
      new Map(
        data.goals.map((bundle) => [
          bundle.goal.id,
          resolveSharedWorkflowMutationState(bundle.goal.workspaceId, "refine_goal")
        ])
      ),
    [data.goals, resolveSharedWorkflowMutationState]
  );
  const sharedJobReplayState = useMemo(
    () =>
      resolveSharedWorkflowMutationState(
        data.activeWorkspace && !data.activeWorkspace.isPersonal ? data.activeWorkspace.id : null,
        "replay_dead_letter_job"
      ),
    [data.activeWorkspace, resolveSharedWorkflowMutationState]
  );

  const reliabilityHealth = useMemo(() => {
    const status: "healthy" | "degraded" | "failing" =
      data.diagnostics.status === "critical"
        ? "failing"
        : data.diagnostics.status === "warning"
          ? "degraded"
          : "healthy";
    const score = data.diagnostics.status === "critical" ? 28 : data.diagnostics.status === "warning" ? 67 : 100;

    return {
      status,
      score,
      issues: data.diagnostics.items.map((item) => `${item.count} ${item.title.toLowerCase()}`),
      lastCheck: new Date(data.diagnostics.generatedAt)
    };
  }, [data.diagnostics]);

  const reliabilitySummary = useMemo(() => {
    if (data.diagnostics.totalCount === 0) {
      return "No reliability regressions are open across approvals, memory freshness, async execution, or connector health.";
    }

    return `${data.diagnostics.totalCount} reliability signal${data.diagnostics.totalCount === 1 ? "" : "s"} need attention.`;
  }, [data.diagnostics.totalCount]);

  const focusRequestComposer = useCallback(() => {
    document.querySelector<HTMLTextAreaElement>(".request-card textarea")?.focus();
  }, []);

  const scrollToSectionTarget = useCallback((section: string, itemId?: string) => {
    const itemElement = itemId ? document.getElementById(getDashboardItemAnchorId(itemId)) : null;
    const sectionElement = document.getElementById(`section-${section}`);
    const nextTarget = itemElement ?? sectionElement;

    if (!nextTarget) {
      return false;
    }

    nextTarget.scrollIntoView({ behavior: "smooth", block: "start" });

    if (itemId) {
      setHighlightedItemId(itemId);
    }

    return true;
  }, []);

  const navigateToSection = useCallback((section: string, itemId?: string) => {
    deepLink.openTarget(section, itemId);

    if (isAdvancedDashboardSection(section) && !showAdvancedOperations) {
      setShowAdvancedOperations(true);
      return;
    }

    scrollToSectionTarget(section, itemId);
  }, [deepLink, scrollToSectionTarget, showAdvancedOperations]);

  const openView = useCallback((section: string, itemId?: string, filter?: CommitmentInboxBucket | null) => {
    if (section === "commitments" && filter) {
      setCommitmentBucket(filter);
      deepLink.setFilter(filter);
    }

    navigateToSection(section, itemId);
  }, [deepLink, navigateToSection]);

  const openDiagnosticTarget = useCallback((target: DashboardDiagnosticTarget) => {
    navigateToSection(target.section, target.itemId);
  }, [navigateToSection]);

  useEffect(() => {
    if (!highlightedItemId) {
      return;
    }

    const timer = window.setTimeout(() => {
      setHighlightedItemId(null);
    }, 2500);

    return () => window.clearTimeout(timer);
  }, [highlightedItemId]);

  useEffect(() => {
    const section = deepLink.state.section;
    const item = deepLink.state.item;

    if (!section && !item) {
      return;
    }

    if (section && isAdvancedDashboardSection(section) && !showAdvancedOperations) {
      setShowAdvancedOperations(true);
      return;
    }

    const timer = window.setTimeout(() => {
      if (section) {
        scrollToSectionTarget(section, item);
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, [data, deepLink.state.item, deepLink.state.section, scrollToSectionTarget, showAdvancedOperations]);

  useEffect(() => {
    if (!isCommitmentInboxBucket(deepLink.state.filter) || deepLink.state.filter === commitmentBucket) {
      return;
    }

    setCommitmentBucket(deepLink.state.filter);
  }, [commitmentBucket, deepLink.state.filter]);

  useEffect(() => {
    setBriefingPreferencesDraft(data.briefingPreferences);
  }, [data.briefingPreferences]);

  useEffect(() => {
    setAutopilotDraft(data.autopilotSettings);
  }, [data.autopilotSettings]);

  useEffect(() => {
    setGovernanceDraft(buildWorkspaceGovernanceDraft(data.workspaceGovernance));
  }, [data.workspaceGovernance]);

  useEffect(() => {
    void loadOperatorProducts();
  }, []);

  useEffect(() => {
    let cancelled = false;

    for (const bundle of filteredGoalBundles.slice(0, 4)) {
      const query = buildGoalRecommendationQuery(bundle);
      const goalId = bundle.goal.id;

      if (!query) {
        recommendationQueriesRef.current[goalId] = null;
        setRecommendationResultsByGoal((prev) => {
          const existing = prev[goalId];

          if (existing?.status === "ready" && existing.query === null && existing.recommendations.length === 0 && existing.error === null) {
            return prev;
          }

          return {
            ...prev,
            [goalId]: {
              status: "ready",
              query: null,
              recommendations: [],
              policyPromotion: null,
              error: null
            }
          };
        });
        continue;
      }

      const queryString = query.toString();

      if (recommendationQueriesRef.current[goalId] === queryString) {
        continue;
      }

      recommendationQueriesRef.current[goalId] = queryString;
      setRecommendationResultsByGoal((prev) => ({
        ...prev,
        [goalId]: {
          status: "loading",
          query: queryString,
          recommendations: prev[goalId]?.recommendations ?? [],
          policyPromotion: prev[goalId]?.policyPromotion ?? null,
          error: null
        }
      }));

      void (async () => {
        try {
          const payload = await readJson<GoalRecommendationsApiResponse>(
            await fetch(`/api/memory/recommendations?${queryString}`, {
              cache: "no-store"
            })
          );

          if (cancelled) {
            return;
          }

          setRecommendationResultsByGoal((prev) => ({
            ...prev,
            [goalId]: {
              status: "ready",
              query: queryString,
              recommendations: payload.recommendations,
              policyPromotion: payload.policyPromotion,
              error: null
            }
          }));
        } catch (error) {
          if (cancelled) {
            return;
          }

          setRecommendationResultsByGoal((prev) => ({
            ...prev,
            [goalId]: {
              status: "error",
              query: queryString,
              recommendations: [],
              policyPromotion: null,
              error: error instanceof Error ? error.message : "Failed to load recommendation history."
            }
          }));
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [filteredGoalBundles]);
 
  useEffect(() => {
    setCommandCenterRole(getPreferredCommandCenterRole(selectedOperatorProduct));
  }, [selectedOperatorProduct]);

  const setSelectedNoteTitleDraft = (value: string) => {
    selectedNoteTitleRef.current = value;
    setSelectedNoteTitle(value);
  };

  const setSelectedNoteContentDraft = (value: string) => {
    selectedNoteContentRef.current = value;
    setSelectedNoteContent(value);
  };

  const loadSelectedNoteDraft = (note: LocalNoteDocument) => {
    setSelectedNoteSlug(note.slug);
    setSelectedNoteTitleDraft(note.title);
    setSelectedNoteContentDraft(note.content.replace(/^#\s+.*\n\n?/u, "").trim());
  };

  const clearSelectedNoteDraft = () => {
    setSelectedNoteSlug(null);
    setSelectedNoteTitleDraft("");
    setSelectedNoteContentDraft("");
  };

  // Unified Feed setup
  const unifiedFeedItems = useUnifiedFeed({
    goals: data.goals,
    approvals: data.approvals,
    artifacts: data.latestArtifacts,
    actionLogs: data.actionLogs,
    onApprove: (id) => respondApproval(id, "approved", { scope: "once" }),
    onReject: (id) => respondApproval(id, "rejected"),
    onViewGoal: (id) => deepLink.setItem(id, "goal"),
    onViewArtifact: (id) => deepLink.setItem(id, "artifact")
  });

  const refreshDashboard = useCallback(async (producer: Promise<Response>, successMessage: string) => {
    setIsPending(true);

    try {
      const payload = await readJson<{ dashboard: DashboardData }>(await producer);
      startTransition(() => {
        setData(payload.dashboard);
        setSubmitState({ kind: "success", message: successMessage });
        toast.success(successMessage);
        statsBar.updateSync();
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unexpected request failure.";
      setSubmitState({
        kind: "error",
        message: errorMessage
      });
      toast.error("Action failed", errorMessage);
    } finally {
      setIsPending(false);
    }
  }, [statsBar]);

  const loadDashboardSnapshot = useCallback(async () => {
    return fetchDashboardSnapshot();
  }, []);

  const loadPrivacyControls = useCallback(async () => {
    try {
      const payload = await readJson<PrivacyControlsApiResponse>(
        await fetch("/api/governance/privacy", {
          cache: "no-store"
        })
      );

      startTransition(() => {
        setPrivacyControls(payload.controls);
        setPrivacyInventoryState({
          kind: "success",
          message: `Registry v${payload.controls.registryVersion} reviewed ${payload.controls.reviewedAt}.`
        });
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to load privacy controls.";

      setPrivacyControls(null);
      setPrivacyInventoryState({
        kind: "error",
        message: errorMessage
      });
    }
  }, []);

  useEffect(() => {
    void loadPrivacyControls();
  }, [loadPrivacyControls]);

  const loadTemplatesSnapshot = useCallback(async () => {
    return fetchTemplatesSnapshot();
  }, []);

  const pollGoalJobUntilSettled = useCallback((statusUrl: string) => {
    return pollJobStatusUntilSettled<GoalJobStatusApiResponse>(statusUrl);
  }, []);

  const pollBriefingJobUntilSettled = useCallback((statusUrl: string) => {
    return pollJobStatusUntilSettled<BriefingJobStatusApiResponse>(statusUrl);
  }, []);

  const pollTemplateRunJobUntilSettled = useCallback((statusUrl: string) => {
    return pollJobStatusUntilSettled<TemplateRunJobStatusApiResponse>(statusUrl);
  }, []);

  const pollDocsRenderJobUntilSettled = useCallback((statusUrl: string) => {
    return pollJobStatusUntilSettled<DocsRenderJobStatusApiResponse>(statusUrl);
  }, []);

  const submitRecommendationFeedback = useCallback(
    async (goalId: string, recommendation: WorkflowRecommendation, decision: "accepted" | "edited" | "rejected" | "ignored", goalTitle: string) => {
      setRecommendationPendingByGoal((prev) => ({ ...prev, [goalId]: true }));

      try {
        const payload = await readJson<RecommendationFeedbackApiResponse>(
          await fetch(`/api/goals/${goalId}/recommendations/feedback`, {
            method: "POST",
            headers: {
              "content-type": "application/json"
            },
            body: JSON.stringify(buildRecommendationFeedbackPayload(recommendation, decision))
          })
        );

        startTransition(() => {
          setData(payload.dashboard);
          statsBar.updateSync();
        });

        if (decision === "edited") {
          const sourceRecommendation = buildRecommendationRefinementSource(recommendation, goalTitle);

          setRefinementInputs((prev) => ({
            ...prev,
            [goalId]: sourceRecommendation.suggestedMessage
          }));
          setRefinementSourceByGoal((prev) => ({
            ...prev,
            [goalId]: sourceRecommendation
          }));
        }

        const successMessage = payload.message;
        setRecommendationState({ kind: "success", message: successMessage });
        toast.success(successMessage);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to record recommendation feedback.";
        setRecommendationState({ kind: "error", message: errorMessage });
        toast.error("Recommendation feedback failed", errorMessage);
      } finally {
        setRecommendationPendingByGoal((prev) => ({ ...prev, [goalId]: false }));
      }
    },
    [statsBar]
  );

  const submitGoalRequest = useCallback(async (nextRequest: string, agentId?: string) => {
    setIsPending(true);

    try {
      const queued = await readJson<GoalQueuedApiResponse>(
        await fetch("/api/goals", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-idempotency-key": buildClientIdempotencyKey()
          },
          body: JSON.stringify({
            request: nextRequest,
            agentId: agentId || undefined
          })
        })
      );
      const settled = await pollGoalJobUntilSettled(queued.statusUrl);

      if (!settled) {
        const timeoutMessage = "Goal queued and still processing. Refresh in a moment for the final bundle.";
        setSubmitState({ kind: "success", message: timeoutMessage });
        toast.success(timeoutMessage);
        return;
      }

      if (settled.job.status === "dead_letter") {
        throw new Error(settled.error ?? "Goal creation failed.");
      }

      const payload = await loadDashboardSnapshot();
      startTransition(() => {
        setData(payload.dashboard);
        setSubmitState({ kind: "success", message: "Created a new goal bundle." });
        toast.success("Created a new goal bundle.");
        statsBar.updateSync();
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unexpected request failure.";
      setSubmitState({
        kind: "error",
        message: errorMessage
      });
      toast.error("Action failed", errorMessage);
    } finally {
      setIsPending(false);
    }
  }, [loadDashboardSnapshot, pollGoalJobUntilSettled, statsBar]);

  const loadCommitmentInbox = useCallback(async (
    bucket: CommitmentInboxBucket,
    options?: { cursor?: string | null; append?: boolean; quiet?: boolean }
  ) => {
    const requestId = ++commitmentInboxRequestIdRef.current;

    if (!options?.quiet) {
      setCommitmentInboxState({ kind: "idle", message: "" });
    }

    try {
      const searchParams = new URLSearchParams({
        bucket,
        limit: String(DEFAULT_COMMITMENT_INBOX_LIMIT)
      });

      if (options?.cursor) {
        searchParams.set("cursor", options.cursor);
      }

      const payload = await readJson<{ inbox: CommitmentInboxPage }>(
        await fetch(`/api/commitments?${searchParams.toString()}`, {
          cache: "no-store"
        })
      );

      if (requestId !== commitmentInboxRequestIdRef.current) {
        return;
      }

      startTransition(() => {
        setCommitmentInbox((current) => (
          options?.append
            ? {
                ...payload.inbox,
                items: [...current.items, ...payload.inbox.items]
              }
            : payload.inbox
        ));
        setCommitmentInboxState({ kind: "idle", message: "" });
      });
    } catch (error) {
      if (requestId !== commitmentInboxRequestIdRef.current) {
        return;
      }

      const errorMessage = error instanceof Error ? error.message : "Failed to load commitments inbox.";
      setCommitmentInboxState({
        kind: "error",
        message: errorMessage
      });
      toast.error("Commitments inbox failed", errorMessage);
    }
  }, []);

  useEffect(() => {
    void loadCommitmentInbox(commitmentBucket, { quiet: true });
  }, [commitmentBucket, data.commitments, loadCommitmentInbox]);

  const updateMemory = useCallback(async (memoryId: string, action: "review" | "confirm") => {
    await refreshDashboard(
      fetch(`/api/memory/${memoryId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ action })
      }),
      action === "confirm" ? "Confirmed memory." : "Reviewed memory."
    );
  }, [refreshDashboard]);

  const updateWatcher = useCallback(async (watcherId: string, action: "pause" | "resume") => {
    await refreshDashboard(
      fetch(`/api/watchers/${watcherId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ action })
      }),
      action === "pause" ? "Paused watcher." : "Resumed watcher."
    );
  }, [refreshDashboard]);

  const updateCommitment = useCallback(async (
    commitmentId: string,
    updatedAt: string,
    action: "complete" | "dismiss" | "reopen"
  ) => {
    await refreshDashboard(
      fetch(`/api/commitments/${commitmentId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "if-match": `"${updatedAt}"`
        },
        body: JSON.stringify({ action })
      }),
      action === "complete"
        ? "Completed commitment."
        : action === "dismiss"
          ? "Dismissed commitment."
          : "Reopened commitment."
    );
  }, [refreshDashboard]);

  const loadMoreCommitments = useCallback(async () => {
    if (!commitmentInbox.nextCursor) {
      return;
    }

    await loadCommitmentInbox(commitmentBucket, {
      cursor: commitmentInbox.nextCursor,
      append: true
    });
  }, [commitmentBucket, commitmentInbox.nextCursor, loadCommitmentInbox]);

  const runDiagnosticAction = useCallback(async (target: DashboardDiagnosticTarget) => {
    if (!target.itemId || !target.action) {
      return;
    }

    switch (target.action) {
      case "review_memory":
        await updateMemory(target.itemId, "review");
        return;
      case "pause_watcher":
        await updateWatcher(target.itemId, "pause");
        return;
      default:
        return;
    }
  }, [updateMemory, updateWatcher]);

  const createWorkspace = useCallback(async () => {
    const name = workspaceName.trim();
    const slug = workspaceSlug.trim();
    const description = workspaceDescription.trim();

    if (!name) {
      setWorkspaceState({ kind: "error", message: "Workspace name cannot be empty." });
      return;
    }

    await refreshDashboard(
      fetch("/api/workspaces", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          action: "create",
          name,
          ...(slug ? { slug } : {}),
          ...(description ? { description } : {})
        })
      }),
      "Created workspace."
    );
    setWorkspaceName("");
    setWorkspaceSlug("");
    setWorkspaceDescription("");
    setWorkspaceState({ kind: "success", message: "Created workspace." });
  }, [refreshDashboard, workspaceDescription, workspaceName, workspaceSlug]);

  const selectWorkspace = useCallback(async (workspaceId: string) => {
    await refreshDashboard(
      fetch("/api/workspaces", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          action: "select",
          workspaceId
        })
      }),
      "Switched workspace."
    );
    setWorkspaceState({ kind: "success", message: "Switched workspace." });
  }, [refreshDashboard]);

  const addWorkspaceMember = useCallback(async () => {
    const activeWorkspaceId = data.activeWorkspace?.id;
    const userId = workspaceMemberUserId.trim();

    if (!activeWorkspaceId) {
      setWorkspaceState({ kind: "error", message: "Select a workspace before adding members." });
      return;
    }

    if (!userId) {
      setWorkspaceState({ kind: "error", message: "Workspace member userId cannot be empty." });
      return;
    }

    await refreshDashboard(
      fetch("/api/workspaces", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          action: "add_member",
          workspaceId: activeWorkspaceId,
          userId,
          role: workspaceMemberRole
        })
      }),
      "Added workspace member."
    );
    setWorkspaceMemberUserId("");
    setWorkspaceState({ kind: "success", message: "Added workspace member." });
  }, [data.activeWorkspace?.id, refreshDashboard, workspaceMemberRole, workspaceMemberUserId]);

  const saveWorkspaceGovernance = useCallback(async () => {
    if (!data.activeWorkspace) {
      setGovernanceState({ kind: "error", message: "Select a workspace before saving governance." });
      return;
    }

    await refreshDashboard(
      fetch("/api/governance", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(governanceDraft)
      }),
      "Saved workspace governance."
    );
    setGovernanceState({ kind: "success", message: "Saved workspace governance." });
  }, [data.activeWorkspace, governanceDraft, refreshDashboard]);

  const exportWorkspaceAudit = useCallback(async () => {
    setIsPending(true);

    try {
      const response = await fetch("/api/governance/audit");

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Failed to export workspace audit." }));
        const message = typeof payload?.error === "string" ? payload.error : "Failed to export workspace audit.";
        throw new Error(message);
      }

      const blob = await response.blob();
      const fileNameMatch = response.headers.get("content-disposition")?.match(/filename=\"([^\"]+)\"/i);
      const fileName = fileNameMatch?.[1] ?? "workspace-audit.json";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");

      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      setGovernanceState({ kind: "success", message: "Exported workspace audit." });
      toast.success("Exported workspace audit.");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to export workspace audit.";
      setGovernanceState({ kind: "error", message: errorMessage });
      toast.error("Action failed", errorMessage);
    } finally {
      setIsPending(false);
    }
  }, []);

  const runPrivacyOperation = useCallback(async (kind: (typeof privacyOperationKindValues)[number]) => {
    setIsPending(true);

    try {
      const payload = await readJson<{ operation: { id: string; status: string }; reused: boolean; dashboard: DashboardData }>(
        await fetch("/api/governance/privacy", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({ kind })
        })
      );
      const actionLabel =
        kind === "retention_enforcement"
          ? "retention enforcement"
          : kind === "workspace_export"
            ? "workspace export"
            : "workspace deletion";

      startTransition(() => {
        setData(payload.dashboard);
        setPrivacyState({
          kind: "success",
          message: payload.reused
            ? `Reused the in-flight ${actionLabel} operation.`
            : `Queued ${actionLabel}.`
        });
        statsBar.updateSync();
      });
      toast.success(payload.reused ? "Reused privacy operation." : "Queued privacy operation.");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to queue privacy operation.";
      setPrivacyState({ kind: "error", message: errorMessage });
      toast.error("Action failed", errorMessage);
    } finally {
      setIsPending(false);
    }
  }, [statsBar]);

  const revokeGoalShare = useCallback(async (goalId: string, shareId: string, title: string) => {
    setIsPending(true);

    try {
      const payload = await readJson<{ dashboard: DashboardData }>(
        await fetch(`/api/goals/${encodeURIComponent(goalId)}/share`, {
          method: "DELETE",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({ shareId })
        })
      );

      startTransition(() => {
        setData(payload.dashboard);
        setShareState({
          kind: "success",
          message: `Revoked the public share link for ${title}.`
        });
        statsBar.updateSync();
      });
      toast.success("Revoked share link.");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to revoke the public share link.";
      setShareState({ kind: "error", message: errorMessage });
      toast.error("Action failed", errorMessage);
    } finally {
      setIsPending(false);
    }
  }, [statsBar]);

  const updateBriefingScheduleDraft = useCallback(
    (type: BriefingType, patch: Partial<BriefingPreferences["schedules"][number]>) => {
      setBriefingPreferencesDraft((current) => ({
        ...current,
        schedules: current.schedules.map((schedule) =>
          schedule.type === type ? { ...schedule, ...patch } : schedule
        )
      }));
    },
    []
  );

  const saveBriefingPreferences = useCallback(async () => {
    setIsPending(true);

    try {
      const payload = await readJson<{ preferences: BriefingPreferences; dashboard: DashboardData }>(
        await fetch("/api/briefing/schedule", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            timezone: briefingPreferencesDraft.timezone.trim(),
            focus: briefingPreferencesDraft.focus,
            schedules: briefingPreferencesDraft.schedules.map((schedule) => ({
              type: schedule.type,
              enabled: schedule.enabled,
              time: schedule.time
            }))
          })
        })
      );

      startTransition(() => {
        setData(payload.dashboard);
        setBriefingPreferencesDraft(payload.preferences);
        setBriefingState({ kind: "success", message: "Saved briefing preferences." });
        toast.success("Saved briefing preferences.");
        statsBar.updateSync();
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to save briefing preferences.";
      setBriefingState({ kind: "error", message: errorMessage });
      toast.error("Action failed", errorMessage);
    } finally {
      setIsPending(false);
    }
  }, [briefingPreferencesDraft, statsBar]);

  const saveAutopilotSettings = useCallback(async () => {
    setIsPending(true);

    try {
      const payload = await readJson<{ settings: AutopilotSettings; dashboard: DashboardData }>(
        await fetch("/api/autopilot/settings", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            mode: autopilotDraft.mode,
            debounceMinutes: autopilotDraft.debounceMinutes
          })
        })
      );

      startTransition(() => {
        setData(payload.dashboard);
        setAutopilotDraft(payload.settings);
        setAutopilotState({ kind: "success", message: "Saved autopilot settings." });
        toast.success("Saved autopilot settings.");
        statsBar.updateSync();
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to save autopilot settings.";
      setAutopilotState({ kind: "error", message: errorMessage });
      toast.error("Action failed", errorMessage);
    } finally {
      setIsPending(false);
    }
  }, [autopilotDraft, statsBar]);

  const approveAllR2 = async () => {
    const r2Approvals = pendingApprovals.filter((a) => a.riskClass === "R2");
    if (r2Approvals.length === 0) {
      toast.info("No R2 approvals pending");
      return;
    }

    setIsPending(true);
    let approved = 0;

    for (const approval of r2Approvals) {
      try {
        await fetch(`/api/approvals/${approval.id}/respond`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision: "approved", scope: "once" })
        });
        approved++;
      } catch {
        // Continue with other approvals
      }
    }

    // Refresh dashboard
    try {
      const payload = await readJson<{ dashboard: DashboardData }>(await fetch("/api/goals"));
      startTransition(() => {
        setData(payload.dashboard);
      });
    } catch {
      // Ignore refresh errors
    }

    setIsPending(false);
    toast.success(`Approved ${approved} R2 items`);
  };

  const createGoal = async () => {
    const nextRequest = request.trim();

    if (!nextRequest) {
      setSubmitState({ kind: "error", message: "Enter a request before submitting." });
      return;
    }

    // Track goal prefix for smart defaults
    smartDefaults.recordGoalPrefix(nextRequest);
    await submitGoalRequest(nextRequest, selectedAgentId);
    setRequest("");
    setSelectedAgentId(undefined); // Reset agent selection
    
    // Track recent action
    recentActions.addAction({
      type: "create",
      label: nextRequest.slice(0, 30),
      undoable: false
    });
  };

  const generateBriefing = async (type: BriefingType = "startup") => {
    const label = briefingTypeLabels[type];

    setIsPending(true);

    try {
      const queued = await readJson<BriefingCreateApiResponse>(
        await fetch("/api/briefing", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-idempotency-key": buildClientIdempotencyKey()
          },
          body: JSON.stringify({ type })
        })
      );
      const settled = await pollBriefingJobUntilSettled(queued.statusUrl);

      if (!settled) {
        const timeoutMessage = `${label} queued and still processing. Refresh in a moment for the final briefing.`;
        setBriefingState({ kind: "success", message: timeoutMessage });
        toast.success(timeoutMessage);
        return;
      }

      if (settled.job.status === "dead_letter") {
        throw new Error(settled.error ?? "Briefing generation failed.");
      }

      const payload = await loadDashboardSnapshot();
      startTransition(() => {
        setData(payload.dashboard);
        setBriefingState({ kind: "success", message: `Generated ${label.toLowerCase()}.` });
        toast.success(`Generated ${label.toLowerCase()}.`);
        statsBar.updateSync();
      });
      recentActions.addAction({
        type: "create",
        label,
        undoable: false
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to generate briefing.";
      setBriefingState({ kind: "error", message: errorMessage });
      toast.error("Action failed", errorMessage);
    } finally {
      setIsPending(false);
    }
  };

  const getApprovalNote = useCallback((approvalId: string) => {
    const nextNote = approvalNotes[approvalId]?.trim();
    return nextNote ? nextNote : null;
  }, [approvalNotes]);

  const respondApproval = async (
    approvalId: string,
    decision: "approved" | "rejected",
    options: ApprovalResponseOptions = {}
  ) => {
    const approval = data.approvals.find((a) => a.id === approvalId);
    const scope = options.scope ?? (decision === "approved" ? "once" : undefined);
    const rationale = options.rationale ?? getApprovalNote(approvalId);
    await refreshDashboard(
      fetch(`/api/approvals/${approvalId}/respond`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          decision,
          ...(scope ? { scope } : {}),
          ...(rationale ? { rationale } : {})
        })
      }),
      `Marked the approval as ${decision}.`
    );
    setApprovalNotes((prev) => {
      if (!(approvalId in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[approvalId];
      return next;
    });
    // Track recent action
    recentActions.addAction({
      type: decision === "approved" ? "approve" : "reject",
      label: approval?.title?.slice(0, 30) || "Approval",
      undoable: false
    });
  };

  // Batch approve selected approvals
  const batchApproveSelected = async () => {
    if (approvalBatch.selectedCount === 0) return;
    
    setIsPending(true);
    let count = 0;
    
    for (const approval of approvalBatch.selectedItems) {
      try {
        await fetch(`/api/approvals/${approval.id}/respond`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision: "approved", scope: "once" })
        });
        count++;
      } catch {
        // Continue with others
      }
    }
    
    try {
      const payload = await readJson<{ dashboard: DashboardData }>(
        await fetch("/api/goals")
      );
      setData(payload.dashboard);
    } catch {
      // Ignore
    }
    
    setIsPending(false);
    approvalBatch.deselectAll();
    toast.success(`Approved ${count} items`);
    recentActions.addAction({
      type: "approve",
      label: `${count} approvals`,
      undoable: false
    });
  };

  const refineGoal = async (goalId: string) => {
    const message = (refinementInputs[goalId] ?? "").trim();
    const sourceRecommendation = refinementSourceByGoal[goalId];

    if (!message) {
      setRefinementState({ kind: "error", message: "Enter a refinement message before submitting." });
      return;
    }

    setIsPending(true);
    setRefinementState({ kind: "idle", message: "" });

    try {
      const queued = await readJson<GoalQueuedApiResponse>(
        await fetch(`/api/goals/${encodeURIComponent(goalId)}/refine`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-idempotency-key": buildClientIdempotencyKey()
          },
          body: JSON.stringify({
            message,
            ...(sourceRecommendation ? { sourceRecommendation } : {})
          })
        })
      );
      const settled = await pollGoalJobUntilSettled(queued.statusUrl);

      if (!settled) {
        const timeoutMessage = "Goal refinement queued and still processing. Refresh in a moment for the updated bundle.";
        setRefinementState({ kind: "success", message: timeoutMessage });
        toast.success(timeoutMessage);
        return;
      }

      if (settled.job.status === "dead_letter") {
        throw new Error(settled.error ?? "Goal refinement failed.");
      }

      const snapshot = await loadDashboardSnapshot();
      startTransition(() => {
        setData(snapshot.dashboard);
        setRefinementInputs((prev) => ({ ...prev, [goalId]: "" }));
        setRefinementSourceByGoal((prev) => {
          const { [goalId]: _removed, ...rest } = prev;
          return rest;
        });
        setRefinementState({ kind: "success", message: "Goal refined successfully." });
        toast.success("Goal refined successfully.");
        statsBar.updateSync();
      });
    } catch (error) {
      setRefinementState({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to refine goal."
      });
      toast.error("Action failed", error instanceof Error ? error.message : "Failed to refine goal.");
    } finally {
      setIsPending(false);
    }
  };

  const saveMemory = async () => {
    const content = memoryContent.trim();

    if (!content) {
      setSubmitState({ kind: "error", message: "Memory content cannot be empty." });
      return;
    }

    // Track category for smart defaults
    smartDefaults.recordMemoryCategory(memoryCategory);

    await refreshDashboard(
      fetch("/api/memory", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          category: memoryCategory,
          content
        })
      }),
      "Saved the memory record."
    );
    setMemoryContent("");
    
    recentActions.addAction({
      type: "save",
      label: `Memory: ${memoryCategory}`,
      undoable: false
    });
  };

  const cycleIntegration = async (integrationId: string, currentStatus: string) => {
    const statusOrder = ["ready", "manual", "mock", "disabled"] as const;
    const currentIndex = Math.max(statusOrder.indexOf(currentStatus as (typeof statusOrder)[number]), 0);
    const nextStatus = statusOrder[(currentIndex + 1) % statusOrder.length];

    await refreshDashboard(
      fetch("/api/integrations", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          id: integrationId,
          status: nextStatus
        })
      }),
      `Updated integration ${integrationId} to ${nextStatus}.`
    );
  };

  const connectGoogleProvider = () => {
    window.location.assign("/api/integrations/google/connect");
  };

  const renderDocs = async () => {
    setIsPending(true);
    setDocsState({ kind: "idle", message: "" });

    try {
      const queued = await readJson<DocsRenderApiResponse>(
        await fetch("/api/docs/render", {
          method: "POST",
          headers: {
            "x-idempotency-key": buildClientIdempotencyKey()
          }
        })
      );
      const settled = await pollDocsRenderJobUntilSettled(queued.statusUrl);

      if (!settled) {
        const timeoutMessage = "Document build queued and still processing. Refresh in a moment for the final result.";
        setDocsState({ kind: "success", message: timeoutMessage });
        toast.success(timeoutMessage);
        return;
      }

      if (settled.job.status === "dead_letter") {
        throw new Error(settled.error ?? "The document build failed.");
      }

      startTransition(() => {
        setDocsState({
          kind: "success",
          message: settled.result?.message ?? "Rendered and validated build/agentic.docx."
        });
      });
    } catch (error) {
      setDocsState({
        kind: "error",
        message: error instanceof Error ? error.message : "The document build failed."
      });
    } finally {
      setIsPending(false);
    }
  };

  const createLocalNote = async () => {
    const title = noteTitle.trim();
    const content = noteContent.trim();

    if (!title || !content) {
      setSubmitState({ kind: "error", message: "A local note needs both a title and content." });
      return;
    }

    setIsPending(true);

    try {
      const payload = await readJson<{ note: LocalNoteDocument; notes: LocalNoteDocument[]; dashboard: DashboardData }>(
        await fetch("/api/integrations/local-notes", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            title,
            content
          })
        })
      );
      startTransition(() => {
        setNotes(payload.notes);
        setData(payload.dashboard);
        setSubmitState({ kind: "success", message: "Created a new local note." });
        loadSelectedNoteDraft(payload.note);
        setNoteState({ kind: "success", message: "Opened the new note in the editor." });
      });
      setNoteTitle("");
      setNoteContent("");
    } catch (error) {
      setSubmitState({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to create the local note."
      });
    } finally {
      setIsPending(false);
    }
  };

  const searchNotes = async () => {
    setIsPending(true);

    try {
      const query = noteQuery.trim();
      const params = query ? `?q=${encodeURIComponent(query)}` : "";
      const payload = await readJson<{ notes: LocalNoteDocument[] }>(
        await fetch(`/api/integrations/local-notes${params}`, {
          cache: "no-store"
        })
      );

      startTransition(() => {
        setNotes(payload.notes);

        if (selectedNoteSlug && !payload.notes.some((note) => note.slug === selectedNoteSlug)) {
          clearSelectedNoteDraft();
        }

        setNoteState({
          kind: "success",
          message: query ? `Loaded ${payload.notes.length} matching note${payload.notes.length === 1 ? "" : "s"}.` : "Loaded all local notes."
        });
      });
    } catch (error) {
      setNoteState({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to search local notes."
      });
    } finally {
      setIsPending(false);
    }
  };

  const openLocalNote = async (slug: string) => {
    setIsPending(true);

    try {
      const payload = await readJson<{ note: LocalNoteDocument }>(
        await fetch(`/api/integrations/local-notes/${encodeURIComponent(slug)}`, {
          cache: "no-store"
        })
      );

      startTransition(() => {
        loadSelectedNoteDraft(payload.note);
        setNoteState({ kind: "success", message: `Loaded note "${payload.note.title}".` });
      });
    } catch (error) {
      setNoteState({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to load the selected note."
      });
    } finally {
      setIsPending(false);
    }
  };

  const saveSelectedNote = async () => {
    const slug = selectedNoteSlug;
    const title = selectedNoteTitleRef.current.trim();
    const content = selectedNoteContentRef.current.trim();

    if (!slug) {
      setNoteState({ kind: "error", message: "Choose a note before saving changes." });
      return;
    }

    if (!title || !content) {
      setNoteState({ kind: "error", message: "A saved note needs both a title and content." });
      return;
    }

    setIsPending(true);

    try {
      const payload = await readJson<{ note: LocalNoteDocument; notes: LocalNoteDocument[]; dashboard: DashboardData }>(
        await fetch(`/api/integrations/local-notes/${encodeURIComponent(slug)}`, {
          method: "PUT",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            title,
            content
          })
        })
      );

      startTransition(() => {
        setNotes(payload.notes);
        setData(payload.dashboard);
        loadSelectedNoteDraft(payload.note);
        setNoteState({ kind: "success", message: `Saved note "${payload.note.title}".` });
      });
    } catch (error) {
      setNoteState({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to save the selected note."
      });
    } finally {
      setIsPending(false);
    }
  };

  const loadTemplates = async () => {
    setIsPending(true);

    try {
      const payload = await readJson<{ templates: GoalTemplate[] }>(await fetch("/api/templates"));
      startTransition(() => {
        setTemplates(payload.templates);
        setTemplateState({ kind: "success", message: `Loaded ${payload.templates.length} template${payload.templates.length === 1 ? "" : "s"}.` });
      });
    } catch (error) {
      setTemplateState({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to load templates."
      });
    } finally {
      setIsPending(false);
    }
  };

  const loadOperatorProducts = useCallback(async () => {
    setIsPending(true);

    try {
      const payload = await readJson<OperatorProductPayload>(await fetch("/api/operator-products"));
      startTransition(() => {
        setOperatorProducts(payload.products);
        setOperatorProductSelection(payload.selection);
        setOperatorProductAgents(payload.agents);
        setOperatorProductTemplates(payload.templates);
        setOperatorProductState({
          kind: "success",
          message: `Loaded ${payload.products.length} operator product${payload.products.length === 1 ? "" : "s"}.`
        });
      });
    } catch (error) {
      setOperatorProductState({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to load operator products."
      });
    } finally {
      setIsPending(false);
    }
  }, []);

  const selectOperatorProduct = async (operatorProductId: string) => {
    setIsPending(true);

    try {
      const payload = await readJson<OperatorProductPayload>(
        await fetch("/api/operator-products", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ operatorProductId })
        })
      );
      const nextSelectedProduct = payload.products.find((product) => product.id === payload.selection?.operatorProductId);

      startTransition(() => {
        setOperatorProducts(payload.products);
        setOperatorProductSelection(payload.selection);
        setOperatorProductAgents(payload.agents);
        setOperatorProductTemplates(payload.templates);
        setOperatorProductState({
          kind: "success",
          message: nextSelectedProduct ? `Selected ${nextSelectedProduct.name}.` : "Updated operator product."
        });
      });
    } catch (error) {
      setOperatorProductState({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to update operator product."
      });
    } finally {
      setIsPending(false);
    }
  };

  const saveAsTemplate = async (goalTitle: string, goalRequest: string) => {
    setIsPending(true);

    try {
      const payload = await readJson<{ template: GoalTemplate; dashboard: DashboardData }>(
        await fetch("/api/templates", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: goalTitle, request: goalRequest })
        })
      );
      startTransition(() => {
        setData(payload.dashboard);
        setTemplates((prev) => [payload.template, ...prev]);
        setTemplateState({ kind: "success", message: `Saved "${goalTitle}" as a template.` });
      });
    } catch (error) {
      setTemplateState({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to save template."
      });
    } finally {
      setIsPending(false);
    }
  };

  const runTemplate = async (templateId: string) => {
    setIsPending(true);

    try {
      const queued = await readJson<TemplateRunApiResponse>(
        await fetch(`/api/templates/${encodeURIComponent(templateId)}/run`, {
          method: "POST",
          headers: {
            "x-idempotency-key": buildClientIdempotencyKey()
          }
        })
      );
      const settled = await pollTemplateRunJobUntilSettled(queued.statusUrl);

      if (!settled) {
        const timeoutMessage = "Template queued and still processing. Refresh in a moment for the final bundle.";
        setTemplateState({ kind: "success", message: timeoutMessage });
        toast.success(timeoutMessage);
        return;
      }

      if (settled.job.status === "dead_letter") {
        throw new Error(settled.error ?? "Template execution failed.");
      }

      const [dashboardPayload, templatesPayload] = await Promise.all([
        loadDashboardSnapshot(),
        loadTemplatesSnapshot()
      ]);

      startTransition(() => {
        setData(dashboardPayload.dashboard);
        setTemplates(templatesPayload.templates);
        setTemplateState({ kind: "success", message: "Template executed successfully." });
        toast.success("Template executed successfully.");
        statsBar.updateSync();
      });
    } catch (error) {
      setTemplateState({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to run template."
      });
      toast.error("Action failed", error instanceof Error ? error.message : "Failed to run template.");
    } finally {
      setIsPending(false);
    }
  };

  const deleteTemplate = async (templateId: string, updatedAt: string) => {
    setIsPending(true);

    try {
      const payload = await readJson<{ deleted: string; dashboard: DashboardData }>(
        await fetch(`/api/templates/${encodeURIComponent(templateId)}`, {
          method: "DELETE",
          headers: {
            "if-match": `"${updatedAt}"`
          }
        })
      );
      startTransition(() => {
        setData(payload.dashboard);
        setTemplates((prev) => prev.filter((t) => t.id !== templateId));
        setTemplateState({ kind: "success", message: "Template deleted." });
      });
    } catch (error) {
      setTemplateState({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to delete template."
      });
    } finally {
      setIsPending(false);
    }
  };

  const logout = () => {
    setIsPending(true);
    window.location.assign("/logout");
  };

  // Quick actions for the floating bar
  const quickActions = [
    {
      id: "create-goal",
      label: "New Request",
      icon: <span>+</span>,
      onClick: focusRequestComposer,
      shortcut: "N",
      variant: "primary" as const
    },
    {
      id: "approve-r2",
      label: "Approve R2",
      icon: <span>✓</span>,
      onClick: approveAllR2,
      disabled: pendingApprovals.filter((a) => a.riskClass === "R2").length === 0,
      badge: pendingApprovals.filter((a) => a.riskClass === "R2").length
    },
    {
      id: "briefing",
      label: "Startup",
      icon: <span>☀</span>,
      onClick: () => void generateBriefing("startup"),
      shortcut: "B"
    }
  ];

  return (
    <ApprovalNavigationProvider
      approvals={pendingApprovals}
      onApprove={(id) => respondApproval(id, "approved", { scope: "once" })}
      onReject={(id) => respondApproval(id, "rejected")}
    >
    <KeyboardShortcutsProvider>
      <FaviconBadge count={pendingApprovals.length} />
      <ToastContainer />

      {/* Focus Mode Overlay */}
      <FocusMode
        isActive={focusMode.isInFocusMode}
        sectionId={focusMode.focusedSection?.id || ""}
        title={focusMode.focusedSection?.title || ""}
        onClose={focusMode.exitFocus}
      >
        {focusMode.focusedSection?.id === "approvals" && (
          <div className="focus-approvals">
            {pendingApprovals.map((approval) => (
              <div className="list-item vertical" key={approval.id}>
                <div>
                  <strong>{approval.title}</strong>
                  <p>{approval.rationale}</p>
                </div>
                <div className="approval-actions">
                  <RiskClassHelp riskClass={approval.riskClass}>
                    <RiskBadge riskClass={approval.riskClass} />
                  </RiskClassHelp>
                  <RelativeTime date={approval.createdAt} />
                  <button type="button" onClick={() => respondApproval(approval.id, "approved", { scope: "once" })} disabled={isPending}>
                    Approve
                  </button>
                  <button type="button" className="secondary-button" onClick={() => respondApproval(approval.id, "rejected")} disabled={isPending}>
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </FocusMode>
      
      {/* NL Floating Bar - Press / to toggle */}
      <NLFloatingBar
        onExecute={nlExecutor.execute}
        capabilitySummary={nlCapabilitySummary}
      />

      <main className={`dashboard-shell ${theme.mode === 'dark' ? 'dark-mode' : ''}`}>
        <CoreLoopViewTracker workspaceId={data.activeWorkspace?.id ?? null} />
        {/* Stats Bar with Theme Toggle */}
        <div className="stats-bar-wrapper">
          <StatsBar {...statsBar.props} />
          <ThemeToggle />
        </div>

        <DashboardCommandCenter
          model={commandCenterModel}
          role={commandCenterRole}
          onRoleChange={setCommandCenterRole}
          openTarget={navigateToSection}
        />

        <DashboardOperatingSectionsCard operatingSections={data.operatingSections} openView={openView} />

        {/* Recent Actions */}
        {recentActions.recentActions.length > 0 && (
          <RecentActionsBar
            actions={recentActions.recentActions}
            onClear={recentActions.clearActions}
          />
        )}

        {/* Unified Feed Toggle */}
        {showUnifiedFeed && unifiedFeedItems.length > 0 && (
          <article className="card unified-feed-card">
            <div className="card-header">
              <h2>What needs attention</h2>
              <button type="button" className="secondary-button" onClick={() => setShowUnifiedFeed(false)}>
                Hide
              </button>
            </div>
            <UnifiedFeed
              items={unifiedFeedItems}
              maxItems={5}
              emptyMessage="All caught up! Nothing needs your attention."
            />
          </article>
        )}

        <section className="hero-panel">
          <div>
            <p className="eyebrow">Trusted execution control plane</p>
            <h1>Run commitments, approvals, and automations from one governed loop.</h1>
            <p className="lede">
              Start with what needs attention now, resolve what is blocked, confirm what can run safely, and review what
              changed recently. The reproducible document export stays available as an evidence snapshot instead of
              driving the main operating flow.
            </p>
            <div className="advanced-operations-summary" aria-label="Governed loop summary">
              <span className="pill">Decide: {coreLoopSummary.counts.commitments} commitments</span>
              <span className="pill">Approve: {coreLoopSummary.counts.pendingApprovals} pending</span>
              <span className="pill">Execute: {coreLoopSummary.counts.activeGoals} active</span>
              <span className="pill">Observe: {coreLoopSummary.counts.recentActivity} events</span>
              <span className="pill">Improve: {coreLoopSummary.counts.memories} memories</span>
            </div>
          </div>
          <div className="hero-actions">
            <div className="hero-button-row">
              <button type="button" className="primary-button" onClick={focusRequestComposer} disabled={isPending}>
                Request work
              </button>
              <button type="button" className="secondary-button" onClick={() => void generateBriefing("startup")} disabled={isPending}>
                Startup briefing
              </button>
              <button type="button" className="secondary-button" onClick={renderDocs} disabled={isPending}>
                Rebuild `agentic.docx`
              </button>
              <button type="button" className="secondary-button" onClick={logout} disabled={isPending}>
                Lock session
              </button>
              <ShareLinkButton getUrl={deepLink.getShareableUrl} label="Share view" />
            </div>
            <p className="palette-hint">Press <kbd>⌘K</kbd> to open command palette · <kbd>?</kbd> for shortcuts</p>
            <p className={`status-chip ${docsState.kind}`}>
              {docsState.message || "The governed document snapshot is ready whenever you need an exportable record."}
            </p>
            <p className={`status-chip ${coreLoopSummary.health === "idle" ? "idle" : "success"}`}>{coreLoopHealthCopy}</p>
          </div>
        </section>

        <article className="card reliability-card">
          <div className="card-header reliability-card-header">
            <div className="reliability-heading">
              <HealthIndicator health={reliabilityHealth} size="lg" showScore />
              <div>
                <h2>Reliability</h2>
                <p className="reliability-summary">{reliabilitySummary}</p>
              </div>
            </div>
            <span>
              Checked <RelativeTime date={data.diagnostics.generatedAt} />
            </span>
          </div>
          {data.diagnostics.items.length === 0 ? (
            <p className="empty-state">
              The dashboard is clear. New reliability issues will appear here as soon as approvals expire, memories go stale,
              context signals conflict, queues degrade, connectors lose health, workflows block, or watchers outlive their goals.
            </p>
          ) : (
            <div className="diagnostic-grid">
              {data.diagnostics.items.map((item) => (
                <div className={`diagnostic-item ${item.severity}`} key={item.kind}>
                  <div className="diagnostic-item-header">
                    <strong>{item.title}</strong>
                    <span className={`pill diagnostic-pill ${item.severity}`}>{item.count}</span>
                  </div>
                  <div className="diagnostic-reasons">
                    {item.reasons.map((reason) => (
                      <p key={`${item.kind}-${reason}`}>{reason}</p>
                    ))}
                  </div>
                  {item.targets.length > 0 ? (
                    <div className="diagnostic-targets">
                      {item.targets.map((target) => (
                        <div
                          className="diagnostic-target-row"
                          key={`${item.kind}-${target.section}-${target.itemId ?? target.label}`}
                        >
                          <button
                            type="button"
                            className="secondary-button diagnostic-target-button"
                            onClick={() => openDiagnosticTarget(target)}
                          >
                            {target.label}
                          </button>
                          {target.action ? (
                            <button
                              type="button"
                              className="secondary-button diagnostic-action-button"
                              onClick={() => void runDiagnosticAction(target)}
                              disabled={isPending}
                            >
                              {target.actionLabel ?? "Resolve"}
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="card now-queue-card" id="section-now">
          <div className="card-header">
            <h2>Now queue</h2>
            <span>
              {data.nowQueue.items.length} of {data.nowQueue.totalCount} ready now
            </span>
          </div>
          <p className="empty-state">
            Server-derived sequencing keeps the next few commitments bounded, urgency-aware, and aligned with reliability
            signals already present in the control plane.
          </p>
          <div className="list-stack">
            {data.nowQueue.items.length === 0 ? (
              <p className="empty-state">No commitments are currently ready for immediate action.</p>
            ) : null}
            {data.nowQueue.items.map((item) => {
              const suggestedNextAction = item.suggestedNextAction;

              return (
                <div
                  className={`list-item vertical ${highlightedItemId === item.commitmentId ? "selection-highlight" : ""}`}
                  id={getDashboardItemAnchorId(item.commitmentId)}
                  key={item.commitmentId}
                >
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.summary}</p>
                  </div>
                  <div className="approval-actions">
                    <StatusBadge status={item.status} />
                    <span className={`pill now-queue-urgency urgency-${item.urgency}`}>
                      {formatCommitmentUrgencyLabel(item.urgency)}
                    </span>
                    {item.riskClass ? <RiskBadge riskClass={item.riskClass} /> : null}
                    <span className="pill">{Math.round(item.confidence * 100)}%</span>
                    {item.dueAt ? <RelativeTime date={item.dueAt} /> : null}
                    {item.status === "completed" || item.status === "dismissed" ? (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => {
                          const currentCommitment = data.commitments.find((candidate) => candidate.id === item.commitmentId);

                          if (!currentCommitment) {
                            return;
                          }

                          void updateCommitment(item.commitmentId, currentCommitment.updatedAt, "reopen");
                        }}
                        disabled={isPending}
                      >
                        Reopen
                      </button>
                    ) : (
                      <>
                        {suggestedNextAction ? (
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => openDiagnosticTarget(suggestedNextAction)}
                          >
                            {suggestedNextAction.label}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => {
                            const currentCommitment = data.commitments.find((candidate) => candidate.id === item.commitmentId);

                            if (!currentCommitment) {
                              return;
                            }

                            void updateCommitment(item.commitmentId, currentCommitment.updatedAt, "complete");
                          }}
                          disabled={isPending}
                        >
                          Complete
                        </button>
                      </>
                    )}
                  </div>
                  {item.reasons.length > 0 ? (
                    <div className="now-queue-reasons">
                      {item.reasons.map((reason) => (
                        <span className="pill" key={`${item.commitmentId}-${reason}`}>
                          {reason}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </article>

        <section className="grid">
          <DashboardAdvancedOperationsCard
            activeWorkspaceName={data.activeWorkspace?.name ?? null}
            readyIntegrations={readyIntegrationCount}
            totalIntegrations={data.integrations.length}
            watcherCount={data.watchers.length}
            autopilotMode={data.autopilotSettings.mode}
            watchersReadiness={watcherCapability?.readiness ?? "preview"}
            watchersReason={
              watcherCapability?.runtimeReason ??
              "Operational telemetry is unavailable, so watcher readiness stays fail-closed."
            }
            autopilotReadiness={autopilotCapability?.readiness ?? "preview"}
            autopilotReason={
              autopilotCapability?.runtimeReason ??
              "Operational telemetry is unavailable, so autopilot readiness stays fail-closed."
            }
            coreOperationalCount={featureCapabilitySummary.core.operationalOrBetter}
            coreTotalCount={featureCapabilitySummary.core.total}
            advancedOperationalCount={featureCapabilitySummary.advanced.operationalOrBetter}
            advancedTotalCount={featureCapabilitySummary.advanced.total}
            trackedContractCount={featureCapabilitySummary.trackedContracts}
            expanded={showAdvancedOperations}
            onToggle={() => setShowAdvancedOperations((current) => !current)}
          />

          <div className={showAdvancedOperations ? "advanced-operations-expanded" : "advanced-surface-hidden"}>
            <DashboardOperationsSections
              data={data}
              isPending={isPending}
              highlightedItemId={highlightedItemId}
              workspaceState={workspaceState}
              governanceState={governanceState}
              autopilotState={autopilotState}
              privacyState={privacyState}
              privacyInventoryState={privacyInventoryState}
              privacyControls={privacyControls}
              workspaceName={workspaceName}
              setWorkspaceName={setWorkspaceName}
              workspaceSlug={workspaceSlug}
              setWorkspaceSlug={setWorkspaceSlug}
              workspaceDescription={workspaceDescription}
              setWorkspaceDescription={setWorkspaceDescription}
              workspaceMemberUserId={workspaceMemberUserId}
              setWorkspaceMemberUserId={setWorkspaceMemberUserId}
              workspaceMemberRole={workspaceMemberRole}
              setWorkspaceMemberRole={setWorkspaceMemberRole}
              governanceDraft={governanceDraft}
              setGovernanceDraft={setGovernanceDraft}
              autopilotDraft={autopilotDraft}
              setAutopilotDraft={setAutopilotDraft}
              getItemAnchorId={getDashboardItemAnchorId}
              openDiagnosticTarget={openDiagnosticTarget}
              createWorkspace={createWorkspace}
              selectWorkspace={selectWorkspace}
              addWorkspaceMember={addWorkspaceMember}
              saveWorkspaceGovernance={saveWorkspaceGovernance}
              exportWorkspaceAudit={exportWorkspaceAudit}
              saveAutopilotSettings={saveAutopilotSettings}
              runPrivacyOperation={runPrivacyOperation}
              revokeGoalShare={revokeGoalShare}
            />
          </div>

          {data.operations ? (
            <DashboardOperationsTowerCard
              operations={data.operations}
              expanded={showAdvancedOperations}
              highlightedItemId={highlightedItemId}
              getItemAnchorId={getDashboardItemAnchorId}
              navigateToSection={navigateToSection}
              canReplayDeadLetterJobs={sharedJobReplayState.allowed}
              replayPermissionReason={sharedJobReplayState.reason ?? ""}
            />
          ) : null}

          <article
            className={`card operator-product-card ${showAdvancedOperations ? "advanced-operations-expanded" : "advanced-surface-hidden"}`}
            id="section-operator-products"
          >
            <div className="card-header">
              <div>
                <h2>Operator product</h2>
                <p className="operator-product-subtitle">
                  Select the operating mode that shapes recommended agents, templates, integrations, and KPIs.
                </p>
              </div>
              <div className="card-header-actions">
                <span>{operatorProducts.length} available</span>
                <button type="button" className="secondary-button" onClick={() => void loadOperatorProducts()} disabled={isPending}>
                  Refresh
                </button>
              </div>
            </div>
            <p className={`status-chip ${operatorProductState.kind}`}>
              {operatorProductState.message || "Load a role pack to anchor the next phase of operational setup."}
            </p>
            {selectedOperatorProduct ? (
              <div className="operator-product-selected">
                <div className="operator-product-selected-header">
                  <div className="operator-product-title">
                    <span className="operator-product-icon" aria-hidden="true">
                      {selectedOperatorProduct.icon}
                    </span>
                    <div>
                      <strong>{selectedOperatorProduct.name}</strong>
                      <p>{selectedOperatorProduct.tagline}</p>
                    </div>
                  </div>
                  <StatusBadge status={selectedOperatorProduct.status} />
                </div>
                <p className="operator-product-description">{selectedOperatorProduct.description}</p>
                <div className="operator-product-detail-grid">
                  <div>
                    <h3>Recommended agents</h3>
                    <div className="list-stack compact">
                      {selectedOperatorProduct.recommendedAgentIds.map((agentId) => {
                        const agent =
                          operatorProductAgents.find((candidate) => candidate.id === agentId || candidate.name === agentId) ?? null;

                        return (
                          <div className="list-item vertical" key={agentId}>
                            <strong>{agent?.displayName ?? agentId}</strong>
                            <p>{agent?.description || "Seed or customize this agent before higher-volume operator workflows."}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <h3>Integration readiness</h3>
                    <div className="list-stack compact">
                      {selectedOperatorProduct.recommendedIntegrations.map((integration) => {
                        const connected = data.integrations.find((candidate) => candidate.system === integration.system);

                        return (
                          <div className="list-item vertical" key={integration.system}>
                            <div className="operator-product-row-heading">
                              <strong>{integration.label}</strong>
                              <div className="goal-item-actions">
                                <StatusBadge status={integration.readiness} />
                                {connected ? <span className="pill">{connected.status}</span> : <span className="pill">not connected</span>}
                              </div>
                            </div>
                            <p>{integration.description}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <h3>Success metrics</h3>
                    <div className="list-stack compact">
                      {selectedOperatorProduct.kpis.map((kpi) => (
                        <div className="list-item vertical" key={kpi.id}>
                          <strong>{kpi.label}</strong>
                          <p>{kpi.description}</p>
                          <span className="pill">{kpi.metric}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3>Onboarding</h3>
                    <div className="list-stack compact">
                      {selectedOperatorProduct.onboardingSteps.map((step) => (
                        <div className="list-item vertical" key={step.id}>
                          <strong>{step.title}</strong>
                          <p>{step.description}</p>
                          {step.actionLabel ? <span className="pill">{step.actionLabel}</span> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                {selectedOperatorProduct.recommendedTemplateIds.length > 0 ? (
                  <div className="operator-product-templates">
                    <h3>Recommended templates</h3>
                    <div className="list-stack compact">
                      {selectedOperatorProduct.recommendedTemplateIds.map((templateId) => {
                        const template = operatorProductTemplateLookup.find((candidate) => candidate.id === templateId) ?? null;
                        return (
                          <div className="list-item vertical" key={templateId}>
                            <strong>{template?.name ?? templateId}</strong>
                            <p>
                              {template?.description ||
                                template?.request ||
                                "Create this template to make the operator product repeatable instead of manual."}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="empty-state">No operator product is currently selected.</p>
            )}
            <div className="operator-product-selector">
              {operatorProducts.map((product) => {
                const isSelected = product.id === operatorProductSelection?.operatorProductId;

                return (
                  <div className={`list-item vertical ${isSelected ? "selection-highlight" : ""}`} key={product.id}>
                    <div className="operator-product-row-heading">
                      <div className="operator-product-title">
                        <span className="operator-product-icon" aria-hidden="true">
                          {product.icon}
                        </span>
                        <div>
                          <strong>{product.name}</strong>
                          <p>{product.tagline}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        className={isSelected ? "secondary-button" : "primary-button"}
                        onClick={() => void selectOperatorProduct(product.id)}
                        disabled={isPending || isSelected}
                      >
                        {isSelected ? "Selected" : "Select"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </article>

          <article className="card" id="section-commitments">
            <div className="card-header">
              <h2>Commitments inbox</h2>
              <div className="card-header-actions">
                <span>
                  {commitmentInbox.items.length} of {commitmentInbox.totalCount}
                </span>
              </div>
            </div>
            <p className="empty-state">
              Server-derived buckets turn pending approvals and active goal obligations into a bounded operating queue with
              durable complete and dismiss overrides.
            </p>
            <div className="filter-options">
              {commitmentInboxSections.map((section) => (
                <button
                  key={section.bucket}
                  type="button"
                  className={`filter-chip ${commitmentBucket === section.bucket ? "active" : ""}`}
                  onClick={() => {
                    setCommitmentBucket(section.bucket);
                    deepLink.setFilter(section.bucket);
                  }}
                >
                  {section.label} ({commitmentInbox.counts[section.bucket]})
                </button>
              ))}
            </div>
            <div className="list-stack">
              {commitmentInboxState.kind === "error" ? (
                <p className="empty-state">{commitmentInboxState.message}</p>
              ) : null}
              {commitmentInbox.items.length === 0 ? (
                <p className="empty-state">No commitments are currently waiting on you.</p>
              ) : null}
              {commitmentInbox.items.map((commitment) => (
                <div
                  className={`list-item vertical ${highlightedItemId === commitment.id ? "selection-highlight" : ""}`}
                  id={getDashboardItemAnchorId(commitment.id)}
                  key={commitment.id}
                >
                  <div>
                    <strong>{commitment.title}</strong>
                    <p>{commitment.summary}</p>
                  </div>
                  <div className="approval-actions">
                    <StatusBadge status={commitment.status} />
                    <span className="pill">{Math.round(commitment.confidence * 100)}%</span>
                    {commitment.dueAt ? <RelativeTime date={commitment.dueAt} /> : null}
                    {commitment.status === "completed" || commitment.status === "dismissed" ? (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => void updateCommitment(commitment.id, commitment.updatedAt, "reopen")}
                        disabled={isPending}
                      >
                        Reopen
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => void updateCommitment(commitment.id, commitment.updatedAt, "complete")}
                          disabled={isPending}
                        >
                          Complete
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => void updateCommitment(commitment.id, commitment.updatedAt, "dismiss")}
                          disabled={isPending}
                        >
                          Dismiss
                        </button>
                      </>
                    )}
                  </div>
                  {commitment.evidence.length > 0 ? (
                    <div className="diagnostic-targets">
                      {commitment.evidence.map((evidence) => (
                        <button
                          key={`${commitment.id}-${evidence.section}-${evidence.itemId ?? evidence.label}`}
                          type="button"
                          className="secondary-button diagnostic-target-button"
                          onClick={() => openDiagnosticTarget(evidence)}
                        >
                          {evidence.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
              {commitmentInbox.nextCursor ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void loadMoreCommitments()}
                  disabled={isPending}
                >
                  Load more
                </button>
              ) : null}
            </div>
          </article>

          <article className="card" id="section-briefings">
            <div className="card-header">
              <h2>Briefing cadence</h2>
              <span>{data.briefingHistory.length} recent</span>
            </div>
            <div className="hero-button-row">
              {briefingTypeValues.map((type) => (
                <button
                  key={type}
                  type="button"
                  className={type === "startup" ? "primary-button" : "secondary-button"}
                  onClick={() => void generateBriefing(type)}
                  disabled={isPending}
                >
                  {briefingTypeLabels[type]}
                </button>
              ))}
            </div>
            <p className={`status-chip ${briefingState.kind}`}>
              {briefingState.message || "Generate startup, midday, pre-meeting, end-of-day, or next-day briefings from the same workflow contract."}
            </p>
            <div className="list-stack">
              <label className="field">
                <span>Timezone</span>
                <input
                  value={briefingPreferencesDraft.timezone}
                  onChange={(event) =>
                    setBriefingPreferencesDraft((current) => ({
                      ...current,
                      timezone: event.target.value
                    }))
                  }
                  placeholder="Asia/Singapore"
                />
              </label>
              <label className="field">
                <span>Focus mode</span>
                <select
                  value={briefingPreferencesDraft.focus}
                  onChange={(event) =>
                    setBriefingPreferencesDraft((current) => ({
                      ...current,
                      focus: event.target.value as BriefingPreferences["focus"]
                    }))
                  }
                >
                  {briefingFocusValues.map((focus) => (
                    <option key={focus} value={focus}>
                      {briefingFocusLabels[focus]}
                    </option>
                  ))}
                </select>
              </label>
              {briefingTypeValues.map((type) => {
                const schedule = briefingPreferencesDraft.schedules.find((entry) => entry.type === type);

                if (!schedule) {
                  return null;
                }

                return (
                  <div className="list-item vertical" key={type}>
                    <div>
                      <strong>{briefingTypeLabels[type]}</strong>
                      <p>{schedule.enabled ? `Runs at ${schedule.time}` : "Disabled"}</p>
                    </div>
                    <div className="approval-actions">
                      <label className="pill">
                        <input
                          type="checkbox"
                          checked={schedule.enabled}
                          onChange={(event) => updateBriefingScheduleDraft(type, { enabled: event.target.checked })}
                        />{" "}
                        enabled
                      </label>
                      <input
                        type="time"
                        value={schedule.time}
                        onChange={(event) => updateBriefingScheduleDraft(type, { time: event.target.value })}
                        disabled={!schedule.enabled}
                      />
                    </div>
                  </div>
                );
              })}
              <div className="hero-button-row">
                <button type="button" className="secondary-button" onClick={saveBriefingPreferences} disabled={isPending}>
                  Save briefing preferences
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setBriefingPreferencesDraft(data.briefingPreferences)}
                  disabled={isPending}
                >
                  Reset
                </button>
              </div>
            </div>
            <div className="list-stack">
              {data.briefingHistory.length === 0 ? (
                <div className="list-item vertical">
                  <div>
                    <strong>No briefings yet</strong>
                    <p>Generate a startup or scheduled briefing to create a reusable operating record.</p>
                  </div>
                </div>
              ) : (
                data.briefingHistory.slice(0, 5).map((briefing) => (
                  <div className="list-item vertical" key={briefing.goalId}>
                    <div>
                      <strong>{briefing.title}</strong>
                      <p>{briefing.summary}</p>
                    </div>
                    <div className="goal-item-actions">
                      <StatusBadge status={briefing.status} />
                      <span className="pill">{briefingTypeLabels[briefing.type]}</span>
                      <RelativeTime date={briefing.generatedAt} />
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() =>
                          openDiagnosticTarget({
                            section: "goals",
                            itemId: briefing.goalId,
                            label: briefing.title
                          })
                        }
                      >
                        Open goal
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </article>

        <article className="card">
          <div className="card-header">
            <h2>Execution visibility</h2>
            <span>Filters goals, approvals, and artifacts together</span>
          </div>
          <div className="approval-actions">
            <label className="field">
              <span>Execution mode</span>
              <select
                aria-label="Execution mode filter"
                value={executionModeFilter}
                onChange={(event) => setExecutionModeFilter(event.target.value as ExecutionModeFilterValue)}
              >
                {executionModeFilterOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="detail-list-summary">{selectedExecutionModeFilter.description}</p>
          </div>
        </article>

        <DashboardGoalsCard
          filteredGoalBundles={filteredGoalBundles}
          totalGoalCount={data.goals.length}
          request={request}
          setRequest={setRequest}
          selectedAgentId={selectedAgentId}
          setSelectedAgentId={setSelectedAgentId}
          createGoal={createGoal}
          generateStartupBriefing={async () => {
            await generateBriefing("startup");
          }}
          isPending={isPending}
          submitState={submitState}
          shareState={shareState}
          refinementState={refinementState}
          recommendationState={recommendationState}
          lastShareUrl={lastShareUrl}
          focusRequestComposer={focusRequestComposer}
          canManageGoalShares={canManageGoalShares}
          goalSharePermissionReason={goalSharePermissionReason}
          pendingShareReview={pendingShareReview}
          shareGoal={shareGoal}
          confirmGoalShare={confirmGoalShare}
          cancelGoalShareReview={cancelGoalShareReview}
          saveAsTemplate={saveAsTemplate}
          shareStatsByGoal={shareStatsByGoal}
          highlightedItemId={highlightedItemId}
          getItemAnchorId={getDashboardItemAnchorId}
          refinementInputs={refinementInputs}
          setRefinementInputs={setRefinementInputs}
          refineGoal={refineGoal}
          goalRefinementStateById={goalRefinementStateById}
          recommendationResultsByGoal={recommendationResultsByGoal}
          recommendationPendingByGoal={recommendationPendingByGoal}
          submitRecommendationFeedback={submitRecommendationFeedback}
        />

        <article className="card" id="section-approvals">
          <div className="card-header">
            <h2>Approvals inbox</h2>
            <div className="card-header-actions">
              <ApprovalGroupSelector
                value={approvalGroupBy}
                onChange={setApprovalGroupBy}
              />
              <span>{filteredPendingApprovals.length} / {pendingApprovals.length} pending</span>
              <FocusModeButton
                sectionId="approvals"
                sectionTitle="Approvals"
                onEnterFocus={focusMode.enterFocus}
              />
            </div>
          </div>
          
          {/* Keyboard Navigation Hints */}
          <ApprovalKeyboardHints isActive={true} />
          
          {/* Batch Actions Bar */}
          {approvalBatch.hasSelection && (
            <BatchActionsBar
              selectedCount={approvalBatch.selectedCount}
              entityType="approval"
              onSelectAll={approvalBatch.selectAll}
              onDeselectAll={approvalBatch.deselectAll}
              allSelected={approvalBatch.allSelected}
            >
              <button
                type="button"
                className="primary-button batch-action-button"
                onClick={batchApproveSelected}
                disabled={isPending}
              >
                Approve Selected
              </button>
            </BatchActionsBar>
          )}
          
          {/* Grouped or Flat View */}
          {approvalGroupBy !== "none" ? (
            <div className="approval-groups-container">
              {approvalGroups.map((group) => (
                <ApprovalGroupView
                  key={group.key}
                  group={group}
                  defaultExpanded
                  onApproveAll={async (approvals) => {
                    for (const a of approvals) {
                      await respondApproval(a.id, "approved", { scope: "once" });
                    }
                  }}
                >
                  {group.approvals.map((approval, idx) => {
                    // Get global index for keyboard navigation
                    const globalIndex = filteredPendingApprovals.findIndex(a => a.id === approval.id);
                    return (
                      <KeyboardApprovalItem
                        key={approval.id}
                        index={globalIndex}
                        approval={approval}
                      >
                        <SelectableItem
                          id={approval.id}
                          isSelected={approvalBatch.isSelected(approval.id)}
                          onToggle={approvalBatch.toggle}
                        >
                          <div
                            className={`list-item vertical ${highlightedItemId === approval.id ? "selection-highlight" : ""}`}
                            id={getDashboardItemAnchorId(approval.id)}
                          >
                            <div>
                              <ApprovalPreview approval={approval}>
                                <strong>{approval.title}</strong>
                              </ApprovalPreview>
                              <p>{approval.rationale}</p>
                            </div>
                            <div className="approval-actions">
                              <RiskClassHelp riskClass={approval.riskClass}>
                                <RiskBadge riskClass={approval.riskClass} />
                              </RiskClassHelp>
                              <RelativeTime date={approval.createdAt} />
                              <PinButton
                                id={approval.id}
                                type="approval"
                                label={approval.title}
                                isPinned={pinnedItems.isPinned(approval.id, "approval")}
                                onToggle={pinnedItems.togglePin}
                              />
                              <button type="button" onClick={() => respondApproval(approval.id, "approved", { scope: "once" })} disabled={isPending}>
                                Approve once
                              </button>
                              <button type="button" className="secondary-button" onClick={() => respondApproval(approval.id, "approved", { scope: "similar_24h" })} disabled={isPending}>
                                Approve 24h
                              </button>
                              <button type="button" className="secondary-button" onClick={() => respondApproval(approval.id, "approved", { scope: "always_review" })} disabled={isPending}>
                                Ask again
                              </button>
                              <button type="button" className="secondary-button" onClick={() => respondApproval(approval.id, "rejected")} disabled={isPending}>
                                Reject
                              </button>
                            </div>
                            <div className="refinement-row">
                              <input
                                value={approvalNotes[approval.id] ?? ""}
                                onChange={(event) =>
                                  setApprovalNotes((prev) => ({ ...prev, [approval.id]: event.target.value }))
                                }
                                placeholder="Decision note (optional)"
                                maxLength={1000}
                              />
                            </div>
                          </div>
                        </SelectableItem>
                      </KeyboardApprovalItem>
                    );
                  })}
                </ApprovalGroupView>
              ))}
            </div>
          ) : (
          <div className="list-stack">
            {filteredPendingApprovals.length === 0 ? (
              pendingApprovals.length === 0 ? (
                <NoApprovalsEmpty />
              ) : (
                <p className="status-chip idle">No pending approvals match the current execution-mode filter.</p>
              )
            ) : null}
            {filteredPendingApprovals.map((approval, index) => (
              <KeyboardApprovalItem
                key={approval.id}
                index={index}
                approval={approval}
              >
              <SelectableItem
                id={approval.id}
                isSelected={approvalBatch.isSelected(approval.id)}
                onToggle={approvalBatch.toggle}
              >
                <div
                  className={`list-item vertical ${highlightedItemId === approval.id ? "selection-highlight" : ""}`}
                  id={getDashboardItemAnchorId(approval.id)}
                >
                  <div>
                    <ApprovalPreview approval={approval}>
                      <strong>{approval.title}</strong>
                    </ApprovalPreview>
                    <p>{approval.rationale}</p>
                  </div>
                  <div className="approval-actions">
                    <RiskClassHelp riskClass={approval.riskClass}>
                      <RiskBadge riskClass={approval.riskClass} />
                    </RiskClassHelp>
                    <RelativeTime date={approval.createdAt} />
                    <PinButton
                      id={approval.id}
                      type="approval"
                      label={approval.title}
                      isPinned={pinnedItems.isPinned(approval.id, "approval")}
                      onToggle={pinnedItems.togglePin}
                    />
                    <button type="button" onClick={() => respondApproval(approval.id, "approved", { scope: "once" })} disabled={isPending}>
                      Approve once
                    </button>
                    <button type="button" className="secondary-button" onClick={() => respondApproval(approval.id, "approved", { scope: "similar_24h" })} disabled={isPending}>
                      Approve 24h
                    </button>
                    <button type="button" className="secondary-button" onClick={() => respondApproval(approval.id, "approved", { scope: "always_review" })} disabled={isPending}>
                      Ask again
                    </button>
                    <button type="button" className="secondary-button" onClick={() => respondApproval(approval.id, "rejected")} disabled={isPending}>
                      Reject
                    </button>
                  </div>
                  <div className="refinement-row">
                    <input
                      value={approvalNotes[approval.id] ?? ""}
                      onChange={(event) =>
                        setApprovalNotes((prev) => ({ ...prev, [approval.id]: event.target.value }))
                      }
                      placeholder="Decision note (optional)"
                      maxLength={1000}
                    />
                  </div>
                </div>
              </SelectableItem>
              </KeyboardApprovalItem>
            ))}
          </div>
          )}
        </article>

        <article className="card" id="section-artifacts">
          <div className="card-header">
            <FeatureHelp feature="artifacts">
              <h2>Artifacts</h2>
            </FeatureHelp>
            <span>{filteredLatestArtifacts.length} / {data.latestArtifacts.length} recent</span>
          </div>
          <div className="artifact-stack">
            {filteredLatestArtifacts.length === 0 ? (
              data.latestArtifacts.length === 0 ? (
                <NoArtifactsEmpty />
              ) : (
                <p className="status-chip idle">No artifacts match the current execution-mode filter.</p>
              )
            ) : null}
            {filteredLatestArtifacts.map((artifact) => {
              const executionMode = extractArtifactExecutionMode(artifact);
              const goalConfidence = goalConfidenceById.get(artifact.goalId);

              return (
                <div className="artifact-card" key={artifact.id}>
                  <div className="card-header">
                    <ArtifactPreview artifact={artifact}>
                      <strong>{artifact.title}</strong>
                    </ArtifactPreview>
                    <div className="detail-list-badges">
                      <StatusBadge status={artifact.artifactType} />
                      <ImplementationTierBadge mode={executionMode} />
                      <ExecutionModeBadge mode={executionMode} />
                    </div>
                  </div>
                  <div className="detail-list-meta">
                    <span>Implementation tier: <strong>{getImplementationTierPresentation(executionMode).label}</strong></span>
                  </div>
                  <div className="detail-list-meta">
                    <span>Execution mode: <strong>{getExecutionModePresentation(executionMode).label}</strong></span>
                    <span>
                      Goal confidence: <strong>{typeof goalConfidence === "number" ? formatConfidencePercentage(goalConfidence) : "Unavailable"}</strong>
                    </span>
                  </div>
                  <pre>{artifact.content}</pre>
                  <div className="artifact-actions">
                    <CopyButton value={artifact.content} label="Copy content" />
                  </div>
                </div>
              );
            })}
          </div>
        </article>

        <article className="card">
          <div className="card-header">
            <h2>Activity timeline</h2>
            <span>{timelineFilters.filteredLogs.length} / {data.actionLogs.length} events</span>
          </div>
          <TimelineFilter
            logs={data.actionLogs}
            onFilterChange={timelineFilters.setFilters}
          />
          <div className="timeline">
            {timelineFilters.filteredLogs.map((log) => (
              <div className="timeline-row" key={log.id}>
                <div className="timeline-dot" />
                <div>
                  <strong>{log.kind}</strong>
                  <p>{log.message}</p>
                  <RelativeTime date={log.createdAt} />
                </div>
              </div>
            ))}
          </div>
        </article>

        <DashboardAdvancedSurface
          showAdvancedOperations={showAdvancedOperations}
          data={data}
          notes={notes}
          templates={templates}
          templateState={templateState}
          highlightedItemId={highlightedItemId}
          getItemAnchorId={getDashboardItemAnchorId}
          isPending={isPending}
          memoryCategory={memoryCategory}
          setMemoryCategory={setMemoryCategory}
          memoryContent={memoryContent}
          setMemoryContent={setMemoryContent}
          saveMemory={saveMemory}
          updateMemory={updateMemory}
          connectGoogleProvider={connectGoogleProvider}
          cycleIntegration={cycleIntegration}
          noteQuery={noteQuery}
          setNoteQuery={setNoteQuery}
          searchNotes={searchNotes}
          noteTitle={noteTitle}
          setNoteTitle={setNoteTitle}
          noteContent={noteContent}
          setNoteContent={setNoteContent}
          createLocalNote={createLocalNote}
          noteState={noteState}
          openLocalNote={openLocalNote}
          selectedNoteSlug={selectedNoteSlug}
          selectedNoteTitle={selectedNoteTitle}
          setSelectedNoteTitleDraft={setSelectedNoteTitleDraft}
          selectedNoteContent={selectedNoteContent}
          setSelectedNoteContentDraft={setSelectedNoteContentDraft}
          saveSelectedNote={saveSelectedNote}
          goalBundleById={goalBundleById}
          resolveSharedWorkflowMutationState={resolveSharedWorkflowMutationState}
          updateWatcher={updateWatcher}
          loadTemplates={loadTemplates}
          runTemplate={runTemplate}
          deleteTemplate={deleteTemplate}
        />
      </section>

      <FloatingActionsBar position="bottom">
        <QuickActionsBar actions={quickActions} />
      </FloatingActionsBar>

      <CommandPalette
        onCreateGoal={async (req) => {
          setRequest(req);
          await submitGoalRequest(req);
          setRequest("");
        }}
        onFocusRequestComposer={focusRequestComposer}
        onNavigateToSection={navigateToSection}
        onLogout={logout}
        isPending={isPending}
      />
    </main>
    </KeyboardShortcutsProvider>
    </ApprovalNavigationProvider>
  );
}
