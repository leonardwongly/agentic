import crypto from "node:crypto";
import { type ActorContext, type GoalBundle, type MemoryRecord, type Task, type WorkspaceGovernance } from "@agentic/contracts";
import { createMemoryRecord } from "@agentic/memory";
import {
  applyLearningPrivacyToMemoryRecord,
  evaluateLearningPrivacyPreflight,
  redactLearningCaptureJson,
  redactLearningCaptureText,
  type LearningCaptureSource,
  type LearningPrivacyMetadata
} from "@agentic/policy";
import { type EpisodeRecord, EpisodeRecordSchema } from "@agentic/self-improvement-memory";
import type { ExecutionResult } from "./execution-dispatch";

export type CapturedMemories = {
  memories: MemoryRecord[];
  episodes: EpisodeRecord[];
};

export type LearningCapturePrivacyOptions = {
  governance?: WorkspaceGovernance | null;
  now?: string;
};

const LEARNING_REVIEW_DAYS = 90;
const LEARNING_RETENTION_DAYS = 365;

function addDays(isoTimestamp: string, days: number): string {
  const parsed = Date.parse(isoTimestamp);
  const base = Number.isFinite(parsed) ? parsed : Date.now();
  return new Date(base + days * 24 * 60 * 60 * 1000).toISOString();
}

function redactLearningText(value: string): { value: string; applied: boolean; rules: string[] } {
  const rules = new Set<string>();
  let redacted = value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, () => {
    rules.add("email");
    return "[redacted-email]";
  });

  redacted = redacted.replace(/\b(?:token|secret|password|api[_-]?key)\s*[:=]\s*\S+/giu, (match) => {
    rules.add("secret-like");
    return `${match.split(/[:=]/u)[0]}=[redacted-secret]`;
  });

  return {
    value: redacted,
    applied: rules.size > 0,
    rules: [...rules].sort((left, right) => left.localeCompare(right))
  };
}

function redactionSummary(...values: string[]): { applied: boolean; rules: string[] } {
  const rules = new Set<string>();
  let applied = false;

  for (const value of values) {
    const result = redactLearningText(value);
    applied = applied || result.applied;
    for (const rule of result.rules) {
      rules.add(rule);
    }
  }

  return {
    applied,
    rules: [...rules].sort((left, right) => left.localeCompare(right))
  };
}

function buildEpisodePrivacy(params: {
  timestamp: string;
  sensitivity?: string;
  redactionFields?: string[];
  redactionRules?: string[];
}) {
  return {
    sensitivity: params.sensitivity ?? "internal",
    retention: {
      policy: "learning-outcome-365d",
      reviewAt: addDays(params.timestamp, LEARNING_REVIEW_DAYS),
      expiresAt: addDays(params.timestamp, LEARNING_RETENTION_DAYS)
    },
    redaction: {
      applied: (params.redactionRules?.length ?? 0) > 0,
      fields: params.redactionFields ?? [],
      rules: params.redactionRules ?? [],
      reason: (params.redactionRules?.length ?? 0) > 0 ? "Boundary redaction applied before learning capture." : null
    }
  };
}

function summarizeExecutionDetail(detail: string): string {
  const normalized = redactLearningText(detail).value.trim().replace(/\s+/g, " ");
  return normalized.length > 220 ? `${normalized.slice(0, 217)}...` : normalized;
}

function taskOutcome(task: Task): "success" | "partial" | "failure" {
  if (task.state === "completed") return "success";
  if (task.state === "blocked" || task.state === "failed") return "failure";
  return "partial";
}

function normalizeCapabilities(task: Task): string[] {
  return [...new Set(task.toolCapabilities)].sort((left, right) => left.localeCompare(right));
}

function inferTaskAction(task: Task, explicitAction: string | null = null): string {
  if (explicitAction) {
    return explicitAction;
  }

  const capabilities = normalizeCapabilities(task);

  if (capabilities.includes("send")) return "send_message";
  if (capabilities.includes("schedule")) return "schedule_event";
  if (capabilities.includes("create")) return "create_record";
  if (capabilities.includes("delete")) return "destructive_change";
  if (capabilities.includes("write")) return "write_record";
  if (capabilities.includes("search")) return "search_records";
  if (capabilities.includes("read")) return "read_records";

  return "task_execution";
}

