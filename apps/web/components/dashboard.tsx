"use client";

import { startTransition, useCallback, useMemo, useRef, useState } from "react";
import type { AgentDefinition, GoalTemplate } from "@agentic/contracts";
import type { LocalNoteDocument } from "@agentic/integrations";
import type { DashboardData } from "@agentic/repository";
import { getGoalShareSuccessMessage } from "../lib/share-client";
import { AgentsPanel } from "./agents";
import { CommandPalette } from "./command-palette";
import {
  StatusBadge,
  RiskBadge,
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
  NoGoalsEmpty,
  NoMemoriesEmpty,
  NoArtifactsEmpty,
  NoWatchersEmpty,
  NoTemplatesEmpty,
  // 10x Components Phase 1
  StatsBar,
  useStatsBar,
  CollapsibleSection,
  GoalPreview,
  ArtifactPreview,
  ApprovalPreview,
  useSmartDefaults,
  ContextualSuggestion,
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
  MemoryTypeHelp,
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
  MemorySearch,
  useBulkMemorySelection,
  BulkMemoryActions,
  TimelineFilter,
  useFilteredTimeline,
  HealthIndicator,
  useAgentHealth,
  InlineGoalProgress,
  useGoalProgress,
  AgentOverride
} from "./ui";

type DashboardProps = {
  initialData: DashboardData;
  initialNotes: LocalNoteDocument[];
};

type RequestState = {
  kind: "idle" | "success" | "error";
  message: string;
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    const message = typeof payload === "object" && payload && "error" in payload ? String(payload.error) : "Request failed.";
    throw new Error(message);
  }

  return payload;
}

