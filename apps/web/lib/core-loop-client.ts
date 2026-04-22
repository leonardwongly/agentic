import type { CommandCenterPriority, CommandCenterRole } from "./command-center";

export type CommandCenterTelemetrySource = "next_best_action" | "priority" | "role_action" | "focus_area";

export type DashboardCoreLoopEvent =
  | {
      event: "dashboard_view";
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
