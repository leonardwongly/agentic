import type {
  ApprovalRequest,
  Commitment,
  DashboardOperatingSection,
  GoalBundle,
  OperatorProduct
} from "@agentic/contracts";
import type { DashboardData } from "@agentic/repository";
import { buildOperatorPriorityModel, type OperatorPriority } from "./operator-priority-model";

export type CommandCenterRole = "command" | "communications" | "executive";

export type CommandCenterAction = {
  id: string;
  label: string;
  targetSection: string;
  targetItemId?: string;
};

export type CommandCenterPriority = {
  id: string;
  title: string;
  summary: string;
  severity: "critical" | "attention";
  kind: "blocked" | "approval" | "failure" | "automation" | "connector";
  countLabel: string;
  action: CommandCenterAction;
};

export type CommandCenterFocusArea = {
  id: string;
  title: string;
  description: string;
  status: DashboardOperatingSection["status"];
  metric: string;
  targetSection: string;
  targetItemId?: string;
};

export type CommandCenterRoleView = {
  id: CommandCenterRole;
  label: string;
  eyebrow: string;
  description: string;
  stats: string[];
  actions: CommandCenterAction[];
  focusAreas: CommandCenterFocusArea[];
};

export type DashboardCommandCenterModel = {
  summary: string;
  blockedCount: number;
  approvalCount: number;
  failureCount: number;
  nextBestAction: CommandCenterAction | null;
  priorities: CommandCenterPriority[];
  roleViews: Record<CommandCenterRole, CommandCenterRoleView>;
  activeOperatorProductName: string | null;
};

type BuildDashboardCommandCenterModelParams = {
  data: DashboardData;
  selectedOperatorProduct: OperatorProduct | null;
};

const operatingStatusWeight: Record<DashboardOperatingSection["status"], number> = {
  critical: 4,
  attention: 3,
  healthy: 2,
  idle: 1
};

function pluralize(count: number, noun: string): string {
  if (count === 1) {
    return `${count} ${noun}`;
  }

  if (noun.endsWith("y") && noun.length > 1) {
    return `${count} ${noun.slice(0, -1)}ies`;
  }

  return `${count} ${noun}s`;
}

function findOpenApprovals(approvals: ApprovalRequest[]): ApprovalRequest[] {
  return approvals.filter((approval) => approval.decision === "pending");
}

function findOpenCommitments(commitments: Commitment[]): Commitment[] {
  return commitments.filter((commitment) => commitment.status !== "completed" && commitment.status !== "dismissed");
}

function statusCountLabel(status: DashboardOperatingSection["status"]): string {
  switch (status) {
    case "critical":
      return "Critical";
    case "attention":
      return "Attention";
    case "healthy":
      return "Healthy";
    default:
      return "Idle";
  }
}

function severityCountLabel(severity: CommandCenterPriority["severity"]): string {
  return severity === "critical" ? "Critical" : "Attention";
}

function mapOperatorPriorityKind(kind: OperatorPriority["kind"]): CommandCenterPriority["kind"] {
  switch (kind) {
    case "approval_debt":
      return "approval";
    case "connector_recovery":
      return "connector";
    case "autonomy_blocker":
      return "automation";
    case "blocked_work":
    case "overdue_commitment":
      return "blocked";
    case "async_recovery":
    case "diagnostic":
      return "failure";
  }
}

function buildPriorityList(data: DashboardData): CommandCenterPriority[] {
  return buildOperatorPriorityModel(data).priorities.slice(0, 5).map((operatorPriority) => {
    const primaryAction = operatorPriority.recoveryActions[0];
    const severity: CommandCenterPriority["severity"] =
      operatorPriority.severity === "critical" ? "critical" : "attention";

    return {
      id: operatorPriority.id,
      title: operatorPriority.title,
      summary: operatorPriority.summary,
      severity,
      kind: mapOperatorPriorityKind(operatorPriority.kind),
      countLabel: `${severityCountLabel(severity)} · ${operatorPriority.countLabel}`,
      action: {
        id: primaryAction?.id ?? `open-${operatorPriority.id}`,
        label: primaryAction?.label ?? "Open priority",
        targetSection: primaryAction?.targetSection ?? operatorPriority.targetSection,
        targetItemId: primaryAction?.targetItemId ?? operatorPriority.targetItemId
      }
    };
  });
}

function toFocusArea(section: DashboardOperatingSection): CommandCenterFocusArea {
  return {
    id: section.key,
    title: section.title,
    description: section.description,
    status: section.status,
    metric: section.metrics[0] ?? "Inspect lane health",
    targetSection: section.targetSection,
    targetItemId: section.targetItemId
  };
}

function buildCommandFocusAreas(data: DashboardData): CommandCenterFocusArea[] {
  return data.operatingSections.sections
    .slice()
    .sort((left, right) => operatingStatusWeight[right.status] - operatingStatusWeight[left.status])
    .slice(0, 3)
    .map(toFocusArea);
}