function buildRecommendationKey(task: Task, action: string, kind: "task_plan" | "execution_path"): string {
  const capabilities = normalizeCapabilities(task).join(",");
  return `${kind}:${task.assignedAgent}:${action}:${task.riskClass}:${capabilities}`;
}

function buildRecommendationConfidence(task: Task, successOverride?: boolean): number {
  if (successOverride === true) return 0.92;
  if (successOverride === false) return 0.38;

  switch (task.state) {
    case "completed":
      return 0.86;
    case "blocked":
    case "failed":
      return 0.34;
    default:
      return 0.61;
  }
}

function buildTaskFallbackMode(task: Task, approvalDecision: "approved" | "rejected" | null): "normal" | "review_required" | "draft_only" {
  if (approvalDecision === "rejected" || task.state === "blocked" || task.state === "failed") {
    return "review_required";
  }

  if (task.requiresApproval && approvalDecision !== "approved") {
    return "draft_only";
  }

  return "normal";
}

function buildExecutionFallbackMode(result: ExecutionResult): "normal" | "review_required" | "draft_only" {
  return result.success ? "normal" : "review_required";
}

function buildEvidenceHint(params: {
  artifactCount?: number;
  approvalDecision?: "approved" | "rejected" | null;
  success?: boolean;
  partial?: boolean;
}): "none" | "sparse" | "established" {
  if (params.success || (params.approvalDecision === "approved" && (params.artifactCount ?? 0) > 0)) {
    return "established";
  }

  if ((params.artifactCount ?? 0) > 0 || params.approvalDecision !== null || params.partial) {
    return "sparse";
  }

  return "none";
}

function buildOutcomeScore(outcome: "success" | "partial" | "failure"): number {
  if (outcome === "success") return 1;
  if (outcome === "partial") return 0.2;
  return -1;
}

function buildDeterministicId(...parts: Array<string | null | undefined>): string {
  return crypto
    .createHash("sha256")
    .update(parts.map((part) => part ?? "").join("|"))
    .digest("hex")
    .slice(0, 32);
}

function extractCapabilityMemory(bundle: GoalBundle, userId: string, actorContext: ActorContext | null): MemoryRecord | null {
  const capabilities = new Set(bundle.tasks.flatMap((t) => t.toolCapabilities));
  if (capabilities.size === 0) return null;

  const agents = [...new Set(bundle.tasks.map((t) => t.assignedAgent))];
  const content = redactLearningText(
    `Goal "${bundle.goal.title}" used capabilities [${[...capabilities].join(", ")}] via agents [${agents.join(", ")}]. Scenario intent: ${bundle.goal.intent}.`
  ).value;

  return createMemoryRecord({
    id: buildDeterministicId("memory", bundle.goal.id, "capabilities"),
    userId,
    category: "working-style",
    memoryType: "observed",
    content,
    confidence: 0.72,
    source: "auto-capture",
    permissions: ["orchestrator", "workflow", "knowledge"],
    actorContext,
    createdAt: bundle.goal.updatedAt,
    updatedAt: bundle.goal.updatedAt
  });
}

function extractOutcomeMemory(bundle: GoalBundle, userId: string, actorContext: ActorContext | null): MemoryRecord | null {
  const completedTasks = bundle.tasks.filter((t) => t.state === "completed");
  const blockedTasks = bundle.tasks.filter((t) => t.state === "blocked");
  const approvedCount = bundle.approvals.filter((a) => a.decision === "approved").length;
  const rejectedCount = bundle.approvals.filter((a) => a.decision === "rejected").length;

  if (completedTasks.length === 0 && blockedTasks.length === 0) return null;

  const parts: string[] = [];
  parts.push(`Goal "${bundle.goal.title}" resolved with ${completedTasks.length} completed and ${blockedTasks.length} blocked tasks.`);
  if (approvedCount > 0) parts.push(`${approvedCount} approval(s) granted.`);
  if (rejectedCount > 0) parts.push(`${rejectedCount} approval(s) rejected.`);

  const riskClasses = [...new Set(bundle.tasks.map((t) => t.riskClass))];
  if (riskClasses.length > 0) parts.push(`Risk classes involved: ${riskClasses.join(", ")}.`);

  return createMemoryRecord({
    id: buildDeterministicId("memory", bundle.goal.id, "outcome"),
    userId,
    category: "projects",
    memoryType: "observed",
    content: redactLearningText(parts.join(" ")).value,
    confidence: 0.78,
    source: "auto-capture",
    permissions: ["orchestrator", "workflow", "knowledge"],
    actorContext,
    createdAt: bundle.goal.updatedAt,
    updatedAt: bundle.goal.updatedAt
  });
}

