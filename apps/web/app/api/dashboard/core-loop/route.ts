import { z } from "zod";
import { logInfo, recordCounter } from "@agentic/observability";
import { requireApiSession } from "../../../../lib/auth";
import { authenticatedJson, handleApiError, parseJsonBody, withApiTelemetry } from "../../../../lib/api-response";
import { summarizeCoreLoopTelemetry } from "../../../../lib/core-loop-telemetry";
import { getSeededRepository } from "../../../../lib/server";

const CoreLoopTelemetryEventSchema = z
  .object({
    event: z.literal("dashboard_view")
  })
  .strict();

export async function POST(request: Request) {
  return withApiTelemetry(request, "api.dashboard.core_loop", async () => {
    try {
      const principal = await requireApiSession(request);
      const body = await parseJsonBody(request, CoreLoopTelemetryEventSchema);
      const repository = await getSeededRepository();
      const dashboard = await repository.getDashboardData(principal.userId);
      const summary = summarizeCoreLoopTelemetry(dashboard);
      const shellEffectiveness = dashboard.operations?.shellEffectiveness ?? null;

      recordCounter("product.core_loop.dashboard_view.total", 1, {
        event: body.event,
        workspaceState: summary.workspaceState,
        health: summary.health
      });

      if (summary.hasActivation) {
        recordCounter("product.core_loop.activation.total", 1, {
          event: body.event,
          workspaceState: summary.workspaceState
        });
      }

      if (summary.hasRepeatUsage) {
        recordCounter("product.core_loop.repeat_usage.total", 1, {
          event: body.event,
          health: summary.health
        });
      }

      if (summary.hasValueRealization) {
        recordCounter("product.core_loop.value_realized.total", 1, {
          event: body.event,
          health: summary.health
        });
      }

      if (shellEffectiveness) {
        recordCounter("product.operator_shell.dashboard_view.total", 1, {
          event: body.event,
          status: shellEffectiveness.status
        });
      }

      logInfo("product.core_loop.dashboard_view", {
        event: body.event,
        workspaceState: summary.workspaceState,
        health: summary.health,
        hasActivation: summary.hasActivation,
        hasRepeatUsage: summary.hasRepeatUsage,
        hasValueRealization: summary.hasValueRealization,
        commitments: summary.counts.commitments,
        pendingApprovals: summary.counts.pendingApprovals,
        activeGoals: summary.counts.activeGoals,
        completedGoals: summary.counts.completedGoals,
        recentActivity: summary.counts.recentActivity,
        memories: summary.counts.memories,
        shellStatus: shellEffectiveness?.status ?? null,
        shellApprovalSampleCount: shellEffectiveness?.approvalSampleCount ?? 0,
        shellMedianApprovalDecisionSeconds: shellEffectiveness?.medianApprovalDecisionSeconds ?? null,
        shellRecoveryStartCount: shellEffectiveness?.recoveryStartCount ?? 0,
        shellRecoveryResolvedCount: shellEffectiveness?.recoveryResolvedCount ?? 0,
        shellMedianRecoveryStartSeconds: shellEffectiveness?.medianRecoveryStartSeconds ?? null,
        shellPendingApprovalCount: shellEffectiveness?.pendingApprovalCount ?? 0,
        shellRuntimeIssueCount: shellEffectiveness?.openRuntimeIssueCount ?? 0
      });

      return authenticatedJson({
        accepted: true,
        summary
      });
    } catch (error) {
      return handleApiError(error, "Failed to record core loop telemetry.");
    }
  });
}
