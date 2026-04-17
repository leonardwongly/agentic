"use client";

import type { Dispatch, SetStateAction } from "react";
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
import { RelativeTime, StatusBadge } from "./ui";

type RequestState = {
  kind: "idle" | "success" | "error";
  message: string;
};

type WorkspaceGovernanceDraft = Omit<WorkspaceGovernance, "workspaceId" | "updatedBy" | "createdAt" | "updatedAt">;

type DashboardOperationsSectionsProps = {
  data: DashboardData;
  isPending: boolean;
  highlightedItemId: string | null;
  workspaceState: RequestState;
  governanceState: RequestState;
  autopilotState: RequestState;
  privacyState: RequestState;
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
  runPrivacyOperation: (kind: (typeof privacyOperationKindValues)[number]) => Promise<void>;
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

const privacyOperationStatusLabels: Record<PrivacyOperation["status"], string> = {
  queued: "queued",
  running: "running",
  completed: "completed",
  failed: "failed"
};

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

export function DashboardOperationsSections(props: DashboardOperationsSectionsProps) {
  const {
    data,
    isPending,
    highlightedItemId,
    workspaceState,
    governanceState,
    autopilotState,
    privacyState,
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
        <div className="list-stack compact">
          <label className="field">
            <span>Member user ID</span>
            <input
              value={workspaceMemberUserId}
              onChange={(event) => setWorkspaceMemberUserId(event.target.value)}
              placeholder="alex@example.com"
            />
          </label>
          <label className="field">
            <span>Role</span>
            <select value={workspaceMemberRole} onChange={(event) => setWorkspaceMemberRole(event.target.value as (typeof workspaceRoleValues)[number])}>
              {workspaceRoleValues.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="secondary-button" onClick={() => void addWorkspaceMember()} disabled={isPending || !data.activeWorkspace}>
            Add member
          </button>
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
          <button type="button" className="secondary-button" onClick={() => void exportWorkspaceAudit()} disabled={isPending || !data.activeWorkspace}>
            Export audit
          </button>
        </div>
        <p className={`status-chip ${governanceState.kind}`}>
          {governanceState.message ||
            (data.activeWorkspace
              ? `Editing governance for ${data.activeWorkspace.name}.`
              : "Select a workspace before editing governance.")}
        </p>
        <div className="list-stack compact">
          <label className="field">
            <span>Approval mode</span>
            <select
              value={governanceDraft.approvalMode}
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
              checked={governanceDraft.externalSendRequiresApproval}
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
              onChange={(event) =>
                setGovernanceDraft((current) => ({
                  ...current,
                  calendarWriteRequiresApproval: event.target.checked
                }))
              }
            />
            Calendar writes always require approval
          </label>
          <button type="button" className="primary-button" onClick={() => void saveWorkspaceGovernance()} disabled={isPending || !data.activeWorkspace}>
            Save governance
          </button>
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
        <div className="list-stack compact">
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
                  onClick={() => void runPrivacyOperation(kind)}
                  disabled={isPending || !data.activeWorkspace}
                >
                  {privacyOperationLabels[kind]}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="card-header">
          <h3>Recent share links</h3>
          <span>{data.goalShares.length} tracked</span>
        </div>
        <div className="list-stack">
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
                      disabled={isPending}
                    >
                      Revoke
                    </button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>

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
                <p>Watcher triggers, template schedules, and briefing schedules will appear here once they fire.</p>
              </div>
            </div>
          ) : (
            data.autopilotEvents.slice(0, 5).map((event) => (
              <div
                className={`list-item vertical ${highlightedItemId === event.id ? "selection-highlight" : ""}`}
                id={getItemAnchorId(event.id)}
                key={event.id}
              >
                <div>
                  <strong>{event.summary}</strong>
                  <p>
                    {event.kind.replaceAll("_", " ")} via {autopilotModeLabels[event.mode].toLowerCase()}
                  </p>
                </div>
                <div className="goal-item-actions">
                  <StatusBadge status={event.status} />
                  <span className="pill">{autopilotModeLabels[event.mode]}</span>
                  <RelativeTime date={event.processedAt ?? event.createdAt} />
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
            ))
          )}
        </div>
      </article>
    </>
  );
}