function extractPreferenceSignals(bundle: GoalBundle, userId: string, actorContext: ActorContext | null): MemoryRecord[] {
  const memories: MemoryRecord[] = [];

  for (const approval of bundle.approvals) {
    if (approval.decision === "pending") continue;

    const task = bundle.tasks.find((t) => t.id === approval.taskId);
    if (!task) continue;

    const scopeClause = approval.decisionScope ? ` Scope: ${approval.decisionScope}.` : "";
    const rationaleClause = approval.decisionRationale ? ` User rationale: ${approval.decisionRationale}.` : "";
    const content = approval.decision === "approved"
      ? `User approved "${task.title}" (${task.riskClass}) — indicates comfort with this action type in similar contexts.${scopeClause}${rationaleClause}`
      : `User rejected "${task.title}" (${task.riskClass}) — indicates this action type needs different handling or shouldn't be proposed.${scopeClause}${rationaleClause}`;

    memories.push(createMemoryRecord({
      id: buildDeterministicId(
        "memory",
        bundle.goal.id,
        "approval-signal",
        task.title,
        task.summary,
        task.assignedAgent,
        approval.decision,
        approval.decisionScope ?? "",
        approval.decisionRationale ?? ""
      ),
      userId,
      category: "preferences",
      memoryType: "observed",
      content: redactLearningText(content).value,
      confidence: approval.decision === "approved" ? 0.75 : 0.82,
      source: "auto-capture",
      permissions: ["orchestrator", "workflow", "knowledge", "communications"],
      actorContext,
      createdAt: approval.respondedAt ?? task.updatedAt,
      updatedAt: approval.respondedAt ?? task.updatedAt
    }));
  }

  return memories;
}

