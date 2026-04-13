import { z } from "zod";
import { isTelegramReady, sendTelegramApprovalMessage } from "@agentic/integrations";
import { requireApiSession } from "../../../../lib/auth";
import { ApiRouteError, authenticatedJson, handleApiError, parseJsonBody } from "../../../../lib/api-response";
import { createTelegramApprovalActions } from "../../../../lib/telegram-approvals";
import { getSeededRepository } from "../../../../lib/server";

const DEFAULT_TELEGRAM_CHAT_ID = process.env.TELEGRAM_DEFAULT_CHAT_ID?.trim() || null;

const NotifyBodySchema = z
  .object({
    approvalId: z.string().trim().min(1).max(200),
    chatId: z.string().trim().min(1).max(200).optional()
  })
  .strict();

/**
 * POST /api/telegram/notify
 *
 * Internal API to send a Telegram approval message for a pending approval.
 * Requires session auth.
 */
export async function POST(request: Request) {
  try {
    const principal = await requireApiSession(request);

    if (!isTelegramReady()) {
      throw new ApiRouteError(
        503,
        "Telegram integration is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET."
      );
    }

    const body = await parseJsonBody(request, NotifyBodySchema);
    const repository = await getSeededRepository();
    const goals = await repository.listGoals(principal.userId);
    const bundle = goals.find((candidate) => candidate.approvals.some((approval) => approval.id === body.approvalId));

    if (!bundle) {
      throw new ApiRouteError(404, `Approval ${body.approvalId} was not found.`);
    }

    const approval = bundle.approvals.find((candidate) => candidate.id === body.approvalId);

    if (!approval) {
      throw new ApiRouteError(404, `Approval ${body.approvalId} was not found.`);
    }

    const task = bundle.tasks.find((candidate) => candidate.id === approval.taskId);
    const chatId = body.chatId ?? DEFAULT_TELEGRAM_CHAT_ID;

    if (!chatId) {
      throw new ApiRouteError(400, "chatId is required when TELEGRAM_DEFAULT_CHAT_ID is not configured.");
    }

    const actions = await createTelegramApprovalActions({
      approvalId: approval.id,
      goalId: bundle.goal.id,
      workspaceId: bundle.goal.workspaceId,
      expiresAt: approval.expiryAt
    });

    const result = await sendTelegramApprovalMessage({
      chatId,
      approval: {
        title: task?.title ?? bundle.goal.title ?? "Untitled approval",
        rationale: approval.rationale ?? "No rationale provided.",
        riskClass: task?.riskClass ?? approval.riskClass ?? "R1",
        requestedAction: task?.title ?? approval.requestedAction ?? "Unknown action",
        approveActionId: actions.approveActionId,
        rejectActionId: actions.rejectActionId
      }
    });

    return authenticatedJson({
      ok: result.ok,
      chatId,
      messageId: result.messageId
    });
  } catch (error) {
    return handleApiError(error, "Failed to send Telegram notification.");
  }
}
