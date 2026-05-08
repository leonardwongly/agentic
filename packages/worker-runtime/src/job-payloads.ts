import crypto from "node:crypto";
import type {
  AutopilotEvent,
  AutopilotProcessJobPayload,
  BriefingCreateJobPayload,
  BriefingType,
  DocsRenderJobPayload,
  GoalCreateJobPayload,
  GoalRefineJobPayload,
  GitHubIssueIntakeJobPayload,
  PrivacyOperationJobPayload,
  PublicShareViewJobPayload,
  RecommendationRefinementSource,
  TemplateRunJobPayload
} from "@agentic/contracts";
import { RecommendationRefinementSourceSchema } from "@agentic/contracts";

export type GitHubIssueIntakePayloadParams = {
  automationMode?: GitHubIssueIntakeJobPayload["automationMode"];
  repository: {
    fullName: string;
    htmlUrl: string;
    defaultBranch: string;
    private: boolean;
  };
  issue: {
    number: number;
    nodeId: string | null;
    title: string;
    body: string | null;
    url: string;
    authorLogin: string | null;
    labels: string[];
    assignees: string[];
    createdAt: string;
    updatedAt: string;
  };
  deliveryId: string;
  receivedAt: string;
  senderLogin: string | null;
  trigger?: {
    event?: GitHubIssueIntakeJobPayload["metadata"]["event"];
    action?: GitHubIssueIntakeJobPayload["metadata"]["action"];
    labelName?: string | null;
    command?: string | null;
    triggerId?: string | null;
  };
  workspaceId?: string | null;
  agentId?: string | null;
};

function buildGitHubIssueIdentity(params: {
  repositoryFullName: string;
  issueNumber: number;
  automationMode?: GitHubIssueIntakeJobPayload["automationMode"];
}): string {
  const baseIdentity = `${params.repositoryFullName.trim().toLowerCase()}#${params.issueNumber}`;
  return params.automationMode && params.automationMode !== "intake"
    ? `${baseIdentity}:${params.automationMode}`
    : baseIdentity;
}

function buildGitHubIssueTriggerIdentity(params: {
  repositoryFullName: string;
  issueNumber: number;
  automationMode?: GitHubIssueIntakeJobPayload["automationMode"];
  triggerId?: string | null;
}): string {
  const baseIdentity = buildGitHubIssueIdentity(params);
  const triggerId = params.triggerId?.trim();
  return triggerId ? `${baseIdentity}:${triggerId}` : baseIdentity;
}

function hashGitHubIssueIdentity(params: {
  repositoryFullName: string;
  issueNumber: number;
  automationMode?: GitHubIssueIntakeJobPayload["automationMode"];
}): string {
  return crypto.createHash("sha256").update(buildGitHubIssueIdentity(params)).digest("hex");
}

function hashGitHubIssueTriggerIdentity(params: {
  repositoryFullName: string;
  issueNumber: number;
  automationMode?: GitHubIssueIntakeJobPayload["automationMode"];
  triggerId?: string | null;
}): string {
  return crypto.createHash("sha256").update(buildGitHubIssueTriggerIdentity(params)).digest("hex");
}

function normalizeIdempotencySegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/gu, "-")
    .slice(0, 140);
}

export function buildGitHubIssueIntakeGoalId(params: {
  repositoryFullName: string;
  issueNumber: number;
  automationMode?: GitHubIssueIntakeJobPayload["automationMode"];
}): string {
  return `github-issue-goal-${hashGitHubIssueIdentity(params).slice(0, 24)}`;
}

export function buildGitHubIssueIntakeWorkflowId(params: {
  repositoryFullName: string;
  issueNumber: number;
  automationMode?: GitHubIssueIntakeJobPayload["automationMode"];
}): string {
  return `github-issue-workflow-${hashGitHubIssueIdentity(params).slice(0, 24)}`;
}

export function buildGitHubIssueIntakeJobIdempotencyKey(params: {
  repositoryFullName: string;
  issueNumber: number;
  automationMode?: GitHubIssueIntakeJobPayload["automationMode"];
  triggerId?: string | null;
}): string {
  const readable = normalizeIdempotencySegment(params.repositoryFullName);
  const mode = params.automationMode && params.automationMode !== "intake" ? `:${params.automationMode}` : "";
  return `github-issue-intake:${readable}#${params.issueNumber}${mode}:${hashGitHubIssueTriggerIdentity(params).slice(0, 16)}`;
}

export function buildGitHubIssueIntakeConcurrencyKey(params: {
  repositoryFullName: string;
  issueNumber: number;
}): string {
  return `github-issue-intake:${hashGitHubIssueIdentity(params).slice(0, 32)}`;
}

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

export function buildGitHubIssueIntakePayload(params: GitHubIssueIntakePayloadParams): GitHubIssueIntakeJobPayload {
  const automationMode = params.automationMode ?? "intake";
  const identity = {
    repositoryFullName: params.repository.fullName,
    issueNumber: params.issue.number,
    automationMode
  };

  return {
    type: "github_issue_intake",
    goalId: buildGitHubIssueIntakeGoalId(identity),
    workflowId: buildGitHubIssueIntakeWorkflowId(identity),
    automationMode,
    workspaceId: params.workspaceId ?? null,
    agentId: params.agentId ?? null,
    repository: {
      fullName: params.repository.fullName,
      htmlUrl: params.repository.htmlUrl,
      defaultBranch: params.repository.defaultBranch,
      private: params.repository.private
    },
    issue: {
      number: params.issue.number,
      nodeId: params.issue.nodeId,
      title: params.issue.title,
      body: params.issue.body,
      url: params.issue.url,
      authorLogin: params.issue.authorLogin,
      labels: params.issue.labels,
      assignees: params.issue.assignees,
      createdAt: params.issue.createdAt,
      updatedAt: params.issue.updatedAt
    },
    deliveryId: params.deliveryId,
    receivedAt: params.receivedAt,
    metadata: {
      event: params.trigger?.event ?? "issues",
      action: params.trigger?.action ?? "opened",
      senderLogin: params.senderLogin,
      triggerLabel: params.trigger?.labelName?.trim() || null,
      command: params.trigger?.command?.trim() || null,
      triggerId: params.trigger?.triggerId?.trim() || null,
      riskTags: ["untrusted_external_input", "github_issue", `github_issue_${automationMode}`]
    }
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