function buildEpisodes(bundle: GoalBundle, memoryIds: string[]): EpisodeRecord[] {
  return bundle.tasks.map((task) => {
    const artifacts = bundle.artifacts.filter((a) => a.taskId === task.id);
    const approval = bundle.approvals.find((a) => a.taskId === task.id);
    const outcome = taskOutcome(task);
    const action = inferTaskAction(task, approval?.actionIntent?.type ?? null);
    const approvalDecision = approval?.decision === "approved" || approval?.decision === "rejected" ? approval.decision : null;

    const situationParts = [
      `Goal: "${bundle.goal.title}"`,
      `Request: "${bundle.goal.request.slice(0, 200)}"`,
      `Scenario: ${bundle.goal.intent}`
    ].map((part) => redactLearningText(part).value);

    const solutionParts = [
      `Agent ${task.assignedAgent} processed "${redactLearningText(task.title).value}".`,
      artifacts.length > 0 ? `Produced ${artifacts.length} artifact(s).` : "No artifacts produced."
    ];

    let lesson: string;
    if (outcome === "success") {
      lesson = `Task "${redactLearningText(task.title).value}" completed successfully with risk class ${task.riskClass}.`;
    } else if (outcome === "failure" && approval?.decision === "rejected") {
      lesson = `Task "${redactLearningText(task.title).value}" was rejected by user — reconsider proposing ${task.riskClass} actions of this type.`;
    } else {
      lesson = `Task "${redactLearningText(task.title).value}" ended in state "${task.state}" — may need different approach.`;
    }
    const redaction = redactionSummary(bundle.goal.title, bundle.goal.request, task.title, task.summary, approval?.requestedAction ?? "");
    const recommendationKey = buildRecommendationKey(task, action, "task_plan");

    return EpisodeRecordSchema.parse({
      id: buildDeterministicId(
        "episode",
        bundle.goal.id,
        task.title,
        task.summary,
        task.assignedAgent,
        task.riskClass
      ),
      timestamp: task.updatedAt,
      skill: task.assignedAgent,
      task: redactLearningText(task.title).value,
      outcome,
      situation: situationParts.join(". "),
      rootCause: outcome === "failure" ? (approval?.decision === "rejected" ? "User rejected the proposed action." : "Task blocked or failed during execution.") : null,
      solution: solutionParts.join(" "),
      lesson,
      recommendation: {
        key: recommendationKey,
        kind: "task_plan",
        agent: task.assignedAgent,
        action,
        confidence: buildRecommendationConfidence(task),
        rationale: approval?.rationale ?? null,
        riskClass: task.riskClass,
        capabilities: normalizeCapabilities(task),
        sourceGoalId: bundle.goal.id,
        sourceTaskId: task.id,
        fallbackMode: buildTaskFallbackMode(task, approvalDecision),
        evidenceHint: buildEvidenceHint({
          artifactCount: artifacts.length,
          approvalDecision,
          success: outcome === "success",
          partial: outcome === "partial"
        })
      },
      outcomeLink: {
        goalId: bundle.goal.id,
        workflowId: bundle.workflow.id,
        taskId: task.id,
        goalStatus: bundle.goal.status,
        taskState: task.state,
        approvalDecision,
        executionKind: task.state === "completed" ? "completed" : task.state === "blocked" || task.state === "failed" ? "failed" : "not_run",
        outcomeScore: buildOutcomeScore(outcome),
        userCorrection: approvalDecision === "rejected",
        notes: artifacts.length > 0 ? `${artifacts.length} artifact(s) produced.` : null
      },
      relatedPatternId: null,
      userFeedback: null,
      provenance: {
        ownerUserId: userIdFromBundle(bundle),
        workspaceId: bundle.goal.workspaceId,
        source: approval ? "approval" : "goal",
        memoryIds,
        actionLogIds: bundle.actionLogs.filter((actionLog) => actionLog.taskId === task.id || actionLog.goalId === bundle.goal.id).map((actionLog) => actionLog.id),
        evidenceRecordIds: [],
        recommendationKeys: [recommendationKey]
      },
      privacy: buildEpisodePrivacy({
        timestamp: task.updatedAt,
        sensitivity: task.riskClass,
        redactionFields: redaction.applied ? ["goal.title", "goal.request", "task.title", "task.summary", "approval.requestedAction"] : [],
        redactionRules: redaction.rules
      }),
      metadata: {
        goalId: bundle.goal.id,
        taskId: task.id,
        riskClass: task.riskClass,
        capabilities: task.toolCapabilities.join(",")
      }
    });
  });
}

function userIdFromBundle(bundle: GoalBundle): string {
  return bundle.goal.userId;
}

function extractExecutionOutcomeMemory(
  bundle: GoalBundle,
  userId: string,
  results: ExecutionResult[],
  actorContext: ActorContext | null
): MemoryRecord | null {
  if (results.length === 0) return null;

  const successCount = results.filter((result) => result.success).length;
  const failureCount = results.length - successCount;
  const actionCounts = new Map<string, number>();

  for (const result of results) {
    actionCounts.set(result.action, (actionCounts.get(result.action) ?? 0) + 1);
  }

  const actionSummary = [...actionCounts.entries()]
    .map(([action, count]) => `${action} x${count}`)
    .join(", ");

  return createMemoryRecord({
    id: buildDeterministicId("memory", bundle.goal.id, "execution-outcome", actionSummary),
    userId,
    category: "projects",
    memoryType: "observed",
    content: redactLearningText(`Execution outcomes for goal "${bundle.goal.title}": ${successCount} succeeded, ${failureCount} failed or were skipped across ${results.length} action(s). Actions: ${actionSummary}.`).value,
    confidence: failureCount > 0 ? 0.9 : 0.82,
    source: "auto-capture",
    permissions: ["orchestrator", "workflow", "knowledge", "communications"],
    actorContext,
    createdAt: results[results.length - 1]?.timestamp,
    updatedAt: results[results.length - 1]?.timestamp
  });
}

