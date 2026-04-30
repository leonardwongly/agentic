import crypto from "node:crypto";
import {
  nowIso,
  type GoalBundle,
  type GoalShareRecord,
  type PrivacyOperation,
  type Workspace,
  type WorkspaceGovernance,
  type WorkspaceMember
} from "@agentic/contracts";
import type { WorkspaceAuditExport } from "./repository-types";

export function buildWorkspaceAuditExport(params: {
  workspace: Workspace;
  governance: WorkspaceGovernance | null;
  members: WorkspaceMember[];
  goals: GoalBundle[];
  goalShares: GoalShareRecord[];
  privacyOperations: PrivacyOperation[];
}): WorkspaceAuditExport {
  const generatedAt = nowIso();
  const payload = {
    generatedAt,
    workspace: params.workspace,
    governance: params.governance,
    members: params.members,
    goalShares: params.goalShares,
    privacyOperations: params.privacyOperations,
    goals: params.goals.map((bundle) => ({
      goal: bundle.goal,
      workflow: bundle.workflow,
      tasks: bundle.tasks,
      approvals: bundle.approvals,
      watchers: bundle.watchers,
      artifacts: bundle.artifacts,
      actionLogs: bundle.actionLogs
    }))
  };
  const digest = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");

  return {
    workspaceId: params.workspace.id,
    fileName: `${params.workspace.slug}-audit-${generatedAt.slice(0, 10)}.json`,
    contentType: "application/json",
    generatedAt,
    content: JSON.stringify(
      {
        ...payload,
        integrity: {
          version: "agentic-workspace-audit-integrity-v1",
          algorithm: "sha256",
          canonicalization: "json-stringify-v1",
          digest,
          recordCounts: {
            members: params.members.length,
            goalShares: params.goalShares.length,
            privacyOperations: params.privacyOperations.length,
            goals: params.goals.length
          }
        }
      },
      null,
      2
    )
  };
}
