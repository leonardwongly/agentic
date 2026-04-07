import crypto from "node:crypto";
import { ActionLogSchema, nowIso, type ActionLog, type AgentDefinition } from "@agentic/contracts";

export function hashActionLog(log: ActionLog): string {
  const stable = JSON.stringify({
    id: log.id,
    goalId: log.goalId,
    taskId: log.taskId,
    workflowId: log.workflowId,
    actor: log.actor,
    kind: log.kind,
    message: log.message,
    details: log.details,
    createdAt: log.createdAt,
    prevHash: log.prevHash
  });
  return crypto.createHash("sha256").update(stable).digest("hex");
}

export function createActionLog(
  input: Omit<ActionLog, "id" | "createdAt" | "taskId" | "workflowId" | "prevHash"> & {
    taskId?: string | null;
    workflowId?: string | null;
    prevLog?: ActionLog | null;
  }
): ActionLog {
  const prevHash = input.prevLog ? hashActionLog(input.prevLog) : null;
  const { prevLog: _prevLog, ...rest } = input;
  return ActionLogSchema.parse({
    taskId: rest.taskId ?? null,
    workflowId: rest.workflowId ?? null,
    ...rest,
    id: crypto.randomUUID(),
    createdAt: nowIso(),
    prevHash
  });
}

// Activity event types for agent execution instrumentation
export type ActivityEventType =
  | "agent.started"
  | "agent.completed"
  | "agent.failed"
  | "agent.tool_called"
  | "agent.memory_accessed"
  | "agent.decision_made"
  | "workflow.started"
  | "workflow.step_completed"
  | "workflow.completed"
  | "workflow.failed"
  | "approval.requested"
  | "approval.responded"
  | "memory.created"
  | "memory.updated"
  | "memory.deleted"
  | "goal.created"
  | "goal.completed"
  | "goal.failed"
  | "task.started"
  | "task.completed"
  | "task.failed"
  | "integration.called"
  | "integration.error";

export type ActivityEvent = {
  id: string;
  type: ActivityEventType;
  timestamp: string;
  actor: string;
  agentId?: string;
  agentName?: string;
  goalId?: string;
  taskId?: string;
  workflowId?: string;
  message: string;
  details: Record<string, unknown>;
  duration?: number;
  success?: boolean;
  error?: string;
};

// Event emitter interface for activity events
export type ActivityEventHandler = (event: ActivityEvent) => void;

const eventHandlers: ActivityEventHandler[] = [];

export function onActivityEvent(handler: ActivityEventHandler): () => void {
  eventHandlers.push(handler);
  return () => {
    const index = eventHandlers.indexOf(handler);
    if (index >= 0) eventHandlers.splice(index, 1);
  };
}

export function emitActivityEvent(
  input: Omit<ActivityEvent, "id" | "timestamp">
): ActivityEvent {
  const event: ActivityEvent = {
    ...input,
    id: crypto.randomUUID(),
    timestamp: nowIso()
  };

  // Notify all handlers
  for (const handler of eventHandlers) {
    try {
      handler(event);
    } catch (e) {
      console.error("[activity] Event handler error:", e);
    }
  }

  return event;
}

// Instrumentation helpers for agent execution
export function instrumentAgentStart(
  agentId: string,
  agentName: string,
  goalId?: string,
  taskId?: string
): ActivityEvent {
  return emitActivityEvent({
    type: "agent.started",
    actor: agentName,
    agentId,
    agentName,
    goalId,
    taskId,
    message: `Agent ${agentName} started execution`,
    details: { agentId, taskId, goalId }
  });
}

export function instrumentAgentComplete(
  agentId: string,
  agentName: string,
  durationMs: number,
  success: boolean,
  goalId?: string,
  taskId?: string,
  error?: string
): ActivityEvent {
  return emitActivityEvent({
    type: success ? "agent.completed" : "agent.failed",
    actor: agentName,
    agentId,
    agentName,
    goalId,
    taskId,
    message: success 
      ? `Agent ${agentName} completed in ${durationMs}ms`
      : `Agent ${agentName} failed: ${error}`,
    details: { durationMs, success, error },
    duration: durationMs,
    success,
    error
  });
}

export function instrumentToolCall(
  agentId: string,
  agentName: string,
  toolName: string,
  args: Record<string, unknown>,
  result?: unknown
): ActivityEvent {
  return emitActivityEvent({
    type: "agent.tool_called",
    actor: agentName,
    agentId,
    agentName,
    message: `Agent ${agentName} called tool: ${toolName}`,
    details: { toolName, args, result }
  });
}

export function instrumentMemoryAccess(
  agentId: string,
  agentName: string,
  memoryIds: string[],
  operation: "read" | "write"
): ActivityEvent {
  return emitActivityEvent({
    type: "agent.memory_accessed",
    actor: agentName,
    agentId,
    agentName,
    message: `Agent ${agentName} ${operation} ${memoryIds.length} memories`,
    details: { memoryIds, operation }
  });
}

export function instrumentDecision(
  agentId: string,
  agentName: string,
  decision: string,
  confidence: number,
  reasoning?: string
): ActivityEvent {
  return emitActivityEvent({
    type: "agent.decision_made",
    actor: agentName,
    agentId,
    agentName,
    message: `Agent ${agentName} decided: ${decision}`,
    details: { decision, confidence, reasoning }
  });
}

// Workflow instrumentation
export function instrumentWorkflowStart(
  workflowId: string,
  workflowName: string,
  nodes: number
): ActivityEvent {
  return emitActivityEvent({
    type: "workflow.started",
    actor: "workflow",
    workflowId,
    message: `Workflow "${workflowName}" started with ${nodes} nodes`,
    details: { workflowName, nodes }
  });
}

export function instrumentWorkflowStep(
  workflowId: string,
  stepIndex: number,
  stepName: string,
  agentId?: string
): ActivityEvent {
  return emitActivityEvent({
    type: "workflow.step_completed",
    actor: "workflow",
    workflowId,
    agentId,
    message: `Workflow step ${stepIndex}: ${stepName} completed`,
    details: { stepIndex, stepName, agentId }
  });
}

export function instrumentWorkflowComplete(
  workflowId: string,
  workflowName: string,
  durationMs: number,
  success: boolean,
  error?: string
): ActivityEvent {
  return emitActivityEvent({
    type: success ? "workflow.completed" : "workflow.failed",
    actor: "workflow",
    workflowId,
    message: success
      ? `Workflow "${workflowName}" completed in ${durationMs}ms`
      : `Workflow "${workflowName}" failed: ${error}`,
    details: { workflowName, durationMs, success, error },
    duration: durationMs,
    success,
    error
  });
}

// Create an activity log entry from an event (for persistence)
export function activityEventToLog(event: ActivityEvent): ActionLog {
  return createActionLog({
    goalId: event.goalId ?? "system",
    taskId: event.taskId,
    workflowId: event.workflowId,
    actor: event.actor,
    kind: event.type,
    message: event.message,
    details: event.details
  });
}

