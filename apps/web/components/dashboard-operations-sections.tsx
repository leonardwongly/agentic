"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import {
  autopilotModeValues,
  privacyOperationKindValues,
  type GoalShareRecord,
  type PrivacyOperation,
  workspaceApprovalModeValues,
  workspaceRoleValues,
  type AutopilotMode,
  type AutopilotSettings,
  type WorkspaceGovernance
} from "@agentic/contracts";
import type { DashboardData, DashboardDiagnosticTarget } from "@agentic/repository";
import { Badge, RelativeTime, StatusBadge } from "./ui";
import {
  GOAL_SHARE_MUTATION_DENIED_REASON,
  canManageGoalSharesForRole,
  resolveWorkspaceRoleForUser
} from "../lib/workspace-role-permissions";

type RequestState = {
  kind: "idle" | "success" | "error";
  message: string;
};

type PrivacyControlSummary = {
  registryVersion: number;
  reviewedAt: string;
  owners: string[];
  totalDatasets: number;
  classifications: Array<{
    id: string;
    label: string;
    summary: string;
    datasetCount: number;
  }>;
  lifecycleOperations: Array<(typeof privacyOperationKindValues)[number]>;
  datasets: Array<{
    id: string;
    title: string;
    classificationId: string;
    classificationLabel: string;
    retentionLabel: string;
    tokenizationStrategy: "opaque_identifier" | "redacted_reference" | "not_applicable";
    productSurfaceCount: number;
    minimizationRuleCount: number;
    maskingRuleCount: number;
    lifecycleOperations: Array<(typeof privacyOperationKindValues)[number]>;
  }>;
};

type GovernanceConformanceSummary = NonNullable<DashboardData["governanceConformance"]>;
type GovernanceConformanceCheck = GovernanceConformanceSummary["checks"][number];

type WorkspaceGovernanceDraft = Omit<WorkspaceGovernance, "workspaceId" | "updatedBy" | "createdAt" | "updatedAt">;

type DashboardOperationsSectionsProps = {
  data: DashboardData;
  isPending: boolean;
  highlightedItemId: string | null;
  workspaceState: RequestState;
  governanceState: RequestState;
  autopilotState: RequestState;
  privacyState: RequestState;
  privacyInventoryState?: RequestState;
  privacyControls?: PrivacyControlSummary | null;
  workspaceName: string;
  setWorkspaceName: Dispatch<SetStateAction<string>>;
  workspaceSlug: string;
  setWorkspaceSlug: Dispatch<SetStateAction<string>>;
  workspaceDescription: string;
  setWorkspaceDescription: Dispatch<SetStateAction<string>>;
  workspaceMemberUserId: string;
  setWorkspaceMemberUserId: Dispatch<SetStateAction<string>>;
  workspaceMemberRole: (typeof workspaceRoleValues)[number];
  setWorkspaceMemberRole: Dispatch<SetStateAction<(typeof workspaceRoleValues)[number]>>;
  governanceDraft: WorkspaceGovernanceDraft;
  setGovernanceDraft: Dispatch<SetStateAction<WorkspaceGovernanceDraft>>;
  autopilotDraft: AutopilotSettings;
  setAutopilotDraft: Dispatch<SetStateAction<AutopilotSettings>>;
  getItemAnchorId: (itemId: string) => string;
  openDiagnosticTarget: (target: DashboardDiagnosticTarget) => void;
  createWorkspace: () => Promise<void>;
  selectWorkspace: (workspaceId: string) => Promise<void>;
  addWorkspaceMember: () => Promise<void>;
  saveWorkspaceGovernance: () => Promise<void>;
  exportWorkspaceAudit: () => Promise<void>;
  saveAutopilotSettings: () => Promise<void>;
  runPrivacyOperation: (
    kind: (typeof privacyOperationKindValues)[number],
    options?: { confirmationPhrase?: string }
  ) => Promise<void>;
  revokeGoalShare: (goalId: string, shareId: string, title: string) => Promise<void>;
};

const autopilotModeLabels: Record<AutopilotMode, string> = {
  notify_only: "Notify only",
  draft_goal: "Draft goal",
  auto_run: "Auto-run"
};

const privacyOperationLabels: Record<(typeof privacyOperationKindValues)[number], string> = {
  retention_enforcement: "Run retention enforcement",
  workspace_export: "Queue workspace export",
  workspace_delete: "Queue workspace deletion"
};

const privacyOperationDescriptions: Record<(typeof privacyOperationKindValues)[number], string> = {
  retention_enforcement: "Revoke expired shares and purge privacy records that have aged past the retention window.",
  workspace_export: "Package the current workspace audit data through the durable worker path.",
  workspace_delete: "Delete shared workspace data and leave only a tombstone plus the owner audit trail."
};
const WORKSPACE_DELETE_CONFIRMATION_PHRASE = "delete workspace";

