import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID, type ApprovalRequest, type AgentDefinition, type Task } from "@agentic/contracts";
import { processUserRequest } from "@agentic/orchestrator";
import { createRepository } from "@agentic/repository";
import { deriveAgentMetricsFromGoals } from "../packages/repository/src/agent-metrics";

describe("deriveAgentMetricsFromGoals", () => {
  async function createGoalForUser(
    repository: ReturnType<typeof createRepository>,
    userId: string,
    request: string
  ) {
    const bundle = await processUserRequest({
      userId,
      request,
      memories: await repository.listMemory(userId),
      integrations: await repository.listIntegrations(userId)
    });

    return bundle;
  }

  async function createIsolatedRepository() {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-agent-metrics-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({ storePath });

    await repository.seedDefaults(SYSTEM_USER_ID);
    return repository;
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

  it("uses calendar day boundaries instead of a rolling 24-hour window", async () => {
    const repository = await createIsolatedRepository();
    const agent = await loadCommunicationsAgent(repository);
    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Review my inbox and send one external reply.");
    const templateTask = bundle.tasks[0];

    expect(templateTask).toBeDefined();

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const metrics = deriveAgentMetricsFromGoals({
      agent,
      period: "day",
      goals: [
        {
          ...bundle,
          tasks: [
            buildTask(templateTask!, {
              id: `${templateTask!.id}-before-day-boundary`,
              assignedAgent: agent.id,
              state: "completed",
              createdAt: new Date(startOfToday.getTime() - 60_000).toISOString(),
              updatedAt: new Date(startOfToday.getTime() - 30_000).toISOString()
            }),
            buildTask(templateTask!, {
              id: `${templateTask!.id}-within-day-boundary`,
              assignedAgent: agent.id,
              state: "completed",
              createdAt: new Date(startOfToday.getTime() + 60_000).toISOString(),
              updatedAt: new Date(startOfToday.getTime() + 120_000).toISOString()
            })
          ],
          approvals: [],
          artifacts: [],
          actionLogs: []
        }
      ],
      evidenceRecords: []
    });

    expect(metrics.tasksTotal).toBe(1);
    expect(metrics.tasksCompleted).toBe(1);
    expect(metrics.successRate).toBe(1);
  });

  it("counts user corrections and post-approval failures from approval evidence", async () => {
    const repository = await createIsolatedRepository();
    const agent = await loadCommunicationsAgent(repository);
    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Review my inbox and send one external reply.");
    const templateTask = bundle.tasks[0];
    const templateApproval = bundle.approvals[0];
    const createdAt = new Date().toISOString();
    const updatedAt = new Date(Date.now() + 120_000).toISOString();

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

    const metrics = deriveAgentMetricsFromGoals({
      agent,
      period: "all",
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
          id: "evidence-rejected",
          userId: SYSTEM_USER_ID,
          goalId: bundle.goal.id,
          taskId: failedTask.id,
          approvalId: approvedRequest.id,
          sourceKind: "approval_response",
          sourceId: approvedRequest.id,
          sourceSummary: "User rejected the proposed outbound reply.",
          riskClass: approvedRequest.riskClass,
          requestedAction: approvedRequest.requestedAction,
          requestRationale: approvedRequest.rationale,
          requiresApproval: true,
          decision: "rejected",
          decisionScope: "once",
          decisionRationale: "This specific reply needs manual revision.",
          respondedAt: updatedAt,
          resultingTaskState: "blocked",
          resultingGoalStatus: bundle.goal.status,
          actionLogIds: [],
          artifactIds: [],
          memoryIds: [],
          createdAt,
          updatedAt
        },
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
        }
      ]
    });

    expect(metrics.feedbackCount).toBe(2);
    expect(metrics.userCorrectionCount).toBe(1);
    expect(metrics.postApprovalFailureCount).toBe(1);
    expect(metrics.correctionRate).toBeCloseTo(0.5);
    expect(metrics.postApprovalFailureRate).toBe(1);
  });
});
