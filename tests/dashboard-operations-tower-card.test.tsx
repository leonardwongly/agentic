import { renderToStaticMarkup } from "react-dom/server";
import type { DashboardData } from "@agentic/repository";
import { DashboardOperationsTowerCard } from "../apps/web/components/dashboard-operations-tower-card";
import { SHARED_JOB_REPLAY_DENIED_REASON } from "../apps/web/lib/workspace-role-permissions";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn()
  })
}));

describe("DashboardOperationsTowerCard", () => {
  it("renders connector readiness expectations for degraded providers", () => {
    const operations = {
      generatedAt: "2026-04-21T00:00:00.000Z",
      autonomyPosture: {
        status: "critical",
        level: "blocked",
        label: "Blocked",
        summary: "Autonomy is blocked until queue recovery and connector repair return the runtime to policy-safe bounds.",
        reasons: [
          "Dead-lettered after 1/2 attempts.",
          "Workspace governance disabled shadow replay while still allowing R3 autonomy, so elevated autonomy stays held back until replay thresholds are restored.",
          "Autopilot mode is notify only, so execution remains operator-controlled."
        ],
        stats: [
          "Mode notify only",
          "Approval risk based",
          "Max auto R1",
          "Shadow replay off",
          "1 pending approval",
          "0 failed events"
        ],
        overridePaths: [
          {
            id: "autonomy-open-queue-recovery",
            label: "Open queue recovery",
            note: "Recover dead letters, stale leases, or retry loops before widening autonomy.",
            permission: "owner",
            target: {
              section: "operations",
              itemId: "operations-job-job-1",
              label: "Review outbound reply"
            }
          },
          {
            id: "autonomy-open-autopilot",
            label: "Open autopilot controls",
            note: "Adjust notify-only, draft-goal, or auto-run posture from the workspace control surface.",
            permission: "owner",
            target: {
              section: "autopilot",
              label: "Open autopilot controls"
            }
          }
        ]
      },
      shellEffectiveness: {
        status: "attention",
        summary:
          "The operator shell is active, but current decision or recovery evidence shows work is not yet clearing within the intended bounds.",
        measurementWindowDays: 30,
        windowStartedAt: "2026-03-22T00:00:00.000Z",
        approvalSampleCount: 2,
        medianApprovalDecisionSeconds: 900,
        recoveryStartCount: 1,
        recoveryResolvedCount: 0,
        medianRecoveryStartSeconds: 300,
        pendingApprovalCount: 1,
        openRuntimeIssueCount: 2,
        metrics: [
          "2 approval decisions / 30d",
          "Median approval 15m",
          "1 recovery start / 30d",
          "Median recovery 5m",
          "2 runtime issues",
          "1 pending approval"
        ],
        highlights: [
          "Recent approvals reached a median decision time of 15m.",
          "Queue recoveries started with a median latency of 5m.",
          "1 recovery replay still has not completed successfully.",
          "1 pending approval still needs operator attention."
        ]
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
        status: "attention",
        totalCount: 1,
        connectedCount: 0,
        degradedCount: 1,
        reconnectRequiredCount: 0,
        refreshFailedCount: 1,
        revokedCount: 0,
        expiredCount: 0,
        validationStaleCount: 0,
        issueCount: 1,
        items: [
          {
            id: "operations-connector-google:global:acct-123",
            credentialId: "google:global:acct-123",
            label: "google · owner@example.com",
            summary: "Token refresh failed, so the connector may stop working until it is revalidated.",
            severity: "attention",
            provider: "google",
            status: "refresh_failed",
            lifecycleState: "degraded",
            repairState: "refresh_repair_required",
            missingScopes: [],
            updatedAt: "2026-04-21T00:00:00.000Z",
            target: {
              section: "integrations",
              label: "Open google integrations"
            },
            expectedReadinessTier: "approval-grade",
            expectedReadinessLabel: "Approval-grade",
            expectedSupportedModes: ["draft", "approval"],
            linkedIntegrationIds: ["gmail", "google-calendar"],
            linkedIntegrationNames: ["Gmail Adapter", "Google Calendar Adapter"],
            meetingReadinessTarget: false,
            operatorSteps: [
              "Run connector revalidation from the recovery lane.",
              "Confirm encrypted credential storage remains present and secret material is not exposed.",
              "If revalidation fails again, reconnect the provider account before widening automation."
            ]
          }
        ]
      }
    } satisfies NonNullable<DashboardData["operations"]>;

    const html = renderToStaticMarkup(
      <DashboardOperationsTowerCard
        operations={operations}
        expanded
        highlightedItemId={null}
        getItemAnchorId={(itemId) => itemId}
        navigateToSection={() => undefined}
        canReplayDeadLetterJobs
        replayPermissionReason=""
      />
    );

    expect(html).toContain("Target Approval-grade");
    expect(html).toContain("Below target");
    expect(html).toContain("Expected draft · approval");
    expect(html).toContain("Gmail Adapter · Google Calendar Adapter");
    expect(html).toContain("Run connector revalidation from the recovery lane.");
    expect(html).toContain("Confirm encrypted credential storage remains present and secret material is not exposed.");
    expect(html).toContain("Shell effectiveness");
    expect(html).toContain("Shell: attention");
    expect(html).toContain("2 approval decisions / 30d");
    expect(html).toContain("Median recovery 5m");
    expect(html).toContain("1 recovery replay still has not completed successfully.");
    expect(html).toContain("Autonomy posture");
    expect(html).toContain("Autonomy: Blocked");
    expect(html).toContain("Shadow replay off");
    expect(html).toContain("disabled shadow replay");
    expect(html).toContain("Open queue recovery");
    expect(html).toContain("Open autopilot controls");
  });

  it("disables replay remediation when the workspace role can only inspect shared runtime issues", () => {
    const operations = {
      generatedAt: "2026-04-21T00:00:00.000Z",
      autonomyPosture: {
        status: "attention",
        level: "operator_review",
        label: "Operator review",
        summary: "A shared dead-letter queue item remains visible, but replay is restricted.",
        reasons: [],
        stats: ["Mode notify only"],
        overridePaths: []
      },
      shellEffectiveness: {
        status: "attention",
        summary: "A dead-lettered job still needs recovery.",
        measurementWindowDays: 30,
        windowStartedAt: "2026-03-22T00:00:00.000Z",
        approvalSampleCount: 1,
        medianApprovalDecisionSeconds: 900,
        recoveryStartCount: 0,
        recoveryResolvedCount: 0,
        medianRecoveryStartSeconds: null,
        pendingApprovalCount: 0,
        openRuntimeIssueCount: 1,
        metrics: ["1 runtime issue"],
        highlights: ["Viewers can inspect the dead letter, but replay remains disabled."]
      },
      asyncExecution: {
        status: "attention",
        queuedJobs: 0,
        retryingJobs: 0,
        runningJobs: 0,
        deadLetterJobs: 1,
        expiredLeaseCount: 0,
        stalePendingCount: 0,
        issueCount: 1,
        oldestPendingJobAgeSeconds: null,
        maxPendingJobAgeSeconds: 900,
        items: [
          {
            id: "operations-job-job-1",
            jobId: "job-1",
            label: "Approval notification dead letter",
            summary: "The shared runtime issue is visible to viewers, but replay is still restricted.",
            severity: "attention",
            status: "dead_letter",
            updatedAt: "2026-04-21T00:00:00.000Z",
            target: {
              section: "operations",
              itemId: "operations-job-job-1",
              label: "Inspect dead letter"
            },
            remediation: {
              kind: "replay_job",
              label: "Replay job",
              permission: "editor",
              note: "Replay remains restricted to recovery-capable workspace roles."
            }
          }
        ]
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
      }
    } satisfies NonNullable<DashboardData["operations"]>;

    const html = renderToStaticMarkup(
      <DashboardOperationsTowerCard
        operations={operations}
        expanded
        highlightedItemId={null}
        getItemAnchorId={(itemId) => itemId}
        navigateToSection={() => undefined}
        canReplayDeadLetterJobs={false}
        replayPermissionReason={SHARED_JOB_REPLAY_DENIED_REASON}
      />
    );

    expect(html).toContain("Replay remains restricted to recovery-capable workspace roles.");
    expect(html).toContain(SHARED_JOB_REPLAY_DENIED_REASON);
    expect(html).toContain('disabled=""');
  });
});