function buildCommunicationsFocusAreas(
  data: DashboardData,
  selectedOperatorProduct: OperatorProduct | null,
  pendingApprovals: ApprovalRequest[],
  openCommitments: Commitment[]
): CommandCenterFocusArea[] {
  const trustLane = data.operatingSections.sections.find((section) => section.key === "trust") ?? null;
  const topQueueItem = data.nowQueue.items[0] ?? null;

  return [
    {
      id: "communications-approvals",
      title: "Approvals inbox",
      description:
        pendingApprovals.length > 0
          ? `${pluralize(pendingApprovals.length, "pending approval")} can block outbound responses and escalation decisions.`
          : "No pending approvals are currently blocking external decisions.",
      status:
        pendingApprovals.length === 0
          ? "healthy"
          : pendingApprovals.some((approval) => approval.riskClass === "R4" || approval.riskClass === "R3")
            ? "critical"
            : "attention",
      metric:
        pendingApprovals.length > 0
          ? `${pendingApprovals[0]?.riskClass ?? "R2"} decision first`
          : "Inbox clear",
      targetSection: "approvals",
      targetItemId: pendingApprovals[0]?.id
    },
    {
      id: "communications-follow-up",
      title: "Follow-up queue",
      description:
        topQueueItem !== null
          ? topQueueItem.summary
          : "No immediate communication commitments are waiting in the now queue.",
      status:
        topQueueItem?.status === "needs-review" || topQueueItem?.status === "stale"
          ? "critical"
          : topQueueItem
            ? "attention"
            : "healthy",
      metric:
        topQueueItem !== null
          ? `${pluralize(data.nowQueue.totalCount, "ready item")}`
          : `${pluralize(openCommitments.length, "open commitment")}`,
      targetSection: "now",
      targetItemId: topQueueItem?.commitmentId
    },
    {
      id: "communications-role-pack",
      title: "Role pack",
      description:
        selectedOperatorProduct !== null
          ? selectedOperatorProduct.description
          : "Select a role pack to preload integrations, KPIs, and reusable communications setup.",
      status: selectedOperatorProduct !== null ? "healthy" : "attention",
      metric:
        selectedOperatorProduct !== null
          ? `${pluralize(selectedOperatorProduct.recommendedAgentIds.length, "recommended agent")}`
          : trustLane?.metrics[0] ?? "No role pack selected",
      targetSection: "operator-products",
      targetItemId: selectedOperatorProduct?.id
    }
  ];
}

function buildExecutiveFocusAreas(
  data: DashboardData,
  blockedCount: number,
  failureCount: number,
  nextBestAction: CommandCenterAction | null
): CommandCenterFocusArea[] {
  const executionLane = data.operatingSections.sections.find((section) => section.key === "execution");
  const trustLane = data.operatingSections.sections.find((section) => section.key === "trust");
  const buildLane = data.operatingSections.sections.find((section) => section.key === "build");

  return [
    executionLane
      ? toFocusArea(executionLane)
      : {
          id: "executive-execution",
          title: "Execution",
          description: "No execution lane is currently available.",
          status: "idle",
          metric: "No active goals",
          targetSection: "goals"
        },
    trustLane
      ? toFocusArea(trustLane)
      : {
          id: "executive-trust",
          title: "Trust",
          description: "Trust posture is not currently summarized.",
          status: "idle",
          metric: "No trust summary",
          targetSection: "approvals"
        },
    buildLane
      ? toFocusArea(buildLane)
      : {
          id: "executive-next-action",
          title: "Next best action",
          description:
            nextBestAction !== null
              ? `Move directly into ${nextBestAction.label.toLowerCase()} to unblock the command center.`
              : "No follow-on build lane is currently highlighted.",
          status: failureCount > 0 || blockedCount > 0 ? "attention" : "healthy",
          metric: nextBestAction?.label ?? "Stable",
          targetSection: nextBestAction?.targetSection ?? "now",
          targetItemId: nextBestAction?.targetItemId
        }
  ];
}

