import { ActionLogSchema, clone, type ActionLog } from "@agentic/contracts";
import type { PoolClient } from "pg";

type ActionLogStore = {
  goals: Array<{ id: string }>;
  actionLogs: ActionLog[];
};

function appendMissingActionLogs(existingLogs: ActionLog[], nextLogs: ActionLog[]): ActionLog[] {
  const seenIds = new Set(existingLogs.map((log) => log.id));
  const appendedLogs = [...existingLogs];

  for (const log of nextLogs) {
    if (seenIds.has(log.id)) {
      continue;
    }

    seenIds.add(log.id);
    appendedLogs.push(log);
  }

  return appendedLogs;
}

export function validateGoalActionLogs(goalId: string, logs: ActionLog[]): ActionLog[] {
  const validatedLogs = logs.map((log) => ActionLogSchema.parse(log));

  for (const log of validatedLogs) {
    if (log.goalId !== goalId) {
      throw new Error(`Action log ${log.id} belongs to goal ${log.goalId}, not ${goalId}.`);
    }
  }

  return validatedLogs;
}

export function cloneActionLogs(logs: ActionLog[]): ActionLog[] {
  return logs.map((log) => ActionLogSchema.parse(clone(log)));
}

// Per-store serialization chain: direct callers that share one store object
// get atomic read-modify-write appends without needing an external lock.
// Keyed weakly so chains do not keep stores alive; each entry swallows errors
// so one failed append never blocks the next.
const appendChains = new WeakMap<object, Promise<unknown>>();

async function commitGoalActionLogsAppend<TStore extends ActionLogStore>(
  store: TStore,
  goalId: string,
  logs: ActionLog[],
  writeStore: (store: TStore) => Promise<void>
): Promise<ActionLog[]> {
  if (!store.goals.some((goal) => goal.id === goalId)) {
    throw new Error(`Goal ${goalId} was not found.`);
  }

  const validatedLogs = validateGoalActionLogs(goalId, logs);
  const appendedLogs = appendMissingActionLogs(store.actionLogs, validatedLogs);
  const originalLogs = store.actionLogs;

  // Roll back the in-memory view if persistence fails so a failed write never
  // leaves the store diverged from disk (previously a failed writeStore left
  // the appended logs in memory, where dedup would then silently skip them on
  // every retry — losing the entries for good).
  store.actionLogs = appendedLogs;
  try {
    await writeStore(store);
  } catch (error) {
    store.actionLogs = originalLogs;
    throw error;
  }

  return cloneActionLogs(validatedLogs);
}

export async function appendGoalActionLogsToStore<TStore extends ActionLogStore>(
  store: TStore,
  goalId: string,
  logs: ActionLog[],
  writeStore: (store: TStore) => Promise<void>
): Promise<ActionLog[]> {
  const run = () => commitGoalActionLogsAppend(store, goalId, logs, writeStore);
  const previous = appendChains.get(store) ?? Promise.resolve();
  const current = previous.then(run, run);
  appendChains.set(store, current.catch(() => undefined));
  return current;
}

export async function appendGoalActionLogsWithClient(
  client: PoolClient,
  goalId: string,
  logs: ActionLog[]
): Promise<ActionLog[]> {
  const validatedLogs = validateGoalActionLogs(goalId, logs);
  const goalResult = await client.query("select id from goals where id = $1 limit 1", [goalId]);

  if ((goalResult.rowCount ?? 0) === 0) {
    throw new Error(`Goal ${goalId} was not found.`);
  }

  for (const log of validatedLogs) {
    await client.query(
      `
        insert into action_logs (id, goal_id, task_id, workflow_id, actor, kind, message, details, sort_order, created_at)
        values (
          $1, $2, $3, $4, $5, $6, $7, $8::jsonb,
          (select coalesce(max(sort_order), -1) + 1 from action_logs where goal_id = $2),
          $9
        )
        on conflict (id) do nothing
      `,
      [
        log.id,
        log.goalId,
        log.taskId,
        log.workflowId,
        log.actor,
        log.kind,
        log.message,
        JSON.stringify(log.details),
        log.createdAt
      ]
    );
  }

  return cloneActionLogs(validatedLogs);
}
