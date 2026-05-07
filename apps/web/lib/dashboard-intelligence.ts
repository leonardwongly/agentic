import { getMemoryFreshness } from "@agentic/memory";
import type { DashboardData } from "@agentic/repository";

export type DashboardKpiOwner = "ops" | "governance" | "platform" | "trust";
export type DashboardKpiStatus = "healthy" | "attention" | "critical";

export type DashboardKpiDefinition = {
  id: string;
  label: string;
  description: string;
  formula: string;
  owner: DashboardKpiOwner;
  sourceFields: string[];
  thresholds: {
    healthy: string;
    attention: string;
    critical: string;
  };
};

export type DashboardKpiReading = DashboardKpiDefinition & {
  value: number;
  unit: "count" | "ratio" | "seconds";
  status: DashboardKpiStatus;
};

export type DashboardRecommendationCategory =
  | "promote"
  | "keep_manual"
  | "demote"
  | "repair_connector"
  | "review_stale_memory"
  | "reduce_approval_debt";

export type DashboardAutomationRecommendation = {
  id: string;
  category: DashboardRecommendationCategory;
  title: string;
  summary: string;
  advisory: true;
  severity: "info" | "attention" | "critical";
  evidence: string[];
  blockers: string[];
  targetSection: string;
  targetItemId?: string;
};

export type DashboardIntelligenceReport = {
  generatedAt: string;
  advisory: true;
  kpis: DashboardKpiReading[];
  recommendations: DashboardAutomationRecommendation[];
};

const kpiDictionary: DashboardKpiDefinition[] = [
  {
    id: "approval_debt",
    label: "Approval debt",
    description: "Pending approvals that need operator review before execution can continue.",
    formula: "count(approvals where decision = pending)",
    owner: "ops",
    sourceFields: ["approvals.decision", "approvals.riskClass", "approvals.createdAt"],
    thresholds: {
      healthy: "0-2 pending approvals",
      attention: "3-5 pending approvals",
      critical: "6+ pending approvals or any pending R4"
    }
  },
  {
    id: "high_risk_approval_ratio",
    label: "High-risk approval ratio",
    description: "Share of pending approvals that are R3 or R4.",
    formula: "pending approvals with riskClass in [R3, R4] / pending approvals",
    owner: "governance",
    sourceFields: ["approvals.decision", "approvals.riskClass"],
    thresholds: {
      healthy: "< 20%",
      attention: "20-49%",
      critical: ">= 50%"
    }
  },
  {
    id: "connector_readiness",
    label: "Connector readiness",
    description: "Visible provider credentials without degradation or reconnect blockers.",
    formula: "connected credentials / visible provider credentials",
    owner: "platform",
    sourceFields: ["operations.connectorHealth.connectedCount", "operations.connectorHealth.totalCount"],
    thresholds: {
      healthy: ">= 95%",
      attention: "80-94%",
      critical: "< 80% or any critical connector issue"
    }
  },
  {
    id: "recovery_debt",
    label: "Recovery debt",
    description: "Open async execution issues that need queue recovery.",
    formula: "operations.asyncExecution.issueCount",
    owner: "platform",
    sourceFields: ["operations.asyncExecution.issueCount", "operations.asyncExecution.expiredLeaseCount"],
    thresholds: {
      healthy: "0 open issues",
      attention: "1-2 open issues",
      critical: "3+ open issues or any expired lease/dead letter"
    }
  },
  {
    id: "memory_freshness_debt",
    label: "Memory freshness debt",
    description: "Stale or expired memories that should not independently justify autonomy.",
    formula: "count(memories where freshness != fresh)",
    owner: "trust",
    sourceFields: ["memories.updatedAt", "memories.expiryAt", "memories.memoryType"],
    thresholds: {
      healthy: "0 stale memories",
      attention: "1-4 stale memories",
      critical: "5+ stale memories or any expired confirmed memory"
    }
  },
  {
    id: "post_approval_failure_count",
    label: "Post-approval failures",
    description: "Recent failed runtime events after an operator approval or automation trigger.",
    formula: "count(autopilotEvents where status = failed)",
    owner: "governance",
    sourceFields: ["autopilotEvents.status", "autopilotEvents.kind", "autopilotEvents.error"],
    thresholds: {
      healthy: "0 failed events",
      attention: "1 failed event",
      critical: "2+ failed events"
    }
  }
];

function ratio(numerator: number, denominator: number): number {
  return denominator <= 0 ? 1 : numerator / denominator;
}

