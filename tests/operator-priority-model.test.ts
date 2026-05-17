import type { DashboardData } from "@agentic/repository";
import {
  buildOperatorPriorityModel,
  OPERATOR_PRIORITY_MODEL_LIMITS
} from "../apps/web/lib/operator-priority-model";

function dashboardFixture(overrides: Partial<DashboardData> = {}): DashboardData {
  const base = {
    approvals: [],
    commitments: [],
    diagnostics: {
      status: "healthy",
      totalCount: 0,
      generatedAt: "2026-05-17T00:00:00.000Z",
      items: []
    },
    operations: {
      generatedAt: "2026-05-17T00:00:00.000Z",
      autonomyPosture: {
        status: "healthy",
        level: "bounded_autonomy",
        label: "Bounded autonomy",
        summary: "Autonomy is bounded.",
        reasons: [],
        stats: ["Mode auto run"],
        overridePaths: []
      },
      asyncExecution: {
        status: "healthy",
        queuedJobs: 0,
        retryingJobs: 0,
        runningJobs: 0,
        deadLetterJobs: 0,
        expiredLeaseCount: 0,
        stalePendingCount: 0,
        issueCount: 0,
        oldestPendingJobAgeSeconds: null,
        maxPendingJobAgeSeconds: 900,
        items: []
      },
      connectorHealth: {
        status: "healthy",
        totalCount: 0,
        connectedCount: 0,
        degradedCount: 0,
        reconnectRequiredCount: 0,
        refreshFailedCount: 0,
        revokedCount: 0,
        expiredCount: 0,
        validationStaleCount: 0,
        issueCount: 0,
        items: []
      },
      shellEffectiveness: {
        status: "healthy",
        summary: "Shell is clearing work.",
        measurementWindowDays: 30,
        windowStartedAt: "2026-04-17T00:00:00.000Z",
        approvalSampleCount: 1,
        medianApprovalDecisionSeconds: 60,
        recoveryStartCount: 0,
        recoveryResolvedCount: 0,
        medianRecoveryStartSeconds: null,
        pendingApprovalCount: 0,
        openRuntimeIssueCount: 0,
        metrics: [],
        highlights: []
      }
    }
  } as DashboardData;

  return {
    ...base,
    ...overrides,
    diagnostics: {
      ...base.diagnostics,
      ...overrides.diagnostics
    },
    operations: overrides.operations ?? base.operations
  };
}

