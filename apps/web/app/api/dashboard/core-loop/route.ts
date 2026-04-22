import { z } from "zod";
import { logInfo, recordCounter, recordHistogram } from "@agentic/observability";
import { requireApiSession } from "../../../../lib/auth";
import { authenticatedJson, handleApiError, parseJsonBody, withApiTelemetry } from "../../../../lib/api-response";
import { summarizeCoreLoopTelemetry } from "../../../../lib/core-loop-telemetry";
import { getSeededRepository } from "../../../../lib/server";

const CoreLoopTelemetryEventSchema = z.discriminatedUnion("event", [
  z
    .object({
      event: z.literal("dashboard_view")
    })
    .strict(),
  z
    .object({
      event: z.literal("command_center_role_change"),
      role: z.enum(["command", "communications", "executive"]),
      elapsedMs: z.number().finite().min(0).max(86_400_000)
    })
    .strict(),
  z
    .object({
      event: z.literal("command_center_action"),
      role: z.enum(["command", "communications", "executive"]),
      source: z.enum(["next_best_action", "priority", "role_action", "focus_area"]),
      targetSection: z.string().trim().min(1).max(64),
      elapsedMs: z.number().finite().min(0).max(86_400_000),
      severity: z.enum(["critical", "attention"]).optional()
    })
    .strict()
]);

export async function POST(request: Request) {
  return withApiTelemetry(request, "api.dashboard.core_loop", async () => {
    try {
      const principal = await requireApiSession(request);
      const body = await parseJsonBody(request, CoreLoopTelemetryEventSchema);
      const repository = await getSeededRepository();
      const dashboard = await repository.getDashboardData(principal.userId);
      const summary = summarizeCoreLoopTelemetry(dashboard);
      const shellEffectiveness = dashboard.operations?.shellEffectiveness ?? null;

      if (body.event === "dashboard_view") {
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
      } else if (body.event === "command_center_role_change") {
        recordCounter("product.command_center.role_change.total", 1, {
          role: body.role,
          workspaceState: summary.workspaceState,
          health: summary.health
        });
        recordHistogram("product.command_center.time_to_role_change_ms", body.elapsedMs, {
          role: body.role,
          workspaceState: summary.workspaceState,
          health: summary.health
        });
        logInfo("product.command_center.role_change", {
          role: body.role,
          elapsedMs: body.elapsedMs,
          workspaceState: summary.workspaceState,
          health: summary.health
        });
      } else {
        const isRecoveryAction = body.source === "priority" || body.source === "next_best_action";
        recordCounter("product.command_center.action.total", 1, {
          role: body.role,
          source: body.source,
          targetSection: body.targetSection,
          workspaceState: summary.workspaceState,
          health: summary.health
        });
        recordHistogram("product.command_center.time_to_decision_ms", body.elapsedMs, {
          role: body.role,
          source: body.source,
          targetSection: body.targetSection,
          workspaceState: summary.workspaceState,
          health: summary.health
        });

        if (isRecoveryAction) {
          recordCounter("product.command_center.recovery_start.total", 1, {
            role: body.role,
            source: body.source,
            targetSection: body.targetSection,
            workspaceState: summary.workspaceState,
            health: summary.health
          });
          recordHistogram("product.command_center.time_to_recovery_start_ms", body.elapsedMs, {
            role: body.role,
            source: body.source,
            targetSection: body.targetSection,
            workspaceState: summary.workspaceState,
            health: summary.health
          });
        }

        logInfo("product.command_center.action", {
          role: body.role,
          source: body.source,
          targetSection: body.targetSection,
          severity: body.severity ?? null,
          elapsedMs: body.elapsedMs,
          isRecoveryAction,
          workspaceState: summary.workspaceState,
          health: summary.health,
          commitments: summary.counts.commitments,
          pendingApprovals: summary.counts.pendingApprovals,
          activeGoals: summary.counts.activeGoals
        });
      }

      return authenticatedJson({
        accepted: true,
        summary
      });
    } catch (error) {
      return handleApiError(error, "Failed to record core loop telemetry.");
    }
  });
}