function countStatus(count: number, attentionAt: number, criticalAt: number): DashboardKpiStatus {
  if (count >= criticalAt) {
    return "critical";
  }

  return count >= attentionAt ? "attention" : "healthy";
}

function ratioStatus(value: number, attentionAt: number, criticalAt: number): DashboardKpiStatus {
  if (value >= criticalAt) {
    return "critical";
  }

  return value >= attentionAt ? "attention" : "healthy";
}

export function getDashboardKpiDictionary(): DashboardKpiDefinition[] {
  return kpiDictionary.map((definition) => ({
    ...definition,
    sourceFields: [...definition.sourceFields],
    thresholds: { ...definition.thresholds }
  }));
}

export function deriveDashboardKpiReadings(data: DashboardData, now = Date.now()): DashboardKpiReading[] {
  const pendingApprovals = data.approvals.filter((approval) => approval.decision === "pending");
  const highRiskPendingApprovals = pendingApprovals.filter(
    (approval) => approval.riskClass === "R3" || approval.riskClass === "R4"
  );
  const connectorHealth = data.operations?.connectorHealth ?? null;
  const connectorReadiness = connectorHealth ? ratio(connectorHealth.connectedCount, connectorHealth.totalCount) : 1;
  const asyncIssueCount = data.operations?.asyncExecution.issueCount ?? 0;
  const staleMemories = data.memories.filter((memory) => getMemoryFreshness(memory, now) !== "fresh");
  const failedEvents = data.autopilotEvents.filter((event) => event.status === "failed");
  const highRiskRatio = pendingApprovals.length === 0 ? 0 : highRiskPendingApprovals.length / pendingApprovals.length;
  const dictionaryById = new Map(getDashboardKpiDictionary().map((definition) => [definition.id, definition]));

  return [
    {
      ...dictionaryById.get("approval_debt")!,
      value: pendingApprovals.length,
      unit: "count",
      status: pendingApprovals.some((approval) => approval.riskClass === "R4")
        ? "critical"
        : countStatus(pendingApprovals.length, 3, 6)
    },
    {
      ...dictionaryById.get("high_risk_approval_ratio")!,
      value: highRiskRatio,
      unit: "ratio",
      status: ratioStatus(highRiskRatio, 0.2, 0.5)
    },
    {
      ...dictionaryById.get("connector_readiness")!,
      value: connectorReadiness,
      unit: "ratio",
      status:
        connectorHealth?.status === "critical"
          ? "critical"
          : connectorReadiness < 0.8
            ? "critical"
            : connectorReadiness < 0.95
              ? "attention"
              : "healthy"
    },
    {
      ...dictionaryById.get("recovery_debt")!,
      value: asyncIssueCount,
      unit: "count",
      status:
        (data.operations?.asyncExecution.expiredLeaseCount ?? 0) > 0 ||
        (data.operations?.asyncExecution.deadLetterJobs ?? 0) > 0
          ? "critical"
          : countStatus(asyncIssueCount, 1, 3)
    },
    {
      ...dictionaryById.get("memory_freshness_debt")!,
      value: staleMemories.length,
      unit: "count",
      status:
        staleMemories.some((memory) => memory.memoryType === "confirmed" && getMemoryFreshness(memory, now) === "expired")
          ? "critical"
          : countStatus(staleMemories.length, 1, 5)
    },
    {
      ...dictionaryById.get("post_approval_failure_count")!,
      value: failedEvents.length,
      unit: "count",
      status: countStatus(failedEvents.length, 1, 2)
    }
  ];
}

function recommendation(params: Omit<DashboardAutomationRecommendation, "advisory">): DashboardAutomationRecommendation {
  return {
    advisory: true,
    ...params
  };
}

