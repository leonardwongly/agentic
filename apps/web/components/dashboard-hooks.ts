"use client";

import { useCallback, useRef, useState } from "react";
import {
  workspaceRoleValues,
  type AutopilotSettings,
  type BriefingPreferences,
  type CommitmentInboxPage,
  type GoalTemplate
} from "@agentic/contracts";
import type { LocalNoteDocument } from "@agentic/integrations/client";
import type { DashboardData } from "@agentic/repository";
import type { RecommendationRefinementSource } from "../lib/workflow-recommendations";
import { loadDashboardSnapshot as fetchDashboardSnapshot } from "./dashboard-async";
import type { RecommendationLoadState } from "./dashboard-goals-card";
import type { PrivacyControlSummary, RequestState } from "./dashboard-types";
import type { ExecutionModeFilterValue, GroupBy } from "./ui";

function idleRequestState(): RequestState {
  return { kind: "idle", message: "" };
}

export function useDashboardSnapshot(initialData: DashboardData) {
  const [data, setData] = useState(initialData);

  const loadDashboardSnapshot = useCallback(async () => {
    return fetchDashboardSnapshot();
  }, []);

  return {
    data,
    setData,
    loadDashboardSnapshot
  };
}

export function useDashboardGoalActionsState() {
  const [request, setRequest] = useState("");
  const [submitState, setSubmitState] = useState<RequestState>(idleRequestState);
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(undefined);
  const [refinementInputs, setRefinementInputs] = useState<Record<string, string>>({});
  const [refinementSourceByGoal, setRefinementSourceByGoal] = useState<Record<string, RecommendationRefinementSource>>({});
  const [refinementState, setRefinementState] = useState<RequestState>(idleRequestState);
  const [recommendationState, setRecommendationState] = useState<RequestState>(idleRequestState);
  const [recommendationResultsByGoal, setRecommendationResultsByGoal] = useState<Record<string, RecommendationLoadState>>({});
  const [recommendationPendingByGoal, setRecommendationPendingByGoal] = useState<Record<string, boolean>>({});
  const recommendationQueriesRef = useRef<Record<string, string | null>>({});

  return {
    request,
    setRequest,
    submitState,
    setSubmitState,
    selectedAgentId,
    setSelectedAgentId,
    refinementInputs,
    setRefinementInputs,
    refinementSourceByGoal,
    setRefinementSourceByGoal,
    refinementState,
    setRefinementState,
    recommendationState,
    setRecommendationState,
    recommendationResultsByGoal,
    setRecommendationResultsByGoal,
    recommendationPendingByGoal,
    setRecommendationPendingByGoal,
    recommendationQueriesRef
  };
}

export function useDashboardApprovalActionsState() {
  const [approvalNotes, setApprovalNotes] = useState<Record<string, string>>({});
  const [approvalGroupBy, setApprovalGroupBy] = useState<GroupBy>("none");
  const [executionModeFilter, setExecutionModeFilter] = useState<ExecutionModeFilterValue>("all");

  return {
    approvalNotes,
    setApprovalNotes,
    approvalGroupBy,
    setApprovalGroupBy,
    executionModeFilter,
    setExecutionModeFilter
  };
}

export function useDashboardCommitmentActionsState(initialCommitmentInbox: CommitmentInboxPage) {
  const [commitmentBucket, setCommitmentBucket] = useState(initialCommitmentInbox.bucket);
  const [commitmentInbox, setCommitmentInbox] = useState(initialCommitmentInbox);
  const [commitmentInboxState, setCommitmentInboxState] = useState<RequestState>(idleRequestState);
  const commitmentInboxRequestIdRef = useRef(0);

  return {
    commitmentBucket,
    setCommitmentBucket,
    commitmentInbox,
    setCommitmentInbox,
    commitmentInboxState,
    setCommitmentInboxState,
    commitmentInboxRequestIdRef
  };
}

export function useDashboardBriefingActionsState(initialData: DashboardData) {
  const [docsState, setDocsState] = useState<RequestState>(idleRequestState);
  const [briefingState, setBriefingState] = useState<RequestState>(idleRequestState);
  const [briefingPreferencesDraft, setBriefingPreferencesDraft] = useState<BriefingPreferences>(
    initialData.briefingPreferences
  );

  return {
    docsState,
    setDocsState,
    briefingState,
    setBriefingState,
    briefingPreferencesDraft,
    setBriefingPreferencesDraft
  };
}

export function useDashboardTemplateActionsState() {
  const [templates, setTemplates] = useState<GoalTemplate[]>([]);
  const [templateState, setTemplateState] = useState<RequestState>(idleRequestState);

  return {
    templates,
    setTemplates,
    templateState,
    setTemplateState
  };
}

