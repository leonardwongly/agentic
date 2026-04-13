import {
  consumeTelegramApprovalActions,
  createTelegramApprovalActions,
  getTelegramApprovalAction,
  resetTelegramApprovalActionStoreForTests,
  resolveTelegramActorUserId
} from "../apps/web/lib/telegram-approvals";

describe("telegram approvals", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.TELEGRAM_USER_MAP;
    resetTelegramApprovalActionStoreForTests();
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.TELEGRAM_USER_MAP;
    resetTelegramApprovalActionStoreForTests();
  });

  it("creates short callback-safe approval actions and consumes both decisions together", async () => {
    const actions = await createTelegramApprovalActions({
      approvalId: "approval-1",
      goalId: "goal-1",
      workspaceId: "workspace-1",
      expiresAt: "2099-01-01T00:00:00.000Z"
    });

    expect(actions.approveActionId.length).toBeLessThanOrEqual(64);
    expect(actions.rejectActionId.length).toBeLessThanOrEqual(64);

    const approve = await getTelegramApprovalAction(actions.approveActionId);
    const reject = await getTelegramApprovalAction(actions.rejectActionId);

    expect(approve?.decision).toBe("approved");
    expect(reject?.decision).toBe("rejected");

    await consumeTelegramApprovalActions("approval-1");

    await expect(getTelegramApprovalAction(actions.approveActionId)).resolves.toBeNull();
    await expect(getTelegramApprovalAction(actions.rejectActionId)).resolves.toBeNull();
  });

  it("rejects expired approval actions", async () => {
    const actions = await createTelegramApprovalActions({
      approvalId: "approval-expired",
      goalId: "goal-expired",
      workspaceId: "workspace-1",
      expiresAt: "2000-01-01T00:00:00.000Z"
    });

    await expect(getTelegramApprovalAction(actions.approveActionId)).resolves.toBeNull();
  });

  it("resolves chat-scoped Telegram actor mappings before falling back to user-wide mappings", () => {
    process.env.TELEGRAM_USER_MAP = "123:user-fallback,-1001/123:user-scoped";

    expect(resolveTelegramActorUserId({ telegramUserId: "123", chatId: "-1001" })).toBe("user-scoped");
    expect(resolveTelegramActorUserId({ telegramUserId: "123", chatId: "-1002" })).toBe("user-fallback");
    expect(resolveTelegramActorUserId({ telegramUserId: "999", chatId: "-1001" })).toBeNull();
  });
});
