import type { CommandCenterPriority, CommandCenterRole } from "./command-center";

export type CommandCenterTelemetrySource = "next_best_action" | "priority" | "role_action" | "focus_area";
export type DashboardCockpitTelemetryVariant = "legacy" | "redesigned";

export type DashboardCoreLoopEvent =
  | {
      event: "dashboard_view";
    }
  | {
      event: "dashboard_first_meaningful_render";
      elapsedMs: number;
      cockpitVariant: DashboardCockpitTelemetryVariant;
    }
  | {
      event: "dashboard_event_reconnect";
      reconnectCount: number;
      cockpitVariant: DashboardCockpitTelemetryVariant;
    }
  | {
      event: "command_palette_usage";
      action: "opened" | "selected";
      category?: "quick-goal" | "navigate" | "action";
      cockpitVariant: DashboardCockpitTelemetryVariant;
    }
  | {
      event: "cockpit_feedback";
      surface: "traceability" | "approvals" | "command_palette" | "memory" | "summary";
      sentiment: "helpful" | "unhelpful";
      reason: "clear" | "stale" | "missing_context" | "wrong_priority" | "too_noisy";
      cockpitVariant: DashboardCockpitTelemetryVariant;
    }
  | {
      event: "command_center_role_change";
      role: CommandCenterRole;
      elapsedMs: number;
    }
  | {
      event: "command_center_action";
      role: CommandCenterRole;
      source: CommandCenterTelemetrySource;
      targetSection: string;
      elapsedMs: number;
      severity?: CommandCenterPriority["severity"];
    };

export async function postDashboardCoreLoopEvent(event: DashboardCoreLoopEvent): Promise<void> {
  await fetch("/api/dashboard/core-loop", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(event),
    // Keep best-effort event delivery when navigation follows immediately.
    keepalive: true
  });
}