const privacyOperationStatusLabels: Record<PrivacyOperation["status"], string> = {
  queued: "queued",
  running: "running",
  completed: "completed",
  failed: "failed"
};

const privacyTokenizationLabels: Record<PrivacyControlSummary["datasets"][number]["tokenizationStrategy"], string> = {
  opaque_identifier: "Opaque IDs",
  redacted_reference: "Redacted refs",
  not_applicable: "Not applicable"
};

const governanceConformanceLabels: Record<GovernanceConformanceSummary["status"], string> = {
  conformant: "Conformant",
  needs_attention: "Needs attention",
  non_conformant: "Blocking exceptions"
};

const governanceCheckGuidance: Record<
  string,
  {
    control: string;
    remediation: string;
  }
> = {
  "audit-exports": {
    control: "Require audit exports",
    remediation: "Enable the audit export requirement so investigators and reviewers can retrieve evidence on demand."
  },
  "external-send-approval": {
    control: "External sends always require approval",
    remediation: "Turn approval back on before allowing outbound communication to leave the workspace."
  },
  "calendar-write-approval": {
    control: "Calendar writes always require approval",
    remediation: "Re-enable review unless you have a documented exception for autonomous scheduling."
  },
  "risk-ceiling": {
    control: "Max auto-run risk class",
    remediation: "Keep the ceiling at R2 or lower unless you can justify autonomous external commitments."
  },
  "always-review-ceiling": {
    control: "Approval mode and max auto-run risk class",
    remediation: "If the workspace stays in always-review mode, reduce the stored ceiling to R1 so operators do not inherit a misleading policy."
  },
  "retention-window": {
    control: "Retention days",
    remediation: "Keep retention inside the 30 to 730 day operating range unless a documented legal or privacy exception applies."
  }
};

function getGovernanceConformanceVariant(status: GovernanceConformanceSummary["status"]): "success" | "warning" | "error" {
  switch (status) {
    case "conformant":
      return "success";
    case "needs_attention":
      return "warning";
    default:
      return "error";
  }
}

function getGovernanceCheckVariant(status: GovernanceConformanceCheck["status"]): "success" | "warning" | "error" {
  switch (status) {
    case "pass":
      return "success";
    case "warn":
      return "warning";
    default:
      return "error";
  }
}

function getGovernanceCheckGuidance(check: GovernanceConformanceCheck) {
  return (
    governanceCheckGuidance[check.id] ?? {
      control: "Governance policy",
      remediation: "Review this setting and bring it back into the workspace default conformance range."
    }
  );
}

function formatPrivacyOperationTimestamp(operation: PrivacyOperation): string {
  return operation.completedAt ?? operation.startedAt ?? operation.updatedAt;
}

function summarizeGoalShareStatus(share: GoalShareRecord): string {
  if (share.status === "revoked") {
    return share.revokedAt ? `Revoked ${share.revokedAt}` : "Revoked";
  }

  if (share.lastViewedAt) {
    return `Viewed ${share.lastViewedAt}`;
  }

  return `Expires ${share.expiresAt}`;
}

