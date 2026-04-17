import type { DashboardData } from "@agentic/repository";

export type CoreLoopHealth = "idle" | "activation_ready" | "repeat_engaged" | "value_realized";

export type CoreLoopTelemetrySummary = {
  health: CoreLoopHealth;
  workspaceState: "configured" | "missing";
  hasActivation: boolean;
  hasRepeatUsage: boolean;
  hasValueRealization: boolean;
  counts: {
    commitments: number;
    pendingApprovals: number;
    activeGoals: number;
    completedGoals: number;
    completedCommitments: number;
    recentActivity: number;
    memories: number;
  };
};

export function summarizeCoreLoopTelemetry(dashboard: DashboardData): CoreLoopTelemetrySummary {
  const pendingApprovals = dashboard.approvals.filter((approval) => approval.decision === "pending").length;
  const activeGoals = dashboard.goals.filter((bundle) => bundle.goal.status === "running" || bundle.goal.status === "waiting").length;
  const completedGoals = dashboard.goals.filter((bundle) => bundle.goal.status === "completed").length;
  const completedCommitments = dashboard.commitments.filter((commitment) => commitment.status === "completed").length;
  const recentActivity = dashboard.actionLogs.length;
  const commitments = dashboard.commitments.length;
  const memories = dashboard.memories.length;
  const hasActivation = dashboard.activeWorkspace !== null && (commitments > 0 || pendingApprovals > 0 || dashboard.goals.length > 0);
  const hasRepeatUsage = hasActivation && (recentActivity >= 3 || commitments + pendingApprovals + dashboard.goals.length >= 2);
  const hasValueRealization = hasActivation && (completedGoals > 0 || completedCommitments > 0 || dashboard.latestArtifacts.length > 0);

  let health: CoreLoopHealth = "idle";

  if (hasActivation) {
    health = hasValueRealization ? "value_realized" : hasRepeatUsage ? "repeat_engaged" : "activation_ready";
  }

  return {
    health,
    workspaceState: dashboard.activeWorkspace ? "configured" : "missing",
    hasActivation,
    hasRepeatUsage,
    hasValueRealization,
    counts: {
      commitments,
      pendingApprovals,
      activeGoals,
      completedGoals,
      completedCommitments,
      recentActivity,
      memories
    }
  };
}

export function describeCoreLoopHealth(summary: CoreLoopTelemetrySummary): string {
  switch (summary.health) {
    case "value_realized":
      return "Value is being realized through completed work and recent governed execution.";
    case "repeat_engaged":
      return "The governed loop is active and showing repeat engagement.";
    case "activation_ready":
      return "The governed loop is seeded and ready for repeated execution.";
    default:
      return "Seed a workspace with commitments, approvals, or goals to activate the governed loop.";
  }
}
