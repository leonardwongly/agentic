import type { Commitment, Watcher } from "@agentic/contracts";
import type { WatcherSignalEvaluator } from "./watcher-scheduler";

/**
 * Minimal repository surface the deadline watcher evaluator needs. The full
 * application repository satisfies this; tests can pass a lightweight fake.
 */
export interface WatcherSignalRepositoryPort {
  listCommitments(userId?: string): Promise<Commitment[]>;
}

export type DeadlineWatcherSignalEvaluatorOptions = {
  repository: WatcherSignalRepositoryPort;
  /** Lead window (ms) before a due date within which a watcher should fire. */
  leadWindowMs?: number;
  /** Clock injection for deterministic tests. */
  now?: () => number;
};

const DEFAULT_DEADLINE_LEAD_WINDOW_MS = 24 * 60 * 60 * 1000;

// Commitments in a terminal state never warrant a deadline signal.
const RESOLVED_COMMITMENT_STATUSES = new Set<Commitment["status"]>(["completed", "dismissed"]);

function parseEpochMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Deterministic, connector-free watcher signal evaluator (AOS-19).
 *
 * It fires when the watcher's linked goal has an unresolved commitment whose
 * due date is overdue or falls within the lead window. This activates the
 * watcher "daemon" layer using state the repository already holds — no external
 * API calls, safe under the Workers CPU budget. Watchers whose goal has no
 * due/overdue commitment stay non-triggering, preserving the prior fail-safe
 * (no-op) behavior. The triggering commitment's id+due is returned as the
 * cursor so the same deadline is not re-signaled on every pass.
 */
export function createDeadlineWatcherSignalEvaluator(
  options: DeadlineWatcherSignalEvaluatorOptions
): WatcherSignalEvaluator {
  const leadWindowMs = options.leadWindowMs ?? DEFAULT_DEADLINE_LEAD_WINDOW_MS;
  const now = options.now ?? (() => Date.now());

  return async (watcher: Watcher) => {
    const subjectUserId = watcher.actorContext?.subjectUserId ?? null;

    if (!subjectUserId) {
      return {
        wouldTrigger: false,
        reason: `Watcher ${watcher.id} has no subject user for deadline evaluation.`
      };
    }

    const nowMs = now();
    const threshold = nowMs + leadWindowMs;
    const commitments = await options.repository.listCommitments(subjectUserId);
    const dueCandidates = commitments
      .filter((commitment) => commitment.goalId === watcher.goalId)
      .filter((commitment) => !RESOLVED_COMMITMENT_STATUSES.has(commitment.status))
      .map((commitment) => ({ commitment, dueMs: parseEpochMs(commitment.dueAt) }))
      .filter((candidate): candidate is { commitment: Commitment; dueMs: number } => candidate.dueMs !== null)
      .filter((candidate) => candidate.dueMs <= threshold)
      .sort((left, right) => left.dueMs - right.dueMs);

    const next = dueCandidates[0];

    if (!next) {
      return {
        wouldTrigger: false,
        reason: `No unresolved commitments for goal ${watcher.goalId} are due within the window.`
      };
    }

    const cursorKey = `${next.commitment.id}:${next.commitment.dueAt}`;

    if (watcher.schedule.cursor === cursorKey) {
      return {
        wouldTrigger: false,
        reason: `Deadline for commitment ${next.commitment.id} was already signaled.`
      };
    }

    const overdue = next.dueMs <= nowMs;

    return {
      wouldTrigger: true,
      reason: `Commitment "${next.commitment.title}" is ${overdue ? "overdue" : "due soon"} (due ${next.commitment.dueAt}, status ${next.commitment.status}).`,
      cursor: cursorKey
    };
  };
}
