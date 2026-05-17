import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  SYSTEM_USER_ID,
  createHumanActorContext,
  createSystemActorContext,
  type GoalBundle,
  type JobRecord
} from "@agentic/contracts";
import { createJobRecord } from "@agentic/execution";
import { buildDefaultIntegrationAccounts } from "@agentic/integrations";
import { createMemoryRecord } from "@agentic/memory";
import { evaluateExecutionGradeVerticalWorkflow } from "@agentic/observability";
import { processUserRequest, respondToApproval } from "@agentic/orchestrator";
import { createRepository } from "@agentic/repository";
import { enqueueApprovalFollowUpJob } from "@agentic/worker-runtime";

function buildContext() {
  return {
    userId: SYSTEM_USER_ID,
    memories: [
      createMemoryRecord({
        userId: SYSTEM_USER_ID,
        category: "style",
        memoryType: "confirmed",
        content: "Use concise approval summaries.",
        confidence: 0.95,
        source: "test"
      })
    ],
    integrations: buildDefaultIntegrationAccounts(SYSTEM_USER_ID)
  };
}

async function createRepositoryFixture() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-execution-grade-wedge-"));
  const repository = createRepository({
    storePath: path.join(tempDir, "store.json")
  });
  await repository.seedDefaults(SYSTEM_USER_ID);
  return repository;
}

async function createApprovedCommunicationsWedge() {
  const bundle = await processUserRequest({
    ...buildContext(),
    request:
      'Triage my inbox and send a client follow-up. To: client@example.com Subject: Follow-up Body: "Approved response body." Mode: send Thread-ID: thread-123'
  });
  const approval = bundle.approvals.find((candidate) => candidate.actionIntent?.type === "send_message");

  if (!approval) {
    throw new Error("Expected the communications wedge fixture to create a typed send_message approval.");
  }

  const approvedBundle = respondToApproval({
    bundle,
    approvalId: approval.id,
    decision: "approved",
    actor: createHumanActorContext(SYSTEM_USER_ID),
    scope: "once",
    rationale: "Approved for this explicit client follow-up."
  });
  const approvedApproval = approvedBundle.approvals.find((candidate) => candidate.id === approval.id);

  if (!approvedApproval) {
    throw new Error("Expected approved communications approval to remain in the bundle.");
  }

  const repository = await createRepositoryFixture();
  await repository.saveGoalBundle(approvedBundle);
  const job = await enqueueApprovalFollowUpJob({
    repository,
    userId: SYSTEM_USER_ID,
    approvalId: approvedApproval.id,
    goalId: approvedBundle.goal.id,
    taskId: approvedApproval.taskId,
    decision: "approved",
    workspaceId: approvedBundle.goal.workspaceId,
    actorContext: createSystemActorContext(SYSTEM_USER_ID),
    actionIntent: approvedApproval.actionIntent
  });

  return {
    bundle,
    approvedBundle,
    approvedApproval,
    job
  };
}

function buildPrematureApprovalFollowUpJob(bundle: GoalBundle): JobRecord {
  const approval = bundle.approvals[0];

  if (!approval) {
    throw new Error("Expected fixture bundle to contain an approval.");
  }

  return createJobRecord({
    userId: SYSTEM_USER_ID,
    kind: "approval_follow_up",
    payload: {
      type: "approval_follow_up",
      approvalId: approval.id,
      goalId: bundle.goal.id,
      taskId: approval.taskId,
      decision: "approved",
      workspaceId: bundle.goal.workspaceId,
      metadata: {
        replayedFromJobId: null,
        actionId: "approval-action:premature"
      }
    },
    actorContext: createSystemActorContext(SYSTEM_USER_ID),
    idempotencyKey: `approval-follow-up:${approval.id}:approval-action:premature:approved`
  });
}

describe("execution-grade vertical wedge evaluation", () => {
  it("passes when a selected wedge has governed specialist output, blast-radius previews, and an idempotent follow-up job", async () => {
    const { approvedBundle, job } = await createApprovedCommunicationsWedge();

    const evaluation = evaluateExecutionGradeVerticalWorkflow({
      bundle: approvedBundle,
      jobs: [job]
    });

    expect(evaluation).toMatchObject({
      passed: true,
      wedgeKey: "communications_execution"
    });
    expect(evaluation.gates.every((gate) => gate.passed)).toBe(true);
    expect(evaluation.gates.find((gate) => gate.key === "worker_job_idempotency")?.evidence).toMatchObject({
      respondedApprovalCount: 1,
      respondedApprovalsWithIdempotentJobs: 1
    });
  });

  it("fails closed when approval previews omit blast-radius evidence", async () => {
    const { approvedBundle, approvedApproval, job } = await createApprovedCommunicationsWedge();
    const bundleMissingBlastRadius = {
      ...approvedBundle,
      approvals: approvedBundle.approvals.map((approval) =>
        approval.id === approvedApproval.id
          ? {
              ...approval,
              preview: {
                ...approval.preview,
                impact: {
                  ...approval.preview.impact,
                  affectedSystems: []
                }
              }
            }
          : approval
      )
    };

    const evaluation = evaluateExecutionGradeVerticalWorkflow({
      bundle: bundleMissingBlastRadius,
      jobs: [job]
    });

    expect(evaluation.passed).toBe(false);
    expect(evaluation.gates.find((gate) => gate.key === "approval_preview_blast_radius")).toMatchObject({
      passed: false
    });
  });

  it("flags worker jobs queued before an operator approval decision", async () => {
    const { bundle } = await createApprovedCommunicationsWedge();
    const prematureJob = buildPrematureApprovalFollowUpJob(bundle);

    const evaluation = evaluateExecutionGradeVerticalWorkflow({
      bundle,
      jobs: [prematureJob]
    });

    expect(evaluation.passed).toBe(false);
    expect(evaluation.gates.find((gate) => gate.key === "no_side_effect_before_approval")).toMatchObject({
      passed: false,
      evidence: {
        pendingApprovalsWithFollowUpJobs: [bundle.approvals[0]?.id]
      }
    });
  });

  it("rejects approval follow-up evidence without stable idempotency and action ids", async () => {
    const { approvedBundle, approvedApproval } = await createApprovedCommunicationsWedge();
    const jobWithoutIdempotency = createJobRecord({
      userId: SYSTEM_USER_ID,
      kind: "approval_follow_up",
      payload: {
        type: "approval_follow_up",
        approvalId: approvedApproval.id,
        goalId: approvedBundle.goal.id,
        taskId: approvedApproval.taskId,
        decision: "approved",
        workspaceId: approvedBundle.goal.workspaceId,
        metadata: {
          replayedFromJobId: null,
          actionId: null
        }
      },
      actorContext: createSystemActorContext(SYSTEM_USER_ID),
      idempotencyKey: null
    });

    const evaluation = evaluateExecutionGradeVerticalWorkflow({
      bundle: approvedBundle,
      jobs: [jobWithoutIdempotency]
    });

    expect(evaluation.passed).toBe(false);
    expect(evaluation.gates.find((gate) => gate.key === "worker_job_idempotency")).toMatchObject({
      passed: false,
      evidence: {
        respondedApprovalCount: 1,
        respondedApprovalsWithIdempotentJobs: 0
      }
    });
  });
});
