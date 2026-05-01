import crypto from "node:crypto";
import type {
  AutopilotEvent,
  AutopilotProcessJobPayload,
  BriefingCreateJobPayload,
  BriefingType,
  DocsRenderJobPayload,
  GoalCreateJobPayload,
  GoalRefineJobPayload,
  PrivacyOperationJobPayload,
  PublicShareViewJobPayload,
  RecommendationRefinementSource,
  TemplateRunJobPayload
} from "@agentic/contracts";
import { RecommendationRefinementSourceSchema } from "@agentic/contracts";

export function buildGoalCreatePayload(params: {
  request: string;
  workspaceId: string | null;
  agentId: string | null;
}): GoalCreateJobPayload {
  return {
    type: "goal_create",
    goalId: crypto.randomUUID(),
    workflowId: crypto.randomUUID(),
    request: params.request,
    workspaceId: params.workspaceId,
    agentId: params.agentId,
    metadata: {}
  };
}

export function buildGoalRefinePayload(params: {
  goalId: string;
  workflowId: string;
  refinement: string;
  workspaceId: string | null;
  sourceRecommendation?: RecommendationRefinementSource | null;
}): GoalRefineJobPayload {
  return {
    type: "goal_refine",
    goalId: params.goalId,
    workflowId: params.workflowId,
    refinement: params.refinement,
    workspaceId: params.workspaceId,
    metadata: params.sourceRecommendation
      ? {
          sourceRecommendation: RecommendationRefinementSourceSchema.parse(params.sourceRecommendation)
        }
      : {}
  };
}

export function buildAutopilotProcessPayload(params: {
  autopilotEvent: AutopilotEvent;
  replayedFromJobId?: string | null;
}): AutopilotProcessJobPayload {
  return {
    type: "autopilot_process",
    autopilotEventId: params.autopilotEvent.id,
    kind: params.autopilotEvent.kind,
    sourceId: params.autopilotEvent.sourceId,
    mode: params.autopilotEvent.mode,
    metadata: params.replayedFromJobId
      ? {
          replayedFromJobId: params.replayedFromJobId
        }
      : {}
  };
}

export function buildBriefingCreatePayload(params: {
  goalId: string;
  workflowId: string;
  briefingType: BriefingType;
  workspaceId: string | null;
}): BriefingCreateJobPayload {
  return {
    type: "briefing_create",
    goalId: params.goalId,
    workflowId: params.workflowId,
    briefingType: params.briefingType,
    workspaceId: params.workspaceId,
    metadata: {}
  };
}

export function buildTemplateRunPayload(params: {
  templateId: string;
  goalId: string;
  workflowId: string;
  workspaceId: string | null;
}): TemplateRunJobPayload {
  return {
    type: "template_run",
    templateId: params.templateId,
    goalId: params.goalId,
    workflowId: params.workflowId,
    workspaceId: params.workspaceId,
    metadata: {}
  };
}

export function buildDocsRenderPayload(): DocsRenderJobPayload {
  return {
    type: "docs_render",
    metadata: {}
  };
}

export function buildAutopilotGoalId(eventId: string): string {
  return `autopilot-goal-${eventId}`;
}

export function buildAutopilotWorkflowId(eventId: string): string {
  return `autopilot-workflow-${eventId}`;
}

export function buildAutopilotProcessJobIdempotencyKey(eventId: string): string;
export function buildAutopilotProcessJobIdempotencyKey(params: {
  eventId: string;
  replayedFromJobId?: string | null;
}): string;
export function buildAutopilotProcessJobIdempotencyKey(
  paramsOrEventId: string | { eventId: string; replayedFromJobId?: string | null }
): string {
  const params =
    typeof paramsOrEventId === "string"
      ? {
          eventId: paramsOrEventId,
          replayedFromJobId: null
        }
      : paramsOrEventId;

  const baseKey = `autopilot-process:${params.eventId}`;
  return params.replayedFromJobId ? `${baseKey}:replay:${params.replayedFromJobId}` : baseKey;
}

export function buildPrivacyOperationPayload(params: {
  operationId: string;
  workspaceId: string;
  kind: PrivacyOperationJobPayload["kind"];
}): PrivacyOperationJobPayload {
  return {
    type: "privacy_operation",
    operationId: params.operationId,
    workspaceId: params.workspaceId,
    kind: params.kind,
    metadata: {}
  };
}

export function buildPublicShareViewPayload(params: {
  shareId: string;
  goalId: string;
  tokenFingerprint: string;
  viewedAt: string;
}): PublicShareViewJobPayload {
  return {
    type: "public_share_view",
    shareId: params.shareId,
    goalId: params.goalId,
    tokenFingerprint: params.tokenFingerprint,
    viewedAt: params.viewedAt,
    metadata: {}
  };
}

export function buildPrivacyOperationJobIdempotencyKey(operationId: string): string {
  return `privacy-operation:${operationId}`;
}

export function buildBriefingCreateJobIdempotencyKey(goalId: string, briefingType: BriefingType): string {
  return `briefing-create:${briefingType}:${goalId}`;
}

export function buildDocsRenderJobIdempotencyKey(userId: string): string {
  return `docs-render:${userId}`;
}
