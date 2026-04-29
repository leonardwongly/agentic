import { NextResponse } from "next/server";
import { z } from "zod";
import { createHumanActorContext } from "@agentic/contracts";
import {
  answerTelegramCallbackQuery,
  verifyTelegramWebhookSecret
} from "@agentic/integrations";
import { ApprovalMutationError } from "@agentic/repository";
import {
  enqueueApprovalNotificationJob,
  respondToApprovalAndEnqueueFollowUpJob
} from "@agentic/worker-runtime";
import { operationalJson } from "../../../../lib/api-response";
import {
  consumeTelegramApprovalActions,
  getTelegramApprovalAction,
  resolveTelegramActorUserId
} from "../../../../lib/telegram-approvals";
import { getSeededRepository } from "../../../../lib/server";

const TelegramIdentifierSchema = z.union([z.string().trim().min(1), z.number().int()]).transform((value) => String(value).trim());
const SHARED_APPROVAL_OWNER_MESSAGE = "Only the workspace owner can respond to shared approvals.";

const TelegramCallbackQuerySchema = z
  .object({
    id: z.string().trim().min(1),
    data: z.string().trim().min(1).max(64).optional(),
    from: z.object({
      id: TelegramIdentifierSchema
    }),
    message: z
      .object({
        message_id: z.number().int().nonnegative(),
        chat: z.object({
          id: TelegramIdentifierSchema
        })
      })
      .optional()
  })
  .passthrough();

const TelegramUpdateSchema = z
  .object({
    update_id: z.number().int().nonnegative().optional(),
    callback_query: TelegramCallbackQuerySchema.optional()
  })
  .passthrough();

async function acknowledgeTelegramCallback(callbackQueryId: string, text: string, showAlert = false): Promise<void> {
  try {
    await answerTelegramCallbackQuery({
      callbackQueryId,
      text,
      showAlert
    });
  } catch (error) {
    console.error("[telegram-webhook] Failed to answer callback query:", error);
  }
}

/**
 * POST /api/telegram/webhook
 *
 * Receives Telegram callback queries for approval buttons.
 * Authentication is handled via Telegram webhook secret verification instead of session auth.
 */
export async function POST(request: Request) {
  try {
    const webhookSecret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";

    if (!webhookSecret) {
      return operationalJson({ error: "Missing Telegram webhook secret header." }, { status: 401 });
    }

    if (!verifyTelegramWebhookSecret(webhookSecret)) {
      return operationalJson({ error: "Invalid Telegram webhook secret." }, { status: 401 });
    }

    let payload: z.infer<typeof TelegramUpdateSchema>;

    try {
      payload = TelegramUpdateSchema.parse(await request.json());
    } catch {
      return operationalJson({ error: "Invalid Telegram payload." }, { status: 400 });
    }

    const callbackQuery = payload.callback_query;

    if (!callbackQuery?.data) {
      return operationalJson({ ok: true });
    }

    const action = await getTelegramApprovalAction(callbackQuery.data);

    if (!action) {
      await acknowledgeTelegramCallback(callbackQuery.id, "This approval action is invalid or expired.", true);
      return operationalJson({ ok: true, skipped: true, reason: "invalid_action" });
    }

    const actorUserId = resolveTelegramActorUserId({
      telegramUserId: callbackQuery.from.id,
      chatId: callbackQuery.message?.chat.id ?? null
    });

    if (!actorUserId) {
      await acknowledgeTelegramCallback(callbackQuery.id, "You are not authorized for this approval.", true);
      return operationalJson({ ok: true, skipped: true, reason: "unauthorized_actor" });
    }
    const actorContext = createHumanActorContext(actorUserId);

    const repository = await getSeededRepository();
    const actorBundle = await repository.getGoalBundleForUser(action.goalId, actorUserId);

    if (!actorBundle) {
      await acknowledgeTelegramCallback(callbackQuery.id, "This approval is not available to you.", true);
      return operationalJson({ ok: true, skipped: true, reason: "approval_unavailable" });
    }

    const actorApproval = actorBundle.approvals.find((candidate) => candidate.id === action.approvalId);

    if (!actorApproval) {
      await acknowledgeTelegramCallback(callbackQuery.id, "Approval not found for this goal.", true);
      return operationalJson({ ok: true, skipped: true, reason: "approval_not_found" });
    }

    if ((actorBundle.goal.workspaceId ?? null) !== action.workspaceId) {
      await acknowledgeTelegramCallback(callbackQuery.id, "Approval workspace mismatch.", true);
      return operationalJson({ ok: true, skipped: true, reason: "workspace_mismatch" });
    }

    const decisionResult = await (async () => {
      try {
        return await respondToApprovalAndEnqueueFollowUpJob({
          repository,
          userId: actorUserId,
          approvalId: action.approvalId,
          decision: action.decision,
          actorContext,
          scope: "once",
          rationale: null
        });
      } catch (error) {
        if (error instanceof ApprovalMutationError) {
          if (error.code === "not_found") {
            await acknowledgeTelegramCallback(callbackQuery.id, error.message, true);
            return operationalJson({ ok: true, skipped: true, reason: "approval_not_found" });
          }

          if (error.code === "forbidden") {
            await acknowledgeTelegramCallback(callbackQuery.id, SHARED_APPROVAL_OWNER_MESSAGE, true);
            return operationalJson({ ok: true, skipped: true, reason: "forbidden" });
          }

          await acknowledgeTelegramCallback(callbackQuery.id, "This approval was already handled.");
          return operationalJson({ ok: true, skipped: true, reason: error.code });
        }

        throw error;
      }
    })();

    if (decisionResult instanceof NextResponse) {
      await consumeTelegramApprovalActions(action.approvalId);
      return decisionResult;
    }

    const updatedBundle = decisionResult.bundle;

    const approval = updatedBundle.approvals.find((candidate) => candidate.id === action.approvalId);

    if (!approval) {
      throw new Error(`Approval ${action.approvalId} is missing after Telegram response mutation.`);
    }

    await consumeTelegramApprovalActions(action.approvalId);

    if (callbackQuery.message?.chat.id) {
      await enqueueApprovalNotificationJob({
        repository,
        userId: actorUserId,
        approvalId: approval.id,
        goalId: updatedBundle.goal.id,
        taskId: approval.taskId,
        decision: action.decision,
        channel: "telegram_receipt",
        telegramChatId: callbackQuery.message.chat.id,
        telegramMessageId: callbackQuery.message.message_id,
        workspaceId: updatedBundle.goal.workspaceId,
        actorContext
      });
    }

    await acknowledgeTelegramCallback(
      callbackQuery.id,
      action.decision === "approved" ? "Approval recorded." : "Rejection recorded."
    );

    return operationalJson({ ok: true });
  } catch (error) {
    console.error("[telegram-webhook] Unhandled error:", error);
    return operationalJson({ error: "Internal server error." }, { status: 500 });
  }
}
