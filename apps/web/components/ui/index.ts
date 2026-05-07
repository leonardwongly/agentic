// Core UI Components
export { Badge, StatusBadge, RiskBadge, type BadgeVariant, type BadgeSize } from "./badge";
export {
  ExecutionModeBadge,
  ImplementationTierBadge,
  approvalMatchesExecutionModeFilter,
  bundleMatchesExecutionModeFilter,
  executionModeFilterOptions,
  extractArtifactExecutionMode,
  findTaskExecutionMode,
  formatConfidencePercentage,
  getExecutionModeFilterOption,
  getImplementationTierPresentation,
  getExecutionModePresentation,
  matchesExecutionModeFilter,
  type ExecutionModeFilterValue
} from "./execution-mode";
export { CopyButton, CopyableText } from "./copy-button";
export { RelativeTime, AbsoluteTime } from "./relative-time";
export { KeyboardShortcutsProvider, useKeyboardShortcuts, useShortcut, useListNavigation } from "./keyboard-shortcuts";
export { ExpandCollapseSection, ExpandAllControls } from "./expand-collapse";
export { EmptyState, NoApprovalsEmpty, NoGoalsEmpty, NoMemoriesEmpty, NoArtifactsEmpty, NoWatchersEmpty, NoTemplatesEmpty, NoAgentsEmpty, NoResultsEmpty } from "./empty-states";
export { FaviconBadge, useFaviconBadge } from "./favicon-badge";
export { toast, ToastContainer, useToasts, type Toast, type ToastType } from "./toast";
export { SlideOutPanel } from "./slide-out-panel";
export { Panel, SectionHeader, MetricCard, StatusPill, RiskPill, ActionGroup, DataTable, type DataTableColumn } from "./dashboard-primitives";
export { SmartFilters, useSmartFilters, type FilterConfig, type FilterOption, type FilterValues } from "./smart-filters";
export { QuickActionsBar, FloatingActionsBar } from "./quick-actions";
export { useRealtime, useLiveCounter, useLiveIndicator, usePolling, LiveDot, type RealtimeEvent, type LiveCounter } from "./realtime";

// 10x Dashboard Components (Phase 1)
export { StatsBar, useStatsBar } from "./stats-bar";
export { CollapsibleSection, useCollapsedSections } from "./collapsible-section";
export { PreviewTooltip, GoalPreview, ArtifactPreview, AgentPreview, ApprovalPreview } from "./preview-tooltip";
export { useSmartDefaults, SmartInput, ContextualSuggestion } from "./smart-defaults";
export { useRecentActions, RecentActionsBar, ActionIcon } from "./recent-actions";
export { useBatchSelection, BatchActionsBar, SelectableItem, BatchConfirmDialog } from "./batch-operations";
export { FocusMode, useFocusMode, FocusModeButton } from "./focus-mode";
export { UnifiedFeed, useUnifiedFeed } from "./unified-feed";
export { HelpTooltip, RiskClassHelp, MemoryTypeHelp, AgentStatusHelp, FeatureHelp } from "./help-tooltip";
export { useDeepLink, DeepLinkSection, ShareLinkButton } from "./deep-link";
export { usePinnedItems, PinButton, PinnedItemsBadge, sortWithPins } from "./pinned-items";

// 10x Dashboard Components (Phase 2) - Keyboard & Approval Flow
export { 
  ApprovalNavigationProvider, 
  useApprovalNavigation, 
  KeyboardApprovalItem, 
  ApprovalKeyboardHints, 
  ActivateKeyboardNav 
} from "./keyboard-approval";

// Undo System
export { UndoProvider, useUndo, useUndoableAction, createUndoActions } from "./undo-system";

// Approval Grouping
export { 
  useApprovalGroups, 
  ApprovalGroupSelector, 
  ApprovalGroupView, 
  ApprovalGroupSummary,
  type GroupBy 
} from "./approval-groups";

// Command Palette V2
export { 
  CommandPaletteV2, 
  useCommandPaletteV2, 
  useContextualCommands,
  type Command,
  type CommandCategory 
} from "./command-palette-v2";