describe("operator priority model", () => {
  it("ranks runtime recovery, approval debt, connector repair, autonomy blockers, and blocked work consistently", () => {
    const model = buildOperatorPriorityModel(
      dashboardFixture({
        approvals: [
          {
            id: "approval-r4",
            title: "Approve external escalation",
            rationale: "External send needs owner review.",
            requestedAction: "Send escalation",
            decision: "pending",
            riskClass: "R4",
            createdAt: "2026-05-16T00:00:00.000Z",
            expiryAt: "2026-05-18T00:00:00.000Z"
          }
        ] as DashboardData["approvals"],
        commitments: [
          {
            id: "commitment-blocked",
            title: "Blocked customer follow-up",
            summary: "The customer follow-up is blocked on an approval.",
            status: "needs-review",
            dueAt: "2026-05-16T00:00:00.000Z",
            urgency: "today",
            riskClass: "R3",
            provenanceSummary: "Created from approval request.",
            suggestedNextAction: {
              label: "Open approval",
              section: "approvals",
              itemId: "approval-r4"
            }
          }
        ] as DashboardData["commitments"],
        operations: {
          ...dashboardFixture().operations!,
          autonomyPosture: {
            status: "attention",
            level: "approval_gated",
            label: "Approval-gated",
            summary: "Autonomy is held behind review until runtime health clears.",
            reasons: ["One pending approval still needs operator review."],
            stats: ["Mode auto run"],
            overridePaths: [
              {
                id: "open-governance",
                label: "Open governance",
                note: "Review risk ceilings before widening autonomy.",
                permission: "owner",
                target: {
                  section: "governance",
                  label: "Open governance"
                }
              }
            ]
          },
          asyncExecution: {
            ...dashboardFixture().operations!.asyncExecution,
            status: "critical",
            deadLetterJobs: 1,
            issueCount: 1,
            items: [
              {
                id: "operations-job-job-1",
                jobId: "job-1",
                label: "Approval follow-up",
                summary: "Dead-lettered after 3/3 attempts.",
                severity: "critical",
                status: "dead_letter",
                updatedAt: "2026-05-17T00:00:00.000Z",
                target: {
                  section: "operations",
                  itemId: "operations-job-job-1",
                  label: "Open operations"
                },
                remediation: {
                  kind: "replay_job",
                  label: "Replay job",
                  note: "Replay the failed follow-up through the governed recovery route.",
                  permission: "owner",
                  statusUrl: "/api/jobs/job-1"
                }
              }
            ]
          },
          connectorHealth: {
            ...dashboardFixture().operations!.connectorHealth,
            status: "attention",
            refreshFailedCount: 1,
            issueCount: 1,
            items: [
              {
                id: "operations-connector-google",
                credentialId: "credential-google",
                label: "google - owner@example.com",
                summary: "Token refresh failed.",
                severity: "attention",
                provider: "google",
                status: "refresh_failed",
                updatedAt: "2026-05-17T00:00:00.000Z",
                target: {
                  section: "integrations",
                  itemId: "gmail",
                  label: "Open google integrations"
                },
                expectedReadinessTier: "approval-grade",
                expectedReadinessLabel: "Approval-grade",
                expectedSupportedModes: ["draft", "approval"],
                linkedIntegrationIds: ["gmail"],
                linkedIntegrationNames: ["Gmail"],
                meetingReadinessTarget: false,
                remediation: {
                  kind: "revalidate_connector_credential",
                  label: "Revalidate",
                  note: "Re-check provider access.",
                  permission: "owner"
                }
              }
            ]
          }
        }
      }),
      Date.parse("2026-05-17T12:00:00.000Z")
    );

    expect(model.priorities.map((priority) => priority.kind).slice(0, 5)).toEqual([
      "async_recovery",
      "approval_debt",
      "blocked_work",
      "overdue_commitment",
      "connector_recovery"
    ]);
    expect(model.priorities[0]).toMatchObject({
      title: "Recover async execution",
      severity: "critical",
      targetSection: "operations"
    });
    expect(model.priorities[0]?.recoveryActions[0]).toMatchObject({
      label: "Replay job",
      sideEffecting: true,
      confirmationRequired: false,
      requiredPermission: "owner"
    });
    expect(model.recoveryActions.every((action) => action.requiredPermission === "owner" || action.requiredPermission === "operator")).toBe(true);
  });

  it("bounds priority count, evidence, recovery actions, and display text", () => {
    const longReason = "x".repeat(OPERATOR_PRIORITY_MODEL_LIMITS.maxTextLength + 80);
    const model = buildOperatorPriorityModel(
      dashboardFixture({
        diagnostics: {
          status: "critical",
          totalCount: 20,
          generatedAt: "2026-05-17T00:00:00.000Z",
          items: Array.from({ length: 20 }, (_, index) => ({
            kind: "context_conflicts",
            title: `Diagnostic ${index} ${longReason}`,
            count: index + 1,
            severity: index % 2 === 0 ? "critical" : "warning",
            reasons: [longReason, longReason, longReason, longReason, longReason],
            targets: [
              {
                section: "operations",
                itemId: `diag-${index}`,
                label: "Open diagnostic"
              }
            ]
          }))
        } as DashboardData["diagnostics"]
      })
    );

    expect(model.priorities).toHaveLength(OPERATOR_PRIORITY_MODEL_LIMITS.maxPriorities);
    expect(model.truncated).toBe(true);
    expect(model.recoveryActions.length).toBeLessThanOrEqual(OPERATOR_PRIORITY_MODEL_LIMITS.maxRecoveryActions);

    for (const priority of model.priorities) {
      expect(priority.title.length).toBeLessThanOrEqual(OPERATOR_PRIORITY_MODEL_LIMITS.maxTextLength + 3);
      expect(priority.summary.length).toBeLessThanOrEqual(OPERATOR_PRIORITY_MODEL_LIMITS.maxTextLength + 3);
      expect(priority.evidence.length).toBeLessThanOrEqual(OPERATOR_PRIORITY_MODEL_LIMITS.maxEvidence);
    }
  });
});
