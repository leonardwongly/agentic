import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID, type ApprovalRequest, type AgentDefinition, type Task } from "@agentic/contracts";
import { processUserRequest } from "@agentic/orchestrator";
import { createRepository } from "@agentic/repository";
import { deriveCalibrationInsights } from "../packages/repository/src/calibration-insights";

describe("deriveCalibrationInsights", () => {
  async function createIsolatedRepository() {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-calibration-insights-"));
    const repository = createRepository({ storePath: path.join(tempDir, "runtime-store.json") });

    await repository.seedDefaults(SYSTEM_USER_ID);
    return repository;
  }

  async function createGoalForUser(
    repository: ReturnType<typeof createRepository>,
    userId: string,
    request: string
  ) {
    return processUserRequest({
      userId,
      request,
      memories: await repository.listMemory(userId),
      integrations: await repository.listIntegrations(userId)
    });
  }

  async function loadCommunicationsAgent(repository: ReturnType<typeof createRepository>): Promise<AgentDefinition> {
    const agent = (await repository.listAgents(SYSTEM_USER_ID)).find((candidate) => candidate.name === "communications");

    expect(agent).toBeDefined();
    return agent!;
  }

  function buildTask(task: Task, overrides: Partial<Task>): Task {
    return {
      ...task,
      ...overrides
    };
  }

  function buildApproval(approval: ApprovalRequest, overrides: Partial<ApprovalRequest>): ApprovalRequest {
    return {
      ...approval,
      ...overrides
    };
  }

  it("flags post-approval failures and corrections as review-worthy calibration evidence", async () => {
    const repository = await createIsolatedRepository();
    const agent = await loadCommunicationsAgent(repository);
    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Review my inbox and send one external reply.");
    const templateTask = bundle.tasks[0];
    const templateApproval = bundle.approvals[0];
    const createdAt = new Date().toISOString();
    const updatedAt = new Date(Date.now() + 60_000).toISOString();

    expect(templateTask).toBeDefined();
    expect(templateApproval).toBeDefined();

    const failedTask = buildTask(templateTask!, {
      assignedAgent: agent.id,
      state: "failed",
      createdAt,
      updatedAt
    });
    const approvedRequest = buildApproval(templateApproval!, {
      taskId: failedTask.id,
      decision: "approved",
      createdAt,
      respondedAt: updatedAt
    });
    const calibration = deriveCalibrationInsights({
      agents: [agent],
      goals: [
        {
          ...bundle,
          tasks: [failedTask],
          approvals: [approvedRequest],
          artifacts: [],
          actionLogs: []
        }
      ],
      evidenceRecords: [
        {
          id: "evidence-approved-failure",
          userId: SYSTEM_USER_ID,
          goalId: bundle.goal.id,
          taskId: failedTask.id,
          approvalId: approvedRequest.id,
          sourceKind: "approval_response",
          sourceId: approvedRequest.id,
          sourceSummary: "Approved execution later failed.",
          riskClass: approvedRequest.riskClass,
          requestedAction: approvedRequest.requestedAction,
          requestRationale: approvedRequest.rationale,
          requiresApproval: true,
          decision: "approved",
          decisionScope: "similar_24h",
          decisionRationale: "Safe to attempt for similar replies today.",
          respondedAt: updatedAt,
          resultingTaskState: "failed",
          resultingGoalStatus: bundle.goal.status,
          actionLogIds: [],
          artifactIds: [],
          memoryIds: [],
          createdAt,
          updatedAt
        },
        {
          id: "evidence-rejected",
          userId: SYSTEM_USER_ID,
          goalId: bundle.goal.id,
          taskId: failedTask.id,
          approvalId: approvedRequest.id,
          sourceKind: "approval_response",
          sourceId: approvedRequest.id,
          sourceSummary: "User rejected a later draft.",
          riskClass: approvedRequest.riskClass,
          requestedAction: approvedRequest.requestedAction,
          requestRationale: approvedRequest.rationale,
          requiresApproval: true,
          decision: "rejected",
          decisionScope: "once",
          decisionRationale: "Tone was wrong.",
          respondedAt: updatedAt,
          resultingTaskState: "blocked",
          resultingGoalStatus: bundle.goal.status,
          actionLogIds: [],
          artifactIds: [],
          memoryIds: [],
          createdAt,
          updatedAt
        }
      ],
      options: {
        period: "all",
        limit: 3
      }
    });

    expect(calibration.totalAgents).toBe(1);
    expect(calibration.agentsWithActivity).toBe(1);
    expect(calibration.postureCounts["needs-review"]).toBe(1);
    expect(calibration.events.length).toBeGreaterThanOrEqual(2);
    expect(calibration.insights[0]?.posture).toBe("needs-review");
    expect(calibration.insights[0]?.metrics.postApprovalFailureCount).toBe(1);
    expect(calibration.insights[0]?.metrics.userCorrectionCount).toBe(1);
    expect(calibration.insights[0]?.events.some((event) => event.kind === "post_approval_failure")).toBe(true);
  });

  it("does not promote agents without activity evidence", async () => {
    const repository = await createIsolatedRepository();
    const agent = await loadCommunicationsAgent(repository);
    const calibration = deriveCalibrationInsights({
      agents: [agent],
      goals: [],
      evidenceRecords: []
    });

    expect(calibration.agentsWithActivity).toBe(0);
    expect(calibration.postureCounts["insufficient-data"]).toBe(1);
    expect(calibration.insights[0]?.posture).toBe("insufficient-data");
    expect(calibration.insights[0]?.confidence).toBe(0);
  });
});