function extractExecutionFailureMemories(
  bundle: GoalBundle,
  userId: string,
  results: ExecutionResult[],
  actorContext: ActorContext | null
): MemoryRecord[] {
  return results.flatMap((result) => {
    if (result.success) return [];

    const task = bundle.tasks.find((candidate) => candidate.id === result.taskId);
    const taskLabel = task?.title ?? result.taskId;

    return [createMemoryRecord({
      id: buildDeterministicId(
        "memory",
        bundle.goal.id,
        "execution-failure",
        result.taskId,
        result.action,
        result.timestamp
      ),
      userId,
      category: "preferences",
      memoryType: "observed",
      content: redactLearningText(`Execution issue for "${taskLabel}" on goal "${bundle.goal.title}": ${result.action} failed or was skipped. Detail: ${summarizeExecutionDetail(result.detail)}`).value,
      confidence: 0.92,
      source: "auto-capture",
      permissions: ["orchestrator", "workflow", "knowledge", "communications"],
      actorContext,
      createdAt: result.timestamp,
      updatedAt: result.timestamp
    })];
  });
}

function buildExecutionEpisodes(bundle: GoalBundle, results: ExecutionResult[], memoryIds: string[]): EpisodeRecord[] {
  return results.map((result) => {
    const task = bundle.tasks.find((candidate) => candidate.id === result.taskId);
    const taskTitle = task?.title ?? result.taskId;
    const approval = bundle.approvals.find((candidate) => candidate.taskId === result.taskId);
    const approvalDecision = approval?.decision === "approved" || approval?.decision === "rejected" ? approval.decision : null;
    const situationParts = [
      `Goal: "${redactLearningText(bundle.goal.title).value}"`,
      `Approved task: "${redactLearningText(taskTitle).value}"`,
      `Execution action: ${result.action}`
    ];
    const redaction = redactionSummary(bundle.goal.title, taskTitle, result.detail);
    const recommendationKey = task ? buildRecommendationKey(task, result.action, "execution_path") : null;

    return EpisodeRecordSchema.parse({
      id: buildDeterministicId("episode", bundle.goal.id, "execution", result.taskId, result.action, result.timestamp),
      timestamp: result.timestamp,
      skill: task?.assignedAgent ?? "execution-engine",
      task: `Execute approved task "${redactLearningText(taskTitle).value}"`,
      outcome: result.success ? "success" : "failure",
      situation: situationParts.join(". "),
      rootCause: result.success ? null : summarizeExecutionDetail(result.detail),
      solution: result.success
        ? `Typed action intent ${result.action} executed successfully.`
        : `Execution engine surfaced a failure or skip for ${result.action}.`,
      lesson: result.success
        ? `This approved action executed cleanly with the current adapter path.`
        : `This approved action needs adapter, payload, or policy follow-up before similar executions should be trusted.`,
      recommendation: task
        ? {
            key: recommendationKey ?? buildRecommendationKey(task, result.action, "execution_path"),
            kind: "execution_path",
            agent: task.assignedAgent,
            action: result.action,
            confidence: buildRecommendationConfidence(task, result.success),
            rationale: approval?.rationale ?? null,
            riskClass: task.riskClass,
            capabilities: normalizeCapabilities(task),
            sourceGoalId: bundle.goal.id,
            sourceTaskId: task.id,
            fallbackMode: buildExecutionFallbackMode(result),
            evidenceHint: buildEvidenceHint({
              approvalDecision,
              success: result.success,
              partial: !result.success
            })
          }
        : null,
      outcomeLink: {
        goalId: bundle.goal.id,
        workflowId: bundle.workflow.id,
        taskId: result.taskId,
        goalStatus: bundle.goal.status,
        taskState: task?.state ?? null,
        approvalDecision,
        executionKind: result.success ? "completed" : "failed",
        outcomeScore: result.success ? 1 : -1,
        userCorrection: false,
        notes: summarizeExecutionDetail(result.detail)
      },
      relatedPatternId: null,
      userFeedback: null,
      provenance: {
        ownerUserId: bundle.goal.userId,
        workspaceId: bundle.goal.workspaceId,
        source: "execution",
        memoryIds,
        actionLogIds: bundle.actionLogs.filter((actionLog) => actionLog.taskId === result.taskId || actionLog.goalId === bundle.goal.id).map((actionLog) => actionLog.id),
        evidenceRecordIds: [],
        recommendationKeys: recommendationKey ? [recommendationKey] : []
      },
      privacy: buildEpisodePrivacy({
        timestamp: result.timestamp,
        sensitivity: task?.riskClass ?? "internal",
        redactionFields: redaction.applied ? ["goal.title", "task.title", "execution.detail"] : [],
        redactionRules: redaction.rules
      }),
      metadata: {
        goalId: bundle.goal.id,
        taskId: result.taskId,
        action: result.action,
        success: result.success,
        detail: summarizeExecutionDetail(result.detail)
      }
    });
  });
}