export function buildDashboardCommandCenterModel(
  params: BuildDashboardCommandCenterModelParams
): DashboardCommandCenterModel {
  const { data, selectedOperatorProduct } = params;
  const pendingApprovals = findOpenApprovals(data.approvals);
  const openCommitments = findOpenCommitments(data.commitments);
  const blockedCount =
    openCommitments.filter(
      (commitment) =>
        commitment.status === "blocked" || commitment.status === "needs-review" || commitment.status === "stale"
    ).length +
    data.goals.flatMap((bundle: GoalBundle) => bundle.tasks).filter((task) => task.state === "blocked" || task.state === "failed").length;
  const failureCount =
    data.autopilotEvents.filter((event) => event.status === "failed").length +
    (data.operations?.asyncExecution.deadLetterJobs ?? 0) +
    (data.operations?.connectorHealth.refreshFailedCount ?? 0) +
    data.diagnostics.items
      .filter((item) => item.severity === "critical")
      .reduce((total, item) => total + item.count, 0);
  const priorities = buildPriorityList(data);
  const nextBestAction = priorities[0]?.action ?? null;
  const readyNowCount = data.nowQueue.totalCount;
  const commandFocusAreas = buildCommandFocusAreas(data);
  const commandRoleView: CommandCenterRoleView = {
    id: "command",
    label: "Command",
    eyebrow: "Default operator lens",
    description:
      "Run the default control loop from the sharpest exception, then step through the lanes that already carry server-derived ownership and next targets.",
    stats: [
      `${pluralize(blockedCount, "blocked lane")}`,
      `${pluralize(pendingApprovals.length, "pending approval")}`,
      `${pluralize(readyNowCount, "ready now item")}`
    ],
    actions: [
      nextBestAction ?? {
        id: "open-now-default",
        label: "Open now queue",
        targetSection: "now"
      },
      {
        id: "command-open-approvals",
        label: "Review approvals",
        targetSection: "approvals",
        targetItemId: pendingApprovals[0]?.id
      },
      {
        id: "command-open-operations",
        label: "Inspect operations",
        targetSection: "operations",
        targetItemId: data.operations?.asyncExecution.items[0]?.id
      }
    ],
    focusAreas: commandFocusAreas
  };
  const communicationsRoleView: CommandCenterRoleView = {
    id: "communications",
    label: "Communications",
    eyebrow:
      selectedOperatorProduct?.slug === "communications-operator"
        ? "Selected operator product"
        : "Role-aware wedge",
    description:
      selectedOperatorProduct?.slug === "communications-operator"
        ? selectedOperatorProduct.tagline
        : "Collapse inbound decisions, follow-ups, and escalation work into one focused operating wedge.",
    stats: [
      `${pluralize(pendingApprovals.length, "decision waiting")}`,
      `${pluralize(openCommitments.length, "open follow-up")}`,
      `${pluralize(data.latestArtifacts.length, "recent artifact")}`
    ],
    actions: [
      {
        id: "communications-open-approvals",
        label: "Review approvals",
        targetSection: "approvals",
        targetItemId: pendingApprovals[0]?.id
      },
      {
        id: "communications-open-now",
        label: "Open now queue",
        targetSection: "now",
        targetItemId: data.nowQueue.items[0]?.commitmentId
      },
      {
        id: "communications-open-product",
        label: selectedOperatorProduct ? "Open operator pack" : "Load operator pack",
        targetSection: "operator-products",
        targetItemId: selectedOperatorProduct?.id
      }
    ],
    focusAreas: buildCommunicationsFocusAreas(data, selectedOperatorProduct, pendingApprovals, openCommitments)
  };
  const executiveRoleView: CommandCenterRoleView = {
    id: "executive",
    label: "Executive",
    eyebrow: "Outcome and trust lens",
    description:
      "Keep the landing shell scoped to leadership decisions: execution risk, trust posture, and whether the next operator move is still bounded.",
    stats: [
      `${pluralize(data.goals.filter((bundle) => bundle.goal.status !== "completed").length, "active goal")}`,
      `${pluralize(data.diagnostics.totalCount, "reliability signal")}`,
      `${pluralize(data.workspaces.length, "workspace")}`
    ],
    actions: [
      {
        id: "executive-open-trust",
        label: "Review trust posture",
        targetSection:
          data.operatingSections.sections.find((section) => section.key === "trust")?.targetSection ?? "approvals",
        targetItemId: data.operatingSections.sections.find((section) => section.key === "trust")?.targetItemId
      },
      {
        id: "executive-open-execution",
        label: "Review execution",
        targetSection:
          data.operatingSections.sections.find((section) => section.key === "execution")?.targetSection ?? "goals",
        targetItemId: data.operatingSections.sections.find((section) => section.key === "execution")?.targetItemId
      },
      nextBestAction ?? {
        id: "executive-open-now",
        label: "Open now queue",
        targetSection: "now"
      }
    ],
    focusAreas: buildExecutiveFocusAreas(data, blockedCount, failureCount, nextBestAction)
  };

  return {
    summary:
      priorities.length > 0
        ? `${pluralize(blockedCount, "blocked lane")}, ${pluralize(pendingApprovals.length, "pending approval")}, and ${pluralize(failureCount, "failing signal")} are visible before the rest of the dashboard.`
        : "No blocking exceptions are open. Use the role lenses to move from queue review into execution, trust, and build readiness.",
    blockedCount,
    approvalCount: pendingApprovals.length,
    failureCount,
    nextBestAction,
    priorities,
    roleViews: {
      command: commandRoleView,
      communications: communicationsRoleView,
      executive: executiveRoleView
    },
    activeOperatorProductName: selectedOperatorProduct?.name ?? null
  };
}

export function getPreferredCommandCenterRole(selectedOperatorProduct: OperatorProduct | null): CommandCenterRole {
  if (selectedOperatorProduct?.slug === "communications-operator") {
    return "communications";
  }

  return "command";
}

export function getCommandCenterStatusLabel(status: DashboardOperatingSection["status"]): string {
  return statusCountLabel(status);
}

export function getCommandCenterStatusSortWeight(status: DashboardOperatingSection["status"]): number {
  return operatingStatusWeight[status];
}
