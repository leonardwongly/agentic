import { z } from "zod";
import { logInfo, recordCounter, recordHistogram } from "@agentic/observability";
import { requireApiSession } from "../../../../lib/auth";
import { authenticatedJson, handleApiError, parseJsonBody, withApiTelemetry } from "../../../../lib/api-response";
import { summarizeCoreLoopTelemetry } from "../../../../lib/core-loop-telemetry";
import { getSeededRepository } from "../../../../lib/server";

const CockpitVariantSchema = z.enum(["legacy", "redesigned"]);

const CoreLoopTelemetryEventSchema = z.discriminatedUnion("event", [
  z
    .object({
      event: z.literal("dashboard_view")
    })
    .strict(),
  z
    .object({
      event: z.literal("dashboard_first_meaningful_render"),
      elapsedMs: z.number().finite().min(0).max(86_400_000),
      cockpitVariant: CockpitVariantSchema
    })
    .strict(),
  z
    .object({
      event: z.literal("dashboard_summary_latency"),
      latencyMs: z.number().finite().min(0).max(86_400_000),
      cockpitVariant: CockpitVariantSchema
    })
    .strict(),
  z
    .object({
      event: z.literal("dashboard_table_latency"),
      table: z.enum(["goals", "approvals", "commitments", "artifacts", "memory", "operations"]),
      latencyMs: z.number().finite().min(0).max(86_400_000),
      cockpitVariant: CockpitVariantSchema
    })
    .strict(),
  z
    .object({
      event: z.literal("dashboard_event_reconnect"),
      reconnectCount: z.number().int().min(1).max(100),
      cockpitVariant: CockpitVariantSchema
    })
    .strict(),
  z
    .object({
      event: z.literal("dashboard_approval_latency"),
      decision: z.enum(["approved", "rejected"]),
      riskClass: z.enum(["R1", "R2", "R3", "R4"]),
      latencyMs: z.number().finite().min(0).max(86_400_000),
      cockpitVariant: CockpitVariantSchema
    })
    .strict(),
  z
    .object({
      event: z.literal("dashboard_dead_letter_recovery_latency"),
      latencyMs: z.number().finite().min(0).max(86_400_000),
      cockpitVariant: CockpitVariantSchema
    })
    .strict(),
  z
    .object({
      event: z.literal("command_palette_usage"),
      action: z.enum(["opened", "selected"]),
      category: z.enum(["quick-goal", "navigate", "action"]).optional(),
      cockpitVariant: CockpitVariantSchema
    })
    .strict(),
  z
    .object({
      event: z.literal("cockpit_feedback"),
      surface: z.enum(["traceability", "approvals", "command_palette", "memory", "summary"]),
      sentiment: z.enum(["helpful", "unhelpful"]),
      reason: z.enum(["clear", "stale", "missing_context", "wrong_priority", "too_noisy"]),
      cockpitVariant: CockpitVariantSchema
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

type CoreLoopTelemetryEvent = z.infer<typeof CoreLoopTelemetryEventSchema>;
type FastCockpitTelemetryEvent = Exclude<
  CoreLoopTelemetryEvent,
  { event: "dashboard_view" | "command_center_role_change" | "command_center_action" }
>;

function recordFastCockpitTelemetry(body: CoreLoopTelemetryEvent): body is FastCockpitTelemetryEvent {
  switch (body.event) {
    case "dashboard_first_meaningful_render":
      recordHistogram("product.dashboard.first_meaningful_render_ms", body.elapsedMs, {
        variant: body.cockpitVariant
      });
      logInfo("product.dashboard.first_meaningful_render", {
        elapsedMs: body.elapsedMs,
        variant: body.cockpitVariant
      });
      return true;
    case "dashboard_summary_latency":
      recordHistogram("product.dashboard.summary_latency_ms", body.latencyMs, {
        variant: body.cockpitVariant
      });
      logInfo("product.dashboard.summary_latency", {
        latencyMs: body.latencyMs,
        variant: body.cockpitVariant
      });
      return true;
    case "dashboard_table_latency":
      recordHistogram("product.dashboard.table_endpoint_latency_ms", body.latencyMs, {
        table: body.table,
        variant: body.cockpitVariant
      });
      logInfo("product.dashboard.table_latency", {
        table: body.table,
        latencyMs: body.latencyMs,
        variant: body.cockpitVariant
      });
      return true;
    case "dashboard_event_reconnect":
      recordCounter("product.dashboard.event_reconnect.total", body.reconnectCount, {
        variant: body.cockpitVariant
      });
      logInfo("product.dashboard.event_reconnect", {
        reconnectCount: body.reconnectCount,
        variant: body.cockpitVariant
      });
      return true;
    case "dashboard_approval_latency":
      recordHistogram("product.dashboard.approval_latency_ms", body.latencyMs, {
        decision: body.decision,
        riskClass: body.riskClass,
        variant: body.cockpitVariant
      });
      logInfo("product.dashboard.approval_latency", {
        decision: body.decision,
        riskClass: body.riskClass,
        latencyMs: body.latencyMs,
        variant: body.cockpitVariant
      });
      return true;
    case "dashboard_dead_letter_recovery_latency":
      recordHistogram("product.dashboard.dead_letter_recovery_ms", body.latencyMs, {
        variant: body.cockpitVariant
      });
      logInfo("product.dashboard.dead_letter_recovery", {
        latencyMs: body.latencyMs,
        variant: body.cockpitVariant
      });
      return true;
    case "command_palette_usage":
      recordCounter("product.dashboard.command_palette.total", 1, {
        action: body.action,
        category: body.category ?? "none",
        variant: body.cockpitVariant
      });
      logInfo("product.dashboard.command_palette", {
        action: body.action,
        category: body.category ?? "none",
        variant: body.cockpitVariant
      });
      return true;
    case "cockpit_feedback":
      recordCounter("product.dashboard.cockpit_feedback.total", 1, {
        surface: body.surface,
        sentiment: body.sentiment,
        reason: body.reason,
        variant: body.cockpitVariant
      });
      logInfo("product.dashboard.cockpit_feedback", {
        surface: body.surface,
        sentiment: body.sentiment,
        reason: body.reason,
        variant: body.cockpitVariant
      });
      return true;
    default:
      return false;
  }
}

export async function POST(request: Request) {
  return withApiTelemetry(request, "api.dashboard.core_loop", async () => {
    try {
      const principal = await requireApiSession(request);
      const body = await parseJsonBody(request, CoreLoopTelemetryEventSchema);

      if (recordFastCockpitTelemetry(body)) {
        return authenticatedJson({
          accepted: true
        });
      }

      const repository = await getSeededRepository();
      const summaryStartedAt = Date.now();
      const dashboard = await repository.getDashboardData(principal.userId);
      const summaryLatencyMs = Date.now() - summaryStartedAt;
      const summary = summarizeCoreLoopTelemetry(dashboard);
      const shellEffectiveness = dashboard.operations?.shellEffectiveness ?? null;
      recordHistogram("product.dashboard.summary_latency_ms", summaryLatencyMs, {
        variant: dashboard.cockpitRollout.variant,
        workspaceState: summary.workspaceState,
        health: summary.health
      });

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