function applyLearningPrivacyToEpisode(
  episode: EpisodeRecord,
  metadata: LearningPrivacyMetadata
): EpisodeRecord {
  return EpisodeRecordSchema.parse({
    ...episode,
    task: redactLearningCaptureText(episode.task),
    situation: redactLearningCaptureText(episode.situation),
    rootCause: episode.rootCause ? redactLearningCaptureText(episode.rootCause) : null,
    solution: redactLearningCaptureText(episode.solution),
    lesson: redactLearningCaptureText(episode.lesson),
    recommendation: episode.recommendation
      ? {
          ...episode.recommendation,
          rationale: episode.recommendation.rationale
            ? redactLearningCaptureText(episode.recommendation.rationale)
            : null
        }
      : null,
    outcomeLink: episode.outcomeLink
      ? {
          ...episode.outcomeLink,
          notes: episode.outcomeLink.notes ? redactLearningCaptureText(episode.outcomeLink.notes) : null
        }
      : null,
    metadata: {
      ...(redactLearningCaptureJson(episode.metadata) as Record<string, unknown>),
      userId: metadata.userId,
      workspaceId: metadata.workspaceId,
      learningPrivacy: metadata
    }
  });
}

function applyLearningPrivacyControls(params: {
  bundle: GoalBundle;
  userId: string;
  actorContext: ActorContext | null;
  source: LearningCaptureSource;
  captured: CapturedMemories;
  options?: LearningCapturePrivacyOptions;
  executionResultTaskIds?: string[];
}): CapturedMemories {
  const preflight = evaluateLearningPrivacyPreflight({
    bundle: params.bundle,
    userId: params.userId,
    actorContext: params.actorContext,
    governance: params.options?.governance ?? null,
    source: params.source,
    now: params.options?.now,
    executionResultTaskIds: params.executionResultTaskIds
  });

  if (!preflight.allowed) {
    return { memories: [], episodes: [] };
  }

  return {
    memories: params.captured.memories.map((memory) => applyLearningPrivacyToMemoryRecord(memory, preflight)),
    episodes: params.captured.episodes.map((episode) => applyLearningPrivacyToEpisode(episode, preflight.metadata))
  };
}

export function captureMemoriesFromBundle(
  bundle: GoalBundle,
  userId: string,
  actorContext: ActorContext | null = null,
  options?: LearningCapturePrivacyOptions
): CapturedMemories {
  const memories: MemoryRecord[] = [];

  const capabilityMemory = extractCapabilityMemory(bundle, userId, actorContext);
  if (capabilityMemory) memories.push(capabilityMemory);

  const outcomeMemory = extractOutcomeMemory(bundle, userId, actorContext);
  if (outcomeMemory) memories.push(outcomeMemory);

  memories.push(...extractPreferenceSignals(bundle, userId, actorContext));

  const episodes = buildEpisodes(bundle, memories.map((memory) => memory.id));

  return applyLearningPrivacyControls({
    bundle,
    userId,
    actorContext,
    source: "goal_bundle",
    captured: { memories, episodes },
    options
  });
}

export function captureExecutionOutcomeSignals(
  bundle: GoalBundle,
  userId: string,
  results: ExecutionResult[],
  actorContext: ActorContext | null = null,
  options?: LearningCapturePrivacyOptions
): CapturedMemories {
  if (results.length === 0) {
    return { memories: [], episodes: [] };
  }

  const memories: MemoryRecord[] = [];
  const outcomeMemory = extractExecutionOutcomeMemory(bundle, userId, results, actorContext);
  if (outcomeMemory) {
    memories.push(outcomeMemory);
  }
  memories.push(...extractExecutionFailureMemories(bundle, userId, results, actorContext));

  return applyLearningPrivacyControls({
    bundle,
    userId,
    actorContext,
    source: "execution_outcome",
    captured: {
      memories,
      episodes: buildExecutionEpisodes(bundle, results, memories.map((memory) => memory.id))
    },
    options,
    executionResultTaskIds: results.map((result) => result.taskId)
  });
}