// Agent Health Indicators
export { 
  calculateAgentHealth, 
  HealthIndicator, 
  HealthCard, 
  HealthSummary, 
  useAgentHealth,
  type HealthStatus,
  type AgentHealthData 
} from "./agent-health";

// Natural Language Dashboard
export { 
  NLInput, 
  NLFloatingBar, 
  useNLExecutor,
  type NLResult,
  type NLExecutionPayload
} from "./nl-dashboard";
export { parseIntent, type NLIntent } from "./nl-intent";

// Memory Search
export { 
  searchMemories, 
  MemorySearch,
  type Memory as SearchableMemory 
} from "./memory-search";

// Timeline Filtering
export { 
  filterTimeline, 
  TimelineFilter, 
  useFilteredTimeline, 
  TimelineStats,
  type TimelineFilters 
} from "./timeline-filter";

// Theme / Dark Mode
export { useTheme, ThemeToggle, ThemeSelector, type ThemeMode } from "./theme";

// Goal Progress
export { 
  parseGoalProgress, 
  GoalProgressBar, 
  InlineGoalProgress, 
  useGoalProgress,
  type GoalProgressData,
  type GoalStep 
} from "./goal-progress";

// Template Quick-Fill
export { 
  parseTemplateParameters, 
  fillTemplate, 
  getContextualTemplates, 
  TemplateQuickFill, 
  SuggestedTemplates, 
  useTemplateQuickFill 
} from "./template-quick-fill";

// Bulk Memory Operations
export { 
  BulkMemoryActions, 
  exportMemoriesAsJson, 
  exportMemoriesAsCsv, 
  useBulkMemorySelection 
} from "./bulk-memory-ops";

// Agent override for goal creation
export { AgentOverride, AgentSelect, useAgentsList } from "./agent-override";

// Inline approval actions
export { 
  InlineApprove, 
  useInlineApprovals, 
  FloatingApprovalBar, 
  ApprovalToast 
} from "./inline-approve";

// Agent memory viewer
export { AgentMemory, useAgentMemory, MemoryScope } from "./agent-memory";

// Agent comparison
export { AgentCompare, useAgentCompare } from "./agent-compare";

// Workflow builder
export { 
  WorkflowBuilder, 
  useWorkflowBuilder,
  type WorkflowNode,
  type WorkflowEdge,
  type WorkflowDefinition
} from "./workflow-builder";

// Predictive briefings
export {
  PredictiveBriefing,
  usePredictiveBriefing,
  BriefingNotification,
  type Briefing,
  type BriefingType,
  type BriefingSection,
  type BriefingItem
} from "./predictive-briefing";

// Smart notifications
export {
  NotificationCenter,
  useSmartNotifications,
  NotificationPreferencesPanel,
  type Notification,
  type NotificationPriority,
  type NotificationChannel,
  type NotificationPreferences
} from "./smart-notifications";

// Policy playground
export {
  PolicyPlayground,
  PolicyRuleBuilder,
  PolicyRuleCard,
  ScenarioBuilder,
  SimulationResultDisplay,
  usePolicyPlayground,
  type PolicyRule,
  type PolicyCondition,
  type PolicyAction,
  type SimulationScenario,
  type SimulationResult,
  type PolicySet
} from "./policy-playground";

// Live collaboration
export {
  PresenceAvatars,
  FloatingCursor,
  SelectionHighlight,
  LiveChat,
  ActivityFeed,
  EditLock,
  UserList,
  CollaborationPanel,
  PresenceBar,
  useCollaboration,
  type User as CollabUser,
  type Cursor,
  type Selection,
  type Presence,
  type CollabEvent,
  type CollabMessage
} from "./live-collab";

// Agent memory spaces
export {
  MemorySpaceCard,
  MemorySpaceEditor,
  MemoryLinker,
  MemorySpaceBrowser,
  useMemorySpaces,
  type MemorySpace,
  type MemorySpaceStats,
  type MemoryLink
} from "./agent-memory-spaces";
