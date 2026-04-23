import {
  ActionIntentSchema,
  ApprovalPreviewSchema,
  type ApprovalRequest
} from "@agentic/contracts";

function inferApprovalActionTypeFromRequestedAction(requestedAction: string): ApprovalRequest["preview"]["actionType"] {
  const normalized = requestedAction.toLowerCase();

  if (/\bdelete|remove|erase\b/.test(normalized)) {
    return "delete";
  }

  if (/\bsend|reply|email|message\b/.test(normalized)) {
    return "send";
  }

  if (/\bschedule|calendar|meeting|event\b/.test(normalized)) {
    return "schedule";
  }

  if (/\bupdate|revise|modify\b/.test(normalized)) {
    return "update";
  }

  if (/\bcreate|open|add|capture\b/.test(normalized)) {
    return "create";
  }

  if (/\bdraft|prepare\b/.test(normalized)) {
    return "draft";
  }

  return "artifact-only";
}

export function buildFallbackApprovalPreview(approval: {
  title: string;
  requestedAction: string;
  riskClass: ApprovalRequest["riskClass"];
}): ApprovalRequest["preview"] {
  const actionType = inferApprovalActionTypeFromRequestedAction(approval.requestedAction);

  return ApprovalPreviewSchema.parse({
    actionType,
    summary: approval.requestedAction,
    target: approval.title.replace(/\s+requires approval$/u, "") || "Pending action",
    changes: [
      {
        label: "Requested action",
        before: "Pending user review",
        after: approval.requestedAction
      }
    ],
    impact: {
      affectedPeople: actionType === "send" ? ["external recipients"] : [],
      affectedSystems:
        actionType === "send"
          ? ["email"]
          : actionType === "schedule"
            ? ["calendar"]
            : actionType === "create" || actionType === "update" || actionType === "delete"
              ? ["workspace"]
              : [],
      permissions: [],
      rollback:
        actionType === "delete"
          ? "not_supported"
          : actionType === "draft" || actionType === "artifact-only"
            ? "supported"
            : "manual"
    }
  });
}

export function buildFallbackApprovalActionIntent(approval: {
  title: string;
  requestedAction: string;
  preview?: ApprovalRequest["preview"] | null;
}): ApprovalRequest["actionIntent"] {
  const actionType = approval.preview?.actionType ?? inferApprovalActionTypeFromRequestedAction(approval.requestedAction);

  return ActionIntentSchema.parse({
    type: "manual_review",
    actionType,
    summary: approval.requestedAction,
    reason: "This approval does not include a typed execution payload and requires manual review before any side effect.",
    artifactIds: []
  });
}
