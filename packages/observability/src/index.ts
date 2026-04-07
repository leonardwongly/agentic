import crypto from "node:crypto";
import { ActionLogSchema, nowIso, type ActionLog } from "@agentic/contracts";

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