export function useDashboardWorkspaceActionsState<TGovernanceDraft>(params: {
  initialAutopilotDraft: AutopilotSettings;
  initialGovernanceDraft: TGovernanceDraft;
}) {
  const [autopilotState, setAutopilotState] = useState<RequestState>(idleRequestState);
  const [privacyState, setPrivacyState] = useState<RequestState>(idleRequestState);
  const [privacyInventoryState, setPrivacyInventoryState] = useState<RequestState>(idleRequestState);
  const [privacyControls, setPrivacyControls] = useState<PrivacyControlSummary | null>(null);
  const [autopilotDraft, setAutopilotDraft] = useState<AutopilotSettings>(params.initialAutopilotDraft);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceSlug, setWorkspaceSlug] = useState("");
  const [workspaceDescription, setWorkspaceDescription] = useState("");
  const [workspaceMemberUserId, setWorkspaceMemberUserId] = useState("");
  const [workspaceMemberRole, setWorkspaceMemberRole] = useState<(typeof workspaceRoleValues)[number]>("viewer");
  const [workspaceState, setWorkspaceState] = useState<RequestState>(idleRequestState);
  const [governanceState, setGovernanceState] = useState<RequestState>(idleRequestState);
  const [governanceDraft, setGovernanceDraft] = useState(params.initialGovernanceDraft);

  return {
    autopilotState,
    setAutopilotState,
    privacyState,
    setPrivacyState,
    privacyInventoryState,
    setPrivacyInventoryState,
    privacyControls,
    setPrivacyControls,
    autopilotDraft,
    setAutopilotDraft,
    workspaceName,
    setWorkspaceName,
    workspaceSlug,
    setWorkspaceSlug,
    workspaceDescription,
    setWorkspaceDescription,
    workspaceMemberUserId,
    setWorkspaceMemberUserId,
    workspaceMemberRole,
    setWorkspaceMemberRole,
    workspaceState,
    setWorkspaceState,
    governanceState,
    setGovernanceState,
    governanceDraft,
    setGovernanceDraft
  };
}

export function useDashboardNotesActionsState(initialNotes: LocalNoteDocument[]) {
  const [notes, setNotes] = useState(initialNotes);
  const [memoryContent, setMemoryContent] = useState("");
  const [memoryCategory, setMemoryCategory] = useState("working-style");
  const [noteQuery, setNoteQuery] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [selectedNoteSlug, setSelectedNoteSlug] = useState<string | null>(null);
  const [selectedNoteTitle, setSelectedNoteTitle] = useState("");
  const [selectedNoteContent, setSelectedNoteContent] = useState("");
  const [noteState, setNoteState] = useState<RequestState>(idleRequestState);
  const selectedNoteTitleRef = useRef("");
  const selectedNoteContentRef = useRef("");

  const setSelectedNoteTitleDraft = useCallback((value: string) => {
    selectedNoteTitleRef.current = value;
    setSelectedNoteTitle(value);
  }, []);

  const setSelectedNoteContentDraft = useCallback((value: string) => {
    selectedNoteContentRef.current = value;
    setSelectedNoteContent(value);
  }, []);

  const loadSelectedNoteDraft = useCallback(
    (note: LocalNoteDocument) => {
      setSelectedNoteSlug(note.slug);
      setSelectedNoteTitleDraft(note.title);
      setSelectedNoteContentDraft(note.content.replace(/^#\s+.*\n\n?/u, "").trim());
    },
    [setSelectedNoteContentDraft, setSelectedNoteTitleDraft]
  );

  const clearSelectedNoteDraft = useCallback(() => {
    setSelectedNoteSlug(null);
    setSelectedNoteTitleDraft("");
    setSelectedNoteContentDraft("");
  }, [setSelectedNoteContentDraft, setSelectedNoteTitleDraft]);

  return {
    notes,
    setNotes,
    memoryContent,
    setMemoryContent,
    memoryCategory,
    setMemoryCategory,
    noteQuery,
    setNoteQuery,
    noteTitle,
    setNoteTitle,
    noteContent,
    setNoteContent,
    selectedNoteSlug,
    selectedNoteTitle,
    selectedNoteContent,
    noteState,
    setNoteState,
    selectedNoteTitleRef,
    selectedNoteContentRef,
    setSelectedNoteTitleDraft,
    setSelectedNoteContentDraft,
    loadSelectedNoteDraft,
    clearSelectedNoteDraft
  };
}
