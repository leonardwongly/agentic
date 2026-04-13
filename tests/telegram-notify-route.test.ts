import { vi } from "vitest";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";

const { isTelegramReadyMock, sendTelegramApprovalMessageMock } = vi.hoisted(() => ({
  isTelegramReadyMock: vi.fn(() => true),
  sendTelegramApprovalMessageMock: vi.fn(async () => ({
    ok: true,
    messageId: 42
  }))
}));

vi.mock("@agentic/integrations", () => ({
  isTelegramReady: isTelegramReadyMock,
  sendTelegramApprovalMessage: sendTelegramApprovalMessageMock
}));

vi.mock("../apps/web/lib/server", () => ({
  getSeededRepository: async () => Reflect.get(globalThis, "__agenticRepository")
}));

import { POST as telegramNotifyRoute } from "../apps/web/app/api/telegram/notify/route";

function buildAuthorizedNotifyRequest(body: unknown): Request {
  return new Request("http://localhost/api/telegram/notify", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
    },
    body: JSON.stringify(body)
  });
}

describe("telegram notify route", () => {
  beforeEach(() => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.TELEGRAM_WEBHOOK_SECRET = "telegram-secret";
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
    delete process.env.DATABASE_URL;
    delete process.env.TELEGRAM_DEFAULT_CHAT_ID;
    Reflect.set(globalThis, "__agenticRepository", undefined);
    sendTelegramApprovalMessageMock.mockClear();
    isTelegramReadyMock.mockReturnValue(true);
  });

  afterEach(() => {
    delete process.env.AGENTIC_ACCESS_KEY;
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.DATABASE_URL;
    delete process.env.TELEGRAM_DEFAULT_CHAT_ID;
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  it("sends a Telegram approval message with short callback data", async () => {
    Reflect.set(globalThis, "__agenticRepository", {
      seedDefaults: async () => {},
      listGoals: async () => [
        {
          goal: {
            id: "goal-1",
            userId: "system-user",
            request: "Review my inbox",
            title: "Review inbox",
            explanation: "Review inbox and draft responses.",
            intent: "communications-triage",
            status: "running",
            workspaceId: "workspace-personal-system-user",
            workflowId: "workflow-1",
            confidence: 0.84,
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z"
          },
          workflow: {
            id: "workflow-1",
            goalId: "goal-1",
            workspaceId: "workspace-personal-system-user",
            status: "running",
            currentStep: "Awaiting approval",
            checkpoint: "approval-gate",
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z"
          },
          tasks: [
            {
              id: "task-1",
              goalId: "goal-1",
              workflowId: "workflow-1",
              title: "Draft reply",
              summary: "Prepare an external response.",
              assignedAgent: "communications",
              state: "waiting",
              priority: "P1",
              riskClass: "R3",
              needsApproval: true,
              requiresApproval: true,
              toolCapabilities: ["send"],
              dependsOn: [],
              artifactIds: [],
              createdAt: "2024-01-01T00:00:00.000Z",
              updatedAt: "2024-01-01T00:00:00.000Z"
            }
          ],
          approvals: [
            {
              id: "approval-safe",
              goalId: "goal-1",
              taskId: "task-1",
              title: "Send reply",
              rationale: "External email send.",
              riskClass: "R3",
              decision: "pending",
              requestedAction: "Send the drafted reply",
              preview: {},
              decisionScope: null,
              decisionRationale: null,
              history: [],
              createdAt: "2024-01-01T00:00:00.000Z",
              expiryAt: "2099-01-01T00:00:00.000Z",
              respondedAt: null
            }
          ],
          artifacts: [],
          memories: [],
          watchers: [],
          actionLogs: []
        }
      ]
    });

    const response = await telegramNotifyRoute(
      buildAuthorizedNotifyRequest({
        approvalId: "approval-safe",
        chatId: "-100123456"
      })
    );
    const payload = (await response.json()) as {
      ok: boolean;
      chatId: string;
      messageId: number;
    };

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
      chatId: "-100123456",
      messageId: 42
    });
    expect(sendTelegramApprovalMessageMock).toHaveBeenCalledTimes(1);
    expect(sendTelegramApprovalMessageMock.mock.calls[0]?.[0]).toMatchObject({
      chatId: "-100123456",
      approval: {
        title: "Draft reply",
        rationale: "External email send.",
        riskClass: "R3",
        requestedAction: "Draft reply"
      }
    });
    expect(sendTelegramApprovalMessageMock.mock.calls[0]?.[0].approval.approveActionId.length).toBeLessThanOrEqual(64);
    expect(sendTelegramApprovalMessageMock.mock.calls[0]?.[0].approval.rejectActionId.length).toBeLessThanOrEqual(64);
  });

  it("returns 400 when no chat target is available", async () => {
    Reflect.set(globalThis, "__agenticRepository", {
      seedDefaults: async () => {},
      listGoals: async () => [
        {
          goal: {
            id: "goal-1",
            userId: "system-user",
            request: "Review my inbox",
            title: "Review inbox",
            explanation: "Review inbox and draft responses.",
            intent: "communications-triage",
            status: "running",
            workspaceId: "workspace-personal-system-user",
            workflowId: "workflow-1",
            confidence: 0.84,
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z"
          },
          workflow: {
            id: "workflow-1",
            goalId: "goal-1",
            workspaceId: "workspace-personal-system-user",
            status: "running",
            currentStep: "Awaiting approval",
            checkpoint: "approval-gate",
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z"
          },
          tasks: [],
          approvals: [
            {
              id: "approval-safe",
              goalId: "goal-1",
              taskId: "task-1",
              title: "Send reply",
              rationale: "External email send.",
              riskClass: "R3",
              decision: "pending",
              requestedAction: "Send the drafted reply",
              preview: {},
              decisionScope: null,
              decisionRationale: null,
              history: [],
              createdAt: "2024-01-01T00:00:00.000Z",
              expiryAt: "2099-01-01T00:00:00.000Z",
              respondedAt: null
            }
          ],
          artifacts: [],
          memories: [],
          watchers: [],
          actionLogs: []
        }
      ]
    });

    const response = await telegramNotifyRoute(
      buildAuthorizedNotifyRequest({
        approvalId: "approval-safe"
      })
    );
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain("chatId is required");
    expect(sendTelegramApprovalMessageMock).not.toHaveBeenCalled();
  });
});