export function deriveDashboardAutomationRecommendations(
  data: DashboardData,
  readings = deriveDashboardKpiReadings(data)
): DashboardAutomationRecommendation[] {
  const readingsById = new Map(readings.map((reading) => [reading.id, reading]));
  const recommendations: DashboardAutomationRecommendation[] = [];
  const connectorReading = readingsById.get("connector_readiness");
  const recoveryReading = readingsById.get("recovery_debt");
  const memoryReading = readingsById.get("memory_freshness_debt");
  const approvalReading = readingsById.get("approval_debt");
  const failureReading = readingsById.get("post_approval_failure_count");
  const highRiskReading = readingsById.get("high_risk_approval_ratio");
  const governance = data.workspaceGovernance;

  if (connectorReading && connectorReading.status !== "healthy") {
    recommendations.push(
      recommendation({
        id: "repair-connector-health",
        category: "repair_connector",
        title: "Repair connector health before widening automation",
        summary: "Provider readiness is degraded, so connector repair should precede any promotion decision.",
        severity: connectorReading.status === "critical" ? "critical" : "attention",
        evidence: [`Connector readiness ${(connectorReading.value * 100).toFixed(0)}%`],
        blockers: ["Connector degradation can turn safe plans into failed side effects."],
        targetSection: "operations"
      })
    );
  }

  if (memoryReading && memoryReading.status !== "healthy") {
    recommendations.push(
      recommendation({
        id: "review-stale-memory",
        category: "review_stale_memory",
        title: "Review stale memory before using it for decisions",
        summary: "Freshness debt means memory can inform review, but should not independently justify autonomy.",
        severity: memoryReading.status === "critical" ? "critical" : "attention",
        evidence: [`${memoryReading.value} stale or expired memory records`],
        blockers: ["Stale or expired memory weakens recommendation explainability."],
        targetSection: "memory"
      })
    );
  }

  if (approvalReading && approvalReading.value >= 3) {
    recommendations.push(
      recommendation({
        id: "reduce-approval-debt",
        category: "reduce_approval_debt",
        title: "Reduce approval debt",
        summary: "Approval debt is high enough that operators should clear safe low-risk decisions before adding automation.",
        severity: approvalReading.status === "critical" ? "critical" : "attention",
        evidence: [`${approvalReading.value} pending approvals`],
        blockers: highRiskReading && highRiskReading.value >= 0.2 ? ["High-risk approvals dominate the queue."] : [],
        targetSection: "approvals"
      })
    );
  }

  if ((recoveryReading?.status === "critical" || failureReading?.status === "critical") && recommendations.length < 6) {
    recommendations.push(
      recommendation({
        id: "demote-unstable-automation",
        category: "demote",
        title: "Demote unstable automation paths",
        summary: "Queue recovery or post-approval failures are critical, so affected automations should remain manual or approval-gated.",
        severity: "critical",
        evidence: [
          `${recoveryReading?.value ?? 0} recovery issues`,
          `${failureReading?.value ?? 0} post-approval failures`
        ],
        blockers: ["Runtime instability is a promotion blocker."],
        targetSection: "operations"
      })
    );
  }

  const promotionBlockers = recommendations
    .filter((item) => item.severity === "critical")
    .flatMap((item) => item.blockers.length > 0 ? item.blockers : [item.title]);
  const canPromote =
    promotionBlockers.length === 0 &&
    connectorReading?.status === "healthy" &&
    recoveryReading?.status === "healthy" &&
    memoryReading?.status === "healthy" &&
    failureReading?.status === "healthy" &&
    governance?.approvalMode === "risk_based";

  recommendations.push(
    canPromote
      ? recommendation({
          id: "promote-approval-gated-automation",
          category: "promote",
          title: "Promote safe recurring work to approval-gated automation",
          summary: "Trust, connector, and recovery signals are healthy enough to draft a governed promotion candidate.",
          severity: "info",
          evidence: [
            "Connector readiness healthy",
            "No recovery debt",
            `Governance mode ${governance?.approvalMode ?? "unknown"}`
          ],
          blockers: [],
          targetSection: "governance"
        })
      : recommendation({
          id: "keep-manual-until-signals-clear",
          category: "keep_manual",
          title: "Keep recommendations advisory",
          summary: "One or more trust, connector, recovery, or governance signals block promotion right now.",
          severity: promotionBlockers.length > 0 ? "critical" : "attention",
          evidence: readings.map((reading) => `${reading.label}: ${reading.status}`),
          blockers:
            promotionBlockers.length > 0
              ? promotionBlockers
              : [`Governance mode ${governance?.approvalMode ?? "unknown"} is not promotion-ready.`],
          targetSection: "governance"
        })
  );

  return recommendations.slice(0, 8);
}

export function buildDashboardIntelligenceReport(data: DashboardData, now?: number): DashboardIntelligenceReport {
  const generatedAt = new Date(now ?? Date.now()).toISOString();
  const kpis = deriveDashboardKpiReadings(data, now);

  return {
    generatedAt,
    advisory: true,
    kpis,
    recommendations: deriveDashboardAutomationRecommendations(data, kpis)
  };
}
