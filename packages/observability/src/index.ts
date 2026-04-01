import { ActionLogSchema, nowIso, type ActionLog } from "@agentic/contracts";

export function createActionLog(
  input: Omit<ActionLog, "id" | "createdAt" | "taskId" | "workflowId"> & {
    taskId?: string | null;
    workflowId?: string | null;
  }
): ActionLog {
  return ActionLogSchema.parse({
    taskId: input.taskId ?? null,
    workflowId: input.workflowId ?? null,
    ...input,
    id: crypto.randomUUID(),
    createdAt: nowIso()
  });
}