export function Dashboard({ initialData, initialNotes }: DashboardProps) {
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
  const [lastShareUrl, setLastShareUrl] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [templates, setTemplates] = useState<GoalTemplate[]>([]);
  const [templateState, setTemplateState] = useState<RequestState>({ kind: "idle", message: "" });
  const [refinementInputs, setRefinementInputs] = useState<Record<string, string>>({});
  const [refinementState, setRefinementState] = useState<RequestState>({ kind: "idle", message: "" });
  const [slideOutPanel, setSlideOutPanel] = useState<{ type: string; data: unknown } | null>(null);
  const [showUnifiedFeed, setShowUnifiedFeed] = useState(true);
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(undefined);
  const selectedNoteTitleRef = useRef("");
  const selectedNoteContentRef = useRef("");

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
  const approvalGroups = useApprovalGroups(data.approvals.filter((a) => a.decision === "pending"), approvalGroupBy);
  const memoryBulkSelection = useBulkMemorySelection();
  const timelineFilters = useFilteredTimeline(data.actionLogs);
  
  // NL Executor for dashboard commands
  const nlExecutor = useNLExecutor({
    onQuery: async (target: string, filters?: Record<string, string>) => {
      // Simple query handling - return raw data for the target
      switch (target) {
        case "memories":
          return data.memories.slice(0, 10);
        case "goals":
          return filters?.status
            ? data.goals.filter(g => g.goal.status === filters.status).slice(0, 10)
            : data.goals.slice(0, 10);
        case "approvals":
          return filters?.status === "pending"
            ? data.approvals.filter(a => a.decision === "pending")
            : filters?.riskClass
              ? data.approvals.filter(a => a.riskClass === filters.riskClass)
              : data.approvals.slice(0, 10);
        case "agents":
          // Agents are managed separately - return empty for now
          return [];
        default:
          return [];
      }
    },
    onCommand: async (action: string, params: Record<string, unknown>) => {
      // Handle commands like "approve all R2", "create goal X"
      const lowerAction = action.toLowerCase();
      if (lowerAction.includes("approve") && params.riskClass === "R2") {
        await approveAllR2();
        return;
      }
      if (lowerAction.includes("briefing") || lowerAction.includes("morning")) {
        await generateBriefing();
        return;
      }
      console.log("Unknown command:", action, params);
    },
    onSummary: async (timeRange: string) => {
      const pending = data.approvals.filter(a => a.decision === "pending").length;
      const runningGoals = data.goals.filter(g => g.goal.status === "running").length;
      const recentLogs = data.actionLogs.slice(0, 5);
      return `${timeRange} summary: ${pending} pending approvals, ${runningGoals} running goals, ${recentLogs.length} recent activities.`;
    }
  });
  
  // Batch selection for approvals
  const approvalBatch = useBatchSelection(
    data.approvals.filter((a) => a.decision === "pending"),
    "approval"
  );

  const pendingApprovals = useMemo(
    () => data.approvals.filter((approval) => approval.decision === "pending"),
    [data.approvals]
  );

  const selectedNotePreview = useMemo(
    () => notes.find((note) => note.slug === selectedNoteSlug) ?? null,
    [notes, selectedNoteSlug]
  );

  const shareStatsByGoal = useMemo(
    () =>
      new Map(
        data.goals.map((bundle) => [
          bundle.goal.id,
          {
            created: bundle.actionLogs.filter((log) => log.kind === "share.link_created").length,
            opened: bundle.actionLogs.filter((log) => log.kind === "share.page_viewed").length
          }
        ])
      ),
    [data.goals]
  );

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
    onApprove: (id) => respondApproval(id, "approved"),
    onReject: (id) => respondApproval(id, "rejected"),
    onViewGoal: (id) => deepLink.setItem(id, "goal"),
    onViewArtifact: (id) => deepLink.setItem(id, "artifact")
  });

  const refreshDashboard = async (producer: Promise<Response>, successMessage: string) => {
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
  };

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
          body: JSON.stringify({ decision: "approved" })
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

    await refreshDashboard(
      fetch("/api/goals", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ 
          request: nextRequest,
          agentId: selectedAgentId || undefined
        })
      }),
      "Created a new goal bundle."
    );
    setRequest("");
    setSelectedAgentId(undefined); // Reset agent selection
    
    // Track recent action
    recentActions.addAction({
      type: "create",
      label: nextRequest.slice(0, 30),
      undoable: false
    });
  };

  const generateBriefing = async () => {
    await refreshDashboard(
      fetch("/api/briefing", {
        method: "POST"
      }),
      "Generated the morning briefing."
    );
    recentActions.addAction({
      type: "create",
      label: "Morning briefing",
      undoable: false
    });
  };

  const shareGoal = async (goalId: string, title: string) => {
    setIsPending(true);

    try {
      const payload = await readJson<{ shareUrl: string; dashboard: DashboardData }>(
        await fetch(`/api/goals/${encodeURIComponent(goalId)}/share`, {
          method: "POST"
        })
      );
      const canCopy = typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function";
      let copiedToClipboard = false;

      if (canCopy) {
        try {
          await navigator.clipboard.writeText(payload.shareUrl);
          copiedToClipboard = true;
        } catch {
          copiedToClipboard = false;
        }
      }

      startTransition(() => {
        setData(payload.dashboard);
        setLastShareUrl(payload.shareUrl);
        setShareState({
          kind: "success",
          message: getGoalShareSuccessMessage(title, copiedToClipboard)
        });
      });
    } catch (error) {
      setShareState({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to create the public share link."
      });
    } finally {
      setIsPending(false);
    }
  };

  const respondApproval = async (approvalId: string, decision: "approved" | "rejected") => {
    const approval = data.approvals.find((a) => a.id === approvalId);
    await refreshDashboard(
      fetch(`/api/approvals/${approvalId}/respond`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ decision })
      }),
      `Marked the approval as ${decision}.`
    );
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
          body: JSON.stringify({ decision: "approved" })
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

    if (!message) {
      setRefinementState({ kind: "error", message: "Enter a refinement message before submitting." });
      return;
    }

    setIsPending(true);
    setRefinementState({ kind: "idle", message: "" });

    try {
      const payload = await readJson<{ dashboard: DashboardData }>(
        await fetch(`/api/goals/${encodeURIComponent(goalId)}/refine`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message })
        })
      );
      startTransition(() => {
        setData(payload.dashboard);
        setRefinementInputs((prev) => ({ ...prev, [goalId]: "" }));
        setRefinementState({ kind: "success", message: "Goal refined successfully." });
      });
    } catch (error) {
      setRefinementState({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to refine goal."
      });
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

  const renderDocs = async () => {
    setIsPending(true);
    setDocsState({ kind: "idle", message: "" });

    try {
      const payload = await readJson<{ result: { stdout: string; stderr: string }; dashboard: DashboardData }>(
        await fetch("/api/docs/render", {
          method: "POST"
        })
      );
      startTransition(() => {
        setData(payload.dashboard);
        setDocsState({
          kind: "success",
          message: payload.result.stdout || "Rendered and validated build/agentic.docx."
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
      const payload = await readJson<{ notes: LocalNoteDocument[] }>(await fetch(`/api/integrations/local-notes${params}`));

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
      const payload = await readJson<{ note: LocalNoteDocument }>(await fetch(`/api/integrations/local-notes/${encodeURIComponent(slug)}`));

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
      const payload = await readJson<{ bundle: unknown; dashboard: DashboardData }>(
        await fetch(`/api/templates/${encodeURIComponent(templateId)}/run`, {
          method: "POST"
        })
      );
      startTransition(() => {
        setData(payload.dashboard);
        setTemplateState({ kind: "success", message: "Template executed successfully." });
      });
    } catch (error) {
      setTemplateState({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to run template."
      });
    } finally {
      setIsPending(false);
    }
  };

  const deleteTemplate = async (templateId: string) => {
    setIsPending(true);

    try {
      const payload = await readJson<{ deleted: string; dashboard: DashboardData }>(
        await fetch(`/api/templates/${encodeURIComponent(templateId)}`, {
          method: "DELETE"
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

  const logout = async () => {
    setIsPending(true);

    try {
      await fetch("/api/session", {
        method: "DELETE"
      });
      window.location.reload();
    } finally {
      setIsPending(false);
    }
  };

  // Quick actions for the floating bar
  const quickActions = [
    {
      id: "create-goal",
      label: "New Goal",
      icon: <span>+</span>,
      onClick: () => document.querySelector<HTMLTextAreaElement>(".request-card textarea")?.focus(),
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
      label: "Briefing",
      icon: <span>☀</span>,
      onClick: generateBriefing,
      shortcut: "B"
    }
  ];

  return (
    <UndoProvider>
    <ApprovalNavigationProvider
      approvals={pendingApprovals}
      onApprove={(id) => respondApproval(id, "approved")}
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
                  <button type="button" onClick={() => respondApproval(approval.id, "approved")} disabled={isPending}>
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
      />

      <main className={`dashboard-shell ${theme.mode === 'dark' ? 'dark-mode' : ''}`}>
        {/* Stats Bar with Theme Toggle */}
        <div className="stats-bar-wrapper">
          <StatsBar {...statsBar.props} />
          <ThemeToggle />
        </div>

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
            <p className="eyebrow">Agentic control plane</p>
            <h1>Policy-aware orchestration with a reproducible spec document.</h1>
            <p className="lede">
              The dashboard exposes the Phase 1 foundation: request intake, approval handling, activity history, memory
              review, provider-neutral integrations, and deterministic `agentic.docx` rendering.
            </p>
          </div>
          <div className="hero-actions">
            <div className="hero-button-row">
              <button type="button" className="primary-button" onClick={renderDocs} disabled={isPending}>
                Rebuild `agentic.docx`
              </button>
              <button type="button" className="secondary-button" onClick={logout} disabled={isPending}>
                Lock session
              </button>
              <ShareLinkButton getUrl={deepLink.getShareableUrl} label="Share view" />
            </div>
            <p className="palette-hint">Press <kbd>⌘K</kbd> to open command palette · <kbd>?</kbd> for shortcuts</p>
            <p className={`status-chip ${docsState.kind}`}>{docsState.message || "Ready to build the canonical document."}</p>
          </div>
        </section>

        <section className="grid">
          <article className="card request-card">
            <div className="card-header">
              <h2>Chat intake</h2>
              <span>{data.goals.length} goals</span>
            </div>
            {/* Smart suggestion */}
            <ContextualSuggestion
              type="goal"
              currentValue={request}
              onApply={(suggestion) => setRequest(suggestion)}
            />
            <textarea
              value={request}
              onChange={(event) => setRequest(event.target.value)}
              placeholder="Example: Triage my inbox and draft replies for anything urgent."
              rows={6}
            />
            {/* Agent Override - select specific agent for this goal */}
            <AgentOverride
              value={selectedAgentId}
              onChange={setSelectedAgentId}
              disabled={isPending}
            />
            <div className="hero-button-row">
              <button type="button" className="primary-button" onClick={createGoal} disabled={isPending}>
                Create goal
              </button>
              <button type="button" className="secondary-button" onClick={generateBriefing} disabled={isPending}>
                Morning Briefing
              </button>
            </div>
            <p className={`status-chip ${submitState.kind}`}>{submitState.message || "Requests are schema-validated and policy checked before execution."}</p>
            {shareState.message ? (
              <div className="share-status-row">
                <p className={`status-chip ${shareState.kind}`}>{shareState.message}</p>
                {lastShareUrl ? (
                  <>
                    <CopyButton value={lastShareUrl} label="Copy" />
                    <a className="inline-link" href={lastShareUrl}>
                      Open public share page
                    </a>
                  </>
                ) : null}
              </div>
            ) : null}
            {refinementState.message ? (
              <p className={`status-chip ${refinementState.kind}`}>{refinementState.message}</p>
            ) : null}
            <div className="list-stack">
              {data.goals.length === 0 && <NoGoalsEmpty onCreate={() => document.querySelector<HTMLTextAreaElement>(".request-card textarea")?.focus()} />}
              {data.goals.slice(0, 4).map((bundle) => {
                const refinementLogs = bundle.actionLogs.filter((log) => log.kind === "goal.refined");
                const isActive = bundle.goal.status !== "completed";
                return (
                  <div className="list-item vertical" key={bundle.goal.id}>
                  <div>
                    <strong>{bundle.goal.title}</strong>
                    <p>{bundle.goal.explanation}</p>
                  </div>
                  <div className="goal-item-actions">
                    <StatusBadge status={bundle.goal.status} />
                    <CopyableText value={bundle.goal.id} />
                    <button type="button" className="secondary-button" onClick={() => shareGoal(bundle.goal.id, bundle.goal.title)} disabled={isPending}>
                      Copy share link
                    </button>
                    {bundle.goal.status === "completed" ? (
                      <button type="button" className="secondary-button" onClick={() => saveAsTemplate(bundle.goal.title, bundle.goal.request)} disabled={isPending}>
                        Save as template
                      </button>
                    ) : null}
                    <small className="share-metric">
                      {shareStatsByGoal.get(bundle.goal.id)?.opened ?? 0} open{(shareStatsByGoal.get(bundle.goal.id)?.opened ?? 0) === 1 ? "" : "s"}
                    </small>
                  </div>
                  {refinementLogs.length > 0 ? (
                    <div className="refinement-history">
                      {refinementLogs.map((log) => (
                        <small key={log.id} className="refinement-log">{log.message}</small>
                      ))}
                    </div>
                  ) : null}
                  {isActive ? (
                    <div className="refinement-row">
                      <input
                        value={refinementInputs[bundle.goal.id] ?? ""}
                        onChange={(event) =>
                          setRefinementInputs((prev) => ({ ...prev, [bundle.goal.id]: event.target.value }))
                        }
                        placeholder="Refine this goal..."
                        maxLength={2000}
                      />
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => refineGoal(bundle.goal.id)}
                        disabled={isPending || !(refinementInputs[bundle.goal.id] ?? "").trim()}
                      >
                        Refine
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </article>

        <article className="card" id="section-approvals">
          <div className="card-header">
            <h2>Approvals inbox</h2>
            <div className="card-header-actions">
              <ApprovalGroupSelector
                value={approvalGroupBy}
                onChange={setApprovalGroupBy}
              />
              <span>{pendingApprovals.length} pending</span>
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
                      await respondApproval(a.id, "approved");
                    }
                  }}
                >
                  {group.approvals.map((approval, idx) => {
                    // Get global index for keyboard navigation
                    const globalIndex = pendingApprovals.findIndex(a => a.id === approval.id);
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
                          <div className="list-item vertical">
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
                              <button type="button" onClick={() => respondApproval(approval.id, "approved")} disabled={isPending}>
                                Approve
                              </button>
                              <button type="button" className="secondary-button" onClick={() => respondApproval(approval.id, "rejected")} disabled={isPending}>
                                Reject
                              </button>
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
            {pendingApprovals.length === 0 ? <NoApprovalsEmpty /> : null}
            {pendingApprovals.map((approval, index) => (
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
                <div className="list-item vertical">
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
                    <button type="button" onClick={() => respondApproval(approval.id, "approved")} disabled={isPending}>
                      Approve
                    </button>
                    <button type="button" className="secondary-button" onClick={() => respondApproval(approval.id, "rejected")} disabled={isPending}>
                      Reject
                    </button>
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
            <span>{data.latestArtifacts.length} recent</span>
          </div>
          <div className="artifact-stack">
            {data.latestArtifacts.length === 0 && <NoArtifactsEmpty />}
            {data.latestArtifacts.map((artifact) => (
              <div className="artifact-card" key={artifact.id}>
                <div className="card-header">
                  <ArtifactPreview artifact={artifact}>
                    <strong>{artifact.title}</strong>
                  </ArtifactPreview>
                  <StatusBadge status={artifact.artifactType} />
                </div>
                <pre>{artifact.content}</pre>
                <div className="artifact-actions">
                  <CopyButton value={artifact.content} label="Copy content" />
                </div>
              </div>
            ))}
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

        <article className="card" id="section-memory">
          <div className="card-header">
            <h2>Memory inspector</h2>
            <span>{data.memories.length} records</span>
          </div>
          
          {/* Memory Search */}
          <MemorySearch
            memories={data.memories.map(m => ({
              id: m.id,
              content: m.content,
              category: m.category,
              memoryType: m.memoryType,
              confidence: m.confidence,
              createdAt: m.createdAt
            }))}
            categories={[...new Set(data.memories.map(m => m.category))]}
            memoryTypes={[...new Set(data.memories.map(m => m.memoryType))]}
            onSelect={(memory) => {
              // Could open memory details
            }}
          />
          
          {/* Bulk Memory Actions */}
          {memoryBulkSelection.selectedIds.size > 0 && (
            <BulkMemoryActions
              selectedMemories={data.memories
                .filter(m => memoryBulkSelection.selectedIds.has(m.id))
                .map(m => ({
                  id: m.id,
                  content: m.content,
                  category: m.category,
                  memoryType: m.memoryType,
                  confidence: m.confidence,
                  createdAt: m.createdAt
                }))}
              categories={[...new Set(data.memories.map(m => m.category))]}
              memoryTypes={["observed", "inferred", "confirmed"]}
              onDelete={async (ids) => {
                toast.info(`Would delete ${ids.length} memories`);
                memoryBulkSelection.deselectAll();
              }}
              onRecategorize={async (ids, newCategory) => {
                toast.info(`Would recategorize ${ids.length} memories to ${newCategory}`);
                memoryBulkSelection.deselectAll();
              }}
              onChangeType={async (ids, newType) => {
                toast.info(`Would change ${ids.length} memories to type ${newType}`);
                memoryBulkSelection.deselectAll();
              }}
              onExport={(memories) => {
                const json = JSON.stringify(memories, null, 2);
                const blob = new Blob([json], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "memories-export.json";
                a.click();
              }}
              onClear={memoryBulkSelection.deselectAll}
            />
          )}
          
          <label className="field">
            <span>Category</span>
            <select value={memoryCategory} onChange={(event) => setMemoryCategory(event.target.value)}>
              <option value="working-style">working-style</option>
              <option value="preferences">preferences</option>
              <option value="projects">projects</option>
              <option value="travel">travel</option>
            </select>
          </label>
          <textarea
            value={memoryContent}
            onChange={(event) => setMemoryContent(event.target.value)}
            placeholder="Add an observed or confirmed memory."
            rows={4}
          />
          <button type="button" onClick={saveMemory} disabled={isPending}>
            Save memory
          </button>
          <div className="list-stack">
            {data.memories.length === 0 && <NoMemoriesEmpty onAdd={() => document.querySelector<HTMLTextAreaElement>("#section-memory textarea")?.focus()} />}
            {data.memories.slice(0, 5).map((memory) => (
              <div 
                className={`list-item vertical ${memoryBulkSelection.selectedIds.has(memory.id) ? 'selected' : ''}`} 
                key={memory.id}
                onClick={() => memoryBulkSelection.toggle(memory.id)}
              >
                <div>
                  <strong>{memory.category}</strong>
                  <p>{memory.content}</p>
                </div>
                <div className="approval-actions">
                  <MemoryTypeHelp memoryType={memory.memoryType}>
                    <StatusBadge status={memory.memoryType} />
                  </MemoryTypeHelp>
                  <span className="pill">{Math.round(memory.confidence * 100)}%</span>
                  <RelativeTime date={memory.createdAt} />
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="card" id="section-integrations">
          <div className="card-header">
            <h2>Integrations</h2>
            <span>{data.integrations.length} adapters</span>
          </div>
          <div className="list-stack">
            {data.integrations.map((integration) => (
              <div className="list-item vertical" key={integration.id}>
                <div>
                  <strong>{integration.name}</strong>
                  <p>
                    {integration.system} · {integration.capabilities.join(", ")}
                  </p>
                </div>
                <div className="approval-actions">
                  <StatusBadge status={integration.status} />
                  <button type="button" className="secondary-button" onClick={() => cycleIntegration(integration.id, integration.status)} disabled={isPending}>
                    Toggle
                  </button>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="card" id="section-notes">
          <div className="card-header">
            <h2>Local notes</h2>
            <span>{notes.length} indexed</span>
          </div>
          <div className="note-toolbar">
            <input
              value={noteQuery}
              onChange={(event) => setNoteQuery(event.target.value)}
              placeholder="Search local notes"
            />
            <button type="button" className="secondary-button" onClick={searchNotes} disabled={isPending}>
              Search
            </button>
          </div>
          <label className="field">
            <span>Title</span>
            <input value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} placeholder="Example: Travel packing list" />
          </label>
          <textarea
            value={noteContent}
            onChange={(event) => setNoteContent(event.target.value)}
            placeholder="Write a note that should be searchable through the notes adapter."
            rows={4}
          />
          <button type="button" onClick={createLocalNote} disabled={isPending}>
            Create local note
          </button>
          <p className={`status-chip ${noteState.kind}`}>
            {noteState.message || "Search, open, and edit filesystem-backed notes through the provider-neutral adapter."}
          </p>
          <div className="list-stack">
            {notes.slice(0, 5).map((note) => (
              <div className="list-item vertical" key={note.id}>
                <div>
                  <strong>{note.title}</strong>
                  <p>{note.content.split("\n").slice(1).join(" ").trim().slice(0, 180) || "No note body."}</p>
                </div>
                <div className="note-meta-row">
                  <RelativeTime date={note.updatedAt} />
                  <button type="button" className="secondary-button" onClick={() => openLocalNote(note.slug)} disabled={isPending}>
                    Open
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="note-editor">
            <div className="card-header">
              <h3>{selectedNotePreview ? `Edit ${selectedNotePreview.title}` : "Note editor"}</h3>
              <span>{selectedNotePreview ? selectedNotePreview.slug : "Select a note"}</span>
            </div>
            <label className="field">
              <span>Editor title</span>
              <input
                value={selectedNoteTitle}
                onChange={(event) => setSelectedNoteTitleDraft(event.target.value)}
                placeholder="Open a note to edit its title"
                disabled={!selectedNoteSlug}
              />
            </label>
            <textarea
              value={selectedNoteContent}
              onChange={(event) => setSelectedNoteContentDraft(event.target.value)}
              placeholder="Open a note to edit its body."
              rows={6}
              disabled={!selectedNoteSlug}
            />
            <button type="button" onClick={saveSelectedNote} disabled={isPending || !selectedNoteSlug}>
              Save selected note
            </button>
          </div>
        </article>

        <article className="card">
          <div className="card-header">
            <FeatureHelp feature="watchers">
              <h2>Watchers</h2>
            </FeatureHelp>
            <span>{data.watchers.length} active models</span>
          </div>
          <div className="list-stack">
            {data.watchers.length === 0 ? <NoWatchersEmpty /> : null}
            {data.watchers.map((watcher) => (
              <div className="list-item vertical" key={watcher.id}>
                <div>
                  <strong>{watcher.targetEntity}</strong>
                  <p>{watcher.condition}</p>
                </div>
                <div className="approval-actions">
                  <StatusBadge status={watcher.status} />
                  <span className="pill">{watcher.frequency}</span>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="card" id="section-templates">
          <div className="card-header">
            <FeatureHelp feature="templates">
              <h2>Templates</h2>
            </FeatureHelp>
            <span>{templates.length} saved</span>
          </div>
          <button type="button" className="secondary-button" onClick={loadTemplates} disabled={isPending}>
            Load templates
          </button>
          <p className={`status-chip ${templateState.kind}`}>
            {templateState.message || "Save completed goals as reusable templates with optional scheduling."}
          </p>
          <div className="list-stack">
            {templates.length === 0 ? <NoTemplatesEmpty onLoad={loadTemplates} /> : null}
            {templates.map((template) => (
              <div className="list-item vertical" key={template.id}>
                <div>
                  <strong>{template.name}</strong>
                  <p>{template.request.slice(0, 160)}{template.request.length > 160 ? "..." : ""}</p>
                </div>
                <div className="goal-item-actions">
                  <StatusBadge status={template.schedule.enabled ? "scheduled" : "manual"} />
                  {template.schedule.enabled && <span className="pill">{template.schedule.cron}</span>}
                  <RelativeTime date={template.updatedAt} />
                  <button type="button" className="primary-button" onClick={() => runTemplate(template.id)} disabled={isPending}>
                    Run now
                  </button>
                  <button type="button" className="secondary-button" onClick={() => deleteTemplate(template.id)} disabled={isPending}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="card" id="section-agents">
          <div className="card-header">
            <h2>Agents</h2>
            <span>Custom agents</span>
          </div>
          <div className="agents-section">
            <AgentsPanel />
          </div>
        </article>
      </section>

      <FloatingActionsBar position="bottom">
        <QuickActionsBar actions={quickActions} />
      </FloatingActionsBar>

      <CommandPalette
        onCreateGoal={async (req) => {
          setRequest(req);
          await refreshDashboard(
            fetch("/api/goals", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ request: req })
            }),
            "Created a new goal bundle."
          );
          setRequest("");
        }}
        onLogout={logout}
        isPending={isPending}
      />
    </main>
    </KeyboardShortcutsProvider>
    </ApprovalNavigationProvider>
    </UndoProvider>
  );
}