function formatAutopilotLabel(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function readAutopilotMetadata(details: Record<string, unknown> | undefined) {
  const eventEnvelope =
    details && typeof details.eventEnvelope === "object" && details.eventEnvelope !== null
      ? (details.eventEnvelope as Record<string, unknown>)
      : null;
  const policy =
    details && typeof details.policy === "object" && details.policy !== null ? (details.policy as Record<string, unknown>) : null;
  const operatorRoute =
    details && typeof details.operatorRoute === "object" && details.operatorRoute !== null
      ? (details.operatorRoute as Record<string, unknown>)
      : null;

  return {
    family: typeof eventEnvelope?.family === "string" ? eventEnvelope.family : null,
    priority: typeof eventEnvelope?.priority === "string" ? eventEnvelope.priority : null,
    queue: typeof policy?.queue === "string" ? policy.queue : null,
    operatorRoute:
      typeof operatorRoute?.section === "string" && typeof operatorRoute?.label === "string"
        ? {
            section: operatorRoute.section as DashboardDiagnosticTarget["section"],
            itemId: typeof operatorRoute.itemId === "string" ? operatorRoute.itemId : undefined,
            label: operatorRoute.label,
            actionLabel: typeof operatorRoute.actionLabel === "string" ? operatorRoute.actionLabel : undefined
          }
        : null
  };
}

export function DashboardOperationsSections(props: DashboardOperationsSectionsProps) {
  const {
    data,
    isPending,
    highlightedItemId,
    workspaceState,
    governanceState,
    autopilotState,
    privacyState,
    privacyInventoryState = { kind: "idle", message: "" },
    privacyControls = null,
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
    governanceDraft,
    setGovernanceDraft,
    autopilotDraft,
    setAutopilotDraft,
    getItemAnchorId,
    openDiagnosticTarget,
    createWorkspace,
    selectWorkspace,
    addWorkspaceMember,
    saveWorkspaceGovernance,
    exportWorkspaceAudit,
    saveAutopilotSettings,
    runPrivacyOperation,
    revokeGoalShare
  } = props;
  const goalTitleById = new Map(data.goals.map((bundle) => [bundle.goal.id, bundle.goal.title]));
  const teamPermissions = data.operatingSections.teamWorkflow.permissions;
  const canManageMembers = teamPermissions.manageMembers.allowed && Boolean(data.activeWorkspace);
  const canEditGovernance = teamPermissions.editGovernance.allowed && Boolean(data.activeWorkspace);
  const canExportAudit = teamPermissions.exportAudit.allowed && Boolean(data.activeWorkspace);
  const canManagePrivacyOperations = teamPermissions.managePrivacyOperations.allowed && Boolean(data.activeWorkspace);
  const activeWorkspaceRole = resolveWorkspaceRoleForUser(
    data.workspaceMembers,
    data.activeWorkspace?.id,
    data.workspaceSelection?.userId ?? null
  );
  const canManageGoalShares = Boolean(data.activeWorkspace) && canManageGoalSharesForRole(activeWorkspaceRole);
  const goalSharePermissionReason = data.activeWorkspace
    ? GOAL_SHARE_MUTATION_DENIED_REASON
    : "Select a workspace before managing public goal share links.";
  const governanceConformance = data.governanceConformance ?? null;
  const blockingGovernanceChecks = governanceConformance?.checks.filter((check) => check.status === "fail") ?? [];
  const warningGovernanceChecks = governanceConformance?.checks.filter((check) => check.status === "warn") ?? [];
  const [workspaceDeleteDialogOpen, setWorkspaceDeleteDialogOpen] = useState(false);
  const [workspaceDeleteConfirmationPhrase, setWorkspaceDeleteConfirmationPhrase] = useState("");
  const workspaceDeleteConfirmationValid =
    workspaceDeleteConfirmationPhrase.trim().toLowerCase() === WORKSPACE_DELETE_CONFIRMATION_PHRASE;

  const closeWorkspaceDeleteDialog = () => {
    setWorkspaceDeleteDialogOpen(false);
    setWorkspaceDeleteConfirmationPhrase("");
  };

  const handlePrivacyOperationClick = (kind: (typeof privacyOperationKindValues)[number]) => {
    if (kind === "workspace_delete") {
      setWorkspaceDeleteDialogOpen(true);
      return;
    }

    void runPrivacyOperation(kind);
  };

  const confirmWorkspaceDelete = async () => {
    if (!workspaceDeleteConfirmationValid) {
      return;
    }

    await runPrivacyOperation("workspace_delete", {
      confirmationPhrase: workspaceDeleteConfirmationPhrase
    });
    closeWorkspaceDeleteDialog();
  };

  return (
    <>
      <article className="card" id="section-workspaces">
        <div className="card-header">
          <div>
            <h2>Workspace</h2>
            <p className="operator-product-subtitle">
              Goals, approvals, and watchers are now scoped to the active workspace instead of a flat single-user queue.
            </p>
          </div>
          <span>{data.workspaces.length} available</span>
        </div>
        <p className={`status-chip ${workspaceState.kind}`}>
          {workspaceState.message ||
            (data.activeWorkspace
              ? `Active workspace: ${data.activeWorkspace.name} (${data.activeWorkspace.slug})`
              : "No active workspace is selected.")}
        </p>
        <div className="list-stack compact">
          {data.workspaces.map((workspace) => {
            const isActive = workspace.id === data.activeWorkspace?.id;

            return (
              <div className={`list-item vertical ${isActive ? "selection-highlight" : ""}`} key={workspace.id}>
                <div className="operator-product-row-heading">
                  <div>
                    <strong>{workspace.name}</strong>
                    <p>{workspace.slug}{workspace.description ? ` · ${workspace.description}` : ""}</p>
                  </div>
                  <div className="goal-item-actions">
                    {workspace.isPersonal ? <span className="pill">personal</span> : null}
                    <button
                      type="button"
                      className={isActive ? "secondary-button" : "primary-button"}
                      onClick={() => void selectWorkspace(workspace.id)}
                      disabled={isPending || isActive}
                    >
                      {isActive ? "Selected" : "Switch"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="list-stack compact">
          <label className="field">
            <span>Name</span>
            <input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="Growth operations" />
          </label>
          <label className="field">
            <span>Slug</span>
            <input value={workspaceSlug} onChange={(event) => setWorkspaceSlug(event.target.value)} placeholder="growth-operations" />
          </label>
          <label className="field">
            <span>Description</span>
            <textarea
              rows={2}
              value={workspaceDescription}
              onChange={(event) => setWorkspaceDescription(event.target.value)}
              placeholder="Shared execution lane for a team or business function."
            />
          </label>
          <button type="button" className="primary-button" onClick={() => void createWorkspace()} disabled={isPending}>
            Create workspace
          </button>
        </div>
        <div className="card-header">
          <h3>Members</h3>
          <span>{data.workspaceMembers.length} visible</span>
        </div>
        <div className="list-stack compact">
          {data.workspaceMembers.map((member) => (
            <div className="list-item vertical" key={member.id}>
              <div className="operator-product-row-heading">
                <div>
                  <strong>{member.userId}</strong>
                  <p>Joined <RelativeTime date={member.joinedAt} /></p>
                </div>
                <span className="pill">{member.role}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="list-stack compact" style={{ opacity: canManageMembers ? 1 : 0.65 }}>
          <label className="field">
            <span>Member user ID</span>
            <input
              value={workspaceMemberUserId}
              onChange={(event) => setWorkspaceMemberUserId(event.target.value)}
              placeholder="alex@example.com"
              disabled={isPending || !canManageMembers}
            />
          </label>
          <label className="field">
            <span>Role</span>
            <select
              value={workspaceMemberRole}
              onChange={(event) => setWorkspaceMemberRole(event.target.value as (typeof workspaceRoleValues)[number])}
              disabled={isPending || !canManageMembers}
            >
              {workspaceRoleValues.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="secondary-button" onClick={() => void addWorkspaceMember()} disabled={isPending || !canManageMembers}>
            Add member
          </button>
          {!canManageMembers ? <p className="operator-product-subtitle">{teamPermissions.manageMembers.reason}</p> : null}
        </div>
      </article>

      <article className="card" id="section-governance">
        <div className="card-header">
          <div>
            <h2>Governance</h2>
            <p className="operator-product-subtitle">
              Approval policy and audit defaults stay at the workspace boundary so collaboration does not widen autonomy silently.
            </p>
          </div>
          <button type="button" className="secondary-button" onClick={() => void exportWorkspaceAudit()} disabled={isPending || !canExportAudit}>
            Export audit
          </button>
        </div>
        <p className={`status-chip ${governanceState.kind}`}>
          {governanceState.message ||
            (data.activeWorkspace
              ? `Editing governance for ${data.activeWorkspace.name}.`
              : "Select a workspace before editing governance.")}
        </p>
        <p className="operator-product-subtitle">{teamPermissions.exportAudit.reason}</p>
        <div className="list-stack compact" style={{ opacity: canEditGovernance ? 1 : 0.65 }}>
        {governanceConformance ? (
          <div className="list-stack compact">
            <div className="list-item vertical">
              <div className="operator-product-row-heading">
                <div>
                  <strong>Conformance status</strong>
                  <p>{governanceConformance.summary}</p>
                </div>
                <div className="goal-item-actions">
                  <Badge variant={getGovernanceConformanceVariant(governanceConformance.status)}>
                    {governanceConformanceLabels[governanceConformance.status]}
                  </Badge>
                  <span className="pill">{blockingGovernanceChecks.length} blocking</span>
                  <span className="pill">{warningGovernanceChecks.length} warnings</span>
                </div>
              </div>
            </div>
            {blockingGovernanceChecks.length > 0 ? (
              <div className="list-stack compact">
                {blockingGovernanceChecks.map((check) => {
                  const guidance = getGovernanceCheckGuidance(check);

                  return (
                    <div className="list-item vertical" key={check.id}>
                      <div className="operator-product-row-heading">
                        <div>
                          <strong>{check.summary}</strong>
                          <p>{check.detail}</p>
                        </div>
                        <Badge variant={getGovernanceCheckVariant(check.status)}>Action required</Badge>
                      </div>
                      <p>
                        <strong>{guidance.control}:</strong> {guidance.remediation}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : null}
            {warningGovernanceChecks.length > 0 ? (
              <div className="list-stack compact">
                {warningGovernanceChecks.map((check) => {
                  const guidance = getGovernanceCheckGuidance(check);

                  return (
                    <div className="list-item vertical" key={check.id}>
                      <div className="operator-product-row-heading">
                        <div>
                          <strong>{check.summary}</strong>
                          <p>{check.detail}</p>
                        </div>
                        <Badge variant={getGovernanceCheckVariant(check.status)}>Needs review</Badge>
                      </div>
                      <p>
                        <strong>{guidance.control}:</strong> {guidance.remediation}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}
        </div>
        <p className="operator-product-subtitle">{teamPermissions.exportAudit.reason}</p>
        <div className="list-stack compact" style={{ opacity: canEditGovernance ? 1 : 0.65 }}>
          <label className="field">
            <span>Approval mode</span>
            <select
              value={governanceDraft.approvalMode}
              disabled={isPending || !canEditGovernance}
              onChange={(event) =>
                setGovernanceDraft((current) => ({
                  ...current,
                  approvalMode: event.target.value as (typeof workspaceApprovalModeValues)[number]
                }))
              }
            >
              {workspaceApprovalModeValues.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Max auto-run risk class</span>
            <select
              value={governanceDraft.maxAutoRunRiskClass}
              disabled={isPending || !canEditGovernance}
              onChange={(event) =>
                setGovernanceDraft((current) => ({
                  ...current,
                  maxAutoRunRiskClass: event.target.value as WorkspaceGovernance["maxAutoRunRiskClass"]
                }))
              }
            >
              {["R0", "R1", "R2", "R3"].map((riskClass) => (
                <option key={riskClass} value={riskClass}>
                  {riskClass}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Retention days</span>
            <input
              type="number"
              min={7}
              max={3650}
              value={governanceDraft.retentionDays}
              disabled={isPending || !canEditGovernance}
              onChange={(event) =>
                setGovernanceDraft((current) => ({
                  ...current,
                  retentionDays: Number(event.target.value)
                }))
              }
            />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={governanceDraft.requireAuditExports}
              disabled={isPending || !canEditGovernance}
              onChange={(event) =>
                setGovernanceDraft((current) => ({
                  ...current,
                  requireAuditExports: event.target.checked
                }))
              }
            />
            Require audit exports for compliance-heavy workflows
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={governanceDraft.publicSharingEnabled}
              disabled={isPending || !canEditGovernance}
              onChange={(event) =>
                setGovernanceDraft((current) => ({
                  ...current,
                  publicSharingEnabled: event.target.checked
                }))
              }
            />
            Enable public goal share links
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={governanceDraft.providerAccessRequiresApproval}
              disabled={isPending || !canEditGovernance}
              onChange={(event) =>
                setGovernanceDraft((current) => ({
                  ...current,
                  providerAccessRequiresApproval: event.target.checked
                }))
              }
            />
            Provider-backed actions require approval
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={governanceDraft.escalationRequiresApproval}
              disabled={isPending || !canEditGovernance}
              onChange={(event) =>
                setGovernanceDraft((current) => ({
                  ...current,
                  escalationRequiresApproval: event.target.checked
                }))
              }
            />
            Escalation actions require approval
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={governanceDraft.externalSendRequiresApproval}
              disabled={isPending || !canEditGovernance}
              onChange={(event) =>
                setGovernanceDraft((current) => ({
                  ...current,
                  externalSendRequiresApproval: event.target.checked
                }))
              }
            />
            External sends always require approval
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={governanceDraft.calendarWriteRequiresApproval}
              disabled={isPending || !canEditGovernance}
              onChange={(event) =>
                setGovernanceDraft((current) => ({
                  ...current,
                  calendarWriteRequiresApproval: event.target.checked
                }))
              }
            />
            Calendar writes always require approval
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={governanceDraft.shadowReplayPolicy.enabled}
              disabled={isPending || !canEditGovernance}
              onChange={(event) =>
                setGovernanceDraft((current) => ({
                  ...current,
                  shadowReplayPolicy: {
                    ...current.shadowReplayPolicy,
                    enabled: event.target.checked
                  }
                }))
              }
            />
            Require shadow replay evidence before widening to R3 autonomy
          </label>
          <label className="field">
            <span>Learning promotion mode</span>
            <select
              value={governanceDraft.shadowReplayPolicy.promotionMode}
              disabled={isPending || !canEditGovernance}
              onChange={(event) =>
                setGovernanceDraft((current) => ({
                  ...current,
                  shadowReplayPolicy: {
                    ...current.shadowReplayPolicy,
                    promotionMode: event.target.value as WorkspaceGovernance["shadowReplayPolicy"]["promotionMode"]
                  }
                }))
              }
            >
              <option value="validated_autonomy">validated_autonomy</option>
              <option value="shadow_only">shadow_only</option>
              <option value="disabled">disabled</option>
            </select>
          </label>
          <label className="field">
            <span>Learning rollback outcome</span>
            <select
              value={governanceDraft.shadowReplayPolicy.rollbackOutcome}
              disabled={isPending || !canEditGovernance}
              onChange={(event) =>
                setGovernanceDraft((current) => ({
                  ...current,
                  shadowReplayPolicy: {
                    ...current.shadowReplayPolicy,
                    rollbackOutcome: event.target.value as WorkspaceGovernance["shadowReplayPolicy"]["rollbackOutcome"]
                  }
                }))
              }
            >
              <option value="allowed_with_confirmation">allowed_with_confirmation</option>
              <option value="downgrade_to_draft">downgrade_to_draft</option>
            </select>
          </label>
          <label className="field">
            <span>Shadow replay minimum matched episodes</span>
            <input
              type="number"
              min={1}
              max={50}
              value={governanceDraft.shadowReplayPolicy.minimumMatchedEpisodes}
              disabled={isPending || !canEditGovernance}
              onChange={(event) =>
                setGovernanceDraft((current) => ({
                  ...current,
                  shadowReplayPolicy: {
                    ...current.shadowReplayPolicy,
                    minimumMatchedEpisodes: Number(event.target.value)
                  }
                }))
              }
            />
          </label>
          <label className="field">
            <span>Shadow replay minimum precision</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={governanceDraft.shadowReplayPolicy.minimumPrecision}
              disabled={isPending || !canEditGovernance}
              onChange={(event) =>
                setGovernanceDraft((current) => ({
                  ...current,
                  shadowReplayPolicy: {
                    ...current.shadowReplayPolicy,
                    minimumPrecision: Number(event.target.value)
                  }
                }))
              }
            />
          </label>
          <label className="field">
            <span>Shadow replay maximum negative outcome rate</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={governanceDraft.shadowReplayPolicy.maximumNegativeOutcomeRate}
              disabled={isPending || !canEditGovernance}
              onChange={(event) =>
                setGovernanceDraft((current) => ({
                  ...current,
                  shadowReplayPolicy: {
                    ...current.shadowReplayPolicy,
                    maximumNegativeOutcomeRate: Number(event.target.value)
                  }
                }))
              }
            />
          </label>
          <label className="field">
            <span>Shadow replay maximum failure cost rate</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={governanceDraft.shadowReplayPolicy.maximumFailureCostRate}
              disabled={isPending || !canEditGovernance}
              onChange={(event) =>
                setGovernanceDraft((current) => ({
                  ...current,
                  shadowReplayPolicy: {
                    ...current.shadowReplayPolicy,
                    maximumFailureCostRate: Number(event.target.value)
                  }
                }))
              }
            />
          </label>
          <button type="button" className="primary-button" onClick={() => void saveWorkspaceGovernance()} disabled={isPending || !canEditGovernance}>
            Save governance
          </button>
          {!canEditGovernance ? <p className="operator-product-subtitle">{teamPermissions.editGovernance.reason}</p> : null}
        </div>
      </article>

      <article className="card" id="section-privacy">
        <div className="card-header">
          <div>
            <h2>Privacy lifecycle</h2>
            <p className="operator-product-subtitle">
              Share links, retention, exports, and destructive deletion all run through persisted records so privacy controls survive retries and multiple instances.
            </p>
          </div>
          <span>{data.privacyOperations.length} recent operations</span>
        </div>
        <p className={`status-chip ${privacyState.kind}`}>
          {privacyState.message ||
            (data.activeWorkspace
              ? `Privacy controls are scoped to ${data.activeWorkspace.name}.`
              : "Select a workspace before running privacy operations.")}
        </p>
        <div className="card-header">
          <h3>Data handling inventory</h3>
          <span>{privacyControls ? `${privacyControls.totalDatasets} datasets` : "Unavailable"}</span>
        </div>
        <p className={`status-chip ${privacyInventoryState.kind}`}>
          {privacyInventoryState.message ||
            (privacyControls
              ? `Registry owners: ${privacyControls.owners.join(", ")}.`
              : "Privacy inventory has not loaded yet.")}
        </p>
        {privacyControls ? (
          <div className="list-stack compact">
            <div className="list-item vertical">
              <div>
                <strong>Coverage summary</strong>
                <p>
                  {privacyControls.classifications.length} classifications across {privacyControls.totalDatasets} datasets. Lifecycle operations:
                  {" "}
                  {privacyControls.lifecycleOperations.map((kind) => privacyOperationLabels[kind]).join(", ")}.
                </p>
              </div>
              <div className="goal-item-actions">
                <span className="pill">registry v{privacyControls.registryVersion}</span>
              </div>
            </div>
            {privacyControls.classifications.map((classification) => (
              <div className="list-item vertical" key={classification.id}>
                <div>
                  <strong>{classification.label}</strong>
                  <p>{classification.summary}</p>
                </div>
                <div className="goal-item-actions">
                  <span className="pill">{classification.datasetCount} datasets</span>
                </div>
              </div>
            ))}
            {privacyControls.datasets.map((dataset) => (
              <div className="list-item vertical" key={dataset.id}>
                <div>
                  <strong>{dataset.title}</strong>
                  <p>
                    {dataset.classificationLabel} · {dataset.retentionLabel}
                  </p>
                </div>
                <div className="goal-item-actions">
                  <span className="pill">{privacyTokenizationLabels[dataset.tokenizationStrategy]}</span>
                  <span className="pill">{dataset.productSurfaceCount} surfaces</span>
                  <span className="pill">{dataset.minimizationRuleCount} minimization</span>
                  <span className="pill">{dataset.maskingRuleCount} masking</span>
                </div>
                <p>
                  Lifecycle hooks: {dataset.lifecycleOperations.map((kind) => privacyOperationLabels[kind]).join(", ")}.
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="list-stack compact">
            <div className="list-item vertical">
              <div>
                <strong>Inventory unavailable</strong>
                <p>Load the workspace privacy controls to inspect classifications, minimization, masking, and tokenization coverage.</p>
              </div>
            </div>
          </div>
        )}
        <div className="list-stack compact" style={{ opacity: canManagePrivacyOperations ? 1 : 0.65 }}>
          {privacyOperationKindValues.map((kind) => (
            <div className="list-item vertical" key={kind}>
              <div>
                <strong>{privacyOperationLabels[kind]}</strong>
                <p>{privacyOperationDescriptions[kind]}</p>
              </div>
              <div className="goal-item-actions">
                <button
                  type="button"
                  className={kind === "workspace_delete" ? "danger-button" : "secondary-button"}
                  onClick={() => handlePrivacyOperationClick(kind)}
                  disabled={isPending || !canManagePrivacyOperations}
                >
                  {privacyOperationLabels[kind]}
                </button>
              </div>
            </div>
          ))}
          {!canManagePrivacyOperations ? (
            <p className="operator-product-subtitle">{teamPermissions.managePrivacyOperations.reason}</p>
          ) : null}
        </div>
        {workspaceDeleteDialogOpen ? (
          <div className="batch-confirm-overlay" onClick={closeWorkspaceDeleteDialog}>
            <div
              className="batch-confirm-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="workspace-delete-confirm-title"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  closeWorkspaceDeleteDialog();
                }
              }}
            >
              <h3 id="workspace-delete-confirm-title">Confirm workspace deletion</h3>
              <p>
                This queues a destructive worker job for {data.activeWorkspace?.name ?? "the active workspace"}. The job can delete
                shared workspace data and preserve only tombstone and owner audit records.
              </p>
              <label className="field-label" htmlFor="workspace-delete-confirmation">
                Type {WORKSPACE_DELETE_CONFIRMATION_PHRASE} to queue deletion
              </label>
              <input
                id="workspace-delete-confirmation"
                autoFocus
                value={workspaceDeleteConfirmationPhrase}
                onChange={(event) => setWorkspaceDeleteConfirmationPhrase(event.target.value)}
                disabled={isPending}
              />
              <div className="batch-confirm-actions">
                <button type="button" className="secondary-button" onClick={closeWorkspaceDeleteDialog} disabled={isPending}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => void confirmWorkspaceDelete()}
                  disabled={isPending || !workspaceDeleteConfirmationValid}
                >
                  Queue workspace deletion
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="card-header">
          <h3>Recent share links</h3>
          <span>{data.goalShares.length} tracked</span>
        </div>
        <div className="list-stack" style={{ opacity: canManageGoalShares ? 1 : 0.65 }}>
          {data.goalShares.length === 0 ? (
            <div className="list-item vertical">
              <div>
                <strong>No active share history</strong>
                <p>New goal shares will appear here with revoke controls and view status.</p>
              </div>
            </div>
          ) : (
            data.goalShares.slice(0, 8).map((share) => (
              <div className="list-item vertical" key={share.id}>
                <div>
                  <strong>{goalTitleById.get(share.goalId) ?? share.goalId}</strong>
                  <p>{summarizeGoalShareStatus(share)}</p>
                </div>
                <div className="goal-item-actions">
                  <span className="pill">{share.status}</span>
                  <RelativeTime date={share.updatedAt} />
                  {share.status === "active" ? (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void revokeGoalShare(share.goalId, share.id, goalTitleById.get(share.goalId) ?? share.goalId)}
                      disabled={isPending || !canManageGoalShares}
                      title={!canManageGoalShares ? goalSharePermissionReason : undefined}
                    >
                      Revoke
                    </button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
        {!canManageGoalShares ? <p className="operator-product-subtitle">{goalSharePermissionReason}</p> : null}

        <div className="card-header">
          <h3>Recent privacy operations</h3>
          <span>{data.privacyOperations.length} recorded</span>
        </div>
        <div className="list-stack">
          {data.privacyOperations.length === 0 ? (
            <div className="list-item vertical">
              <div>
                <strong>No privacy operations yet</strong>
                <p>Retention enforcement, exports, and deletion workflows will be logged here as they run.</p>
              </div>
            </div>
          ) : (
            data.privacyOperations.slice(0, 8).map((operation) => (
              <div className="list-item vertical" key={operation.id}>
                <div>
                  <strong>{privacyOperationLabels[operation.kind]}</strong>
                  <p>
                    Requested by {operation.requestedBy} · {operation.jobId ? `job ${operation.jobId}` : "queueing pending"}
                  </p>
                </div>
                <div className="goal-item-actions">
                  <span className="pill">{privacyOperationStatusLabels[operation.status]}</span>
                  <RelativeTime date={formatPrivacyOperationTimestamp(operation)} />
                </div>
                {operation.error ? <p className="status-chip error">{operation.error}</p> : null}
              </div>
            ))
          )}
        </div>
      </article>

      <article className="card" id="section-autopilot">
        <div className="card-header">
          <h2>Autopilot policy</h2>
          <span>{data.autopilotEvents.length} recent events</span>
        </div>
        <p className={`status-chip ${autopilotState.kind}`}>
          {autopilotState.message ||
            "Event-triggered automation stays bounded by a mode policy, per-source debounce, and an auditable event log."}
        </p>
        <div className="list-stack">
          <label className="field">
            <span>Execution mode</span>
            <select
              value={autopilotDraft.mode}
              onChange={(event) =>
                setAutopilotDraft((current) => ({
                  ...current,
                  mode: event.target.value as AutopilotMode
                }))
              }
            >
              {autopilotModeValues.map((mode) => (
                <option key={mode} value={mode}>
                  {autopilotModeLabels[mode]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Debounce window (minutes)</span>
            <input
              type="number"
              min={1}
              max={1440}
              step={1}
              value={autopilotDraft.debounceMinutes}
              onChange={(event) =>
                setAutopilotDraft((current) => ({
                  ...current,
                  debounceMinutes: Number.parseInt(event.target.value, 10) || current.debounceMinutes
                }))
              }
            />
          </label>
          <div className="hero-button-row">
            <button type="button" className="secondary-button" onClick={() => void saveAutopilotSettings()} disabled={isPending}>
              Save autopilot settings
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setAutopilotDraft(data.autopilotSettings)}
              disabled={isPending}
            >
              Reset
            </button>
          </div>
        </div>
        <div className="list-stack">
          {data.autopilotEvents.length === 0 ? (
            <div className="list-item vertical">
              <div>
                <strong>No autopilot events yet</strong>
                <p>
                  Watcher signals, scheduled runs, inbound communications, deadlines, approvals, connector failures,
                  and dormant workflows will appear here once they fire.
                </p>
              </div>
            </div>
          ) : (
            data.autopilotEvents.slice(0, 5).map((event) => {
              const metadata = readAutopilotMetadata(event.details);

              return (
                <div
                  className={`list-item vertical ${highlightedItemId === event.id ? "selection-highlight" : ""}`}
                  id={getItemAnchorId(event.id)}
                  key={event.id}
                >
                  <div>
                    <strong>{event.summary}</strong>
                    <p>
                      {formatAutopilotLabel(event.kind)} via {autopilotModeLabels[event.mode].toLowerCase()}
                      {metadata.queue ? ` · ${formatAutopilotLabel(metadata.queue)}` : ""}
                    </p>
                  </div>
                  <div className="goal-item-actions">
                    <StatusBadge status={event.status} />
                    {metadata.family ? <span className="pill">{formatAutopilotLabel(metadata.family)}</span> : null}
                    {metadata.priority ? <span className="pill">{formatAutopilotLabel(metadata.priority)} priority</span> : null}
                    <span className="pill">{autopilotModeLabels[event.mode]}</span>
                    <RelativeTime date={event.processedAt ?? event.createdAt} />
                    {metadata.operatorRoute ? (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => openDiagnosticTarget(metadata.operatorRoute!)}
                      >
                        {metadata.operatorRoute.actionLabel ?? "Open route"}
                      </button>
                    ) : null}
                    {event.resultGoalId ? (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() =>
                          openDiagnosticTarget({
                            section: "goals",
                            itemId: event.resultGoalId ?? undefined,
                            label: event.summary
                          })
                        }
                      >
                        Open goal
                      </button>
                    ) : null}
                  </div>
                  {event.error ? <p className="status-chip error">{event.error}</p> : null}
                </div>
              );
            })
          )}
        </div>
      </article>
    </>
  );
}
