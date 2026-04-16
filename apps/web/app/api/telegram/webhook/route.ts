import { NextResponse } from "next/server";
import { z } from "zod";
import { createHumanActorContext } from "@agentic/contracts";
import { captureExecutionOutcomeSignals, captureMemoriesFromBundle, executeApprovedTasks, reconcileExecutionResults, type ExecutionResult } from "@agentic/orchestrator";
import {
  answerTelegramCallbackQuery,
  createLocalNote,
  updateTelegramMessage,
  verifyTelegramWebhookSecret
} from "@agentic/integrations";
import { ApprovalMutationError } from "@agentic/repository";
import { resolveGoogleWorkspaceAdapters } from "../../../../lib/google-provider-adapters";
import { persistCapturedMemories } from "../../../../lib/persist-captured-memories";
import {
  consumeTelegramApprovalActions,
  getTelegramApprovalAction,
  resolveTelegramActorUserId
} from "../../../../lib/telegram-approvals";
import { getSeededRepository } from "../../../../lib/server";

const TelegramIdentifierSchema = z.union([z.string().trim().min(1), z.number().int()]).transform((value) => String(value).trim());

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
      return NextResponse.json({ error: "Missing Telegram webhook secret header." }, { status: 401 });
    }

    if (!verifyTelegramWebhookSecret(webhookSecret)) {
      return NextResponse.json({ error: "Invalid Telegram webhook secret." }, { status: 401 });
    }

    let payload: z.infer<typeof TelegramUpdateSchema>;

    try {
      payload = TelegramUpdateSchema.parse(await request.json());
    } catch {
      return NextResponse.json({ error: "Invalid Telegram payload." }, { status: 400 });
    }

    const callbackQuery = payload.callback_query;

    if (!callbackQuery?.data) {
      return NextResponse.json({ ok: true });
    }

    const action = await getTelegramApprovalAction(callbackQuery.data);

    if (!action) {
      await acknowledgeTelegramCallback(callbackQuery.id, "This approval action is invalid or expired.", true);
      return NextResponse.json({ ok: true, skipped: true, reason: "invalid_action" });
    }

    const actorUserId = resolveTelegramActorUserId({
      telegramUserId: callbackQuery.from.id,
      chatId: callbackQuery.message?.chat.id ?? null
    });

    if (!actorUserId) {
      await acknowledgeTelegramCallback(callbackQuery.id, "You are not authorized for this approval.", true);
      return NextResponse.json({ ok: true, skipped: true, reason: "unauthorized_actor" });
    }
    const actorContext = createHumanActorContext(actorUserId);

    const repository = await getSeededRepository();
    const actorBundle = await repository.getGoalBundleForUser(action.goalId, actorUserId);

    if (!actorBundle) {
      await acknowledgeTelegramCallback(callbackQuery.id, "This approval is not available to you.", true);
      return NextResponse.json({ ok: true, skipped: true, reason: "approval_unavailable" });
    }

    const actorApproval = actorBundle.approvals.find((candidate) => candidate.id === action.approvalId);

    if (!actorApproval) {
      await acknowledgeTelegramCallback(callbackQuery.id, "Approval not found for this goal.", true);
      return NextResponse.json({ ok: true, skipped: true, reason: "approval_not_found" });
    }

    if ((actorBundle.goal.workspaceId ?? null) !== action.workspaceId) {
      await acknowledgeTelegramCallback(callbackQuery.id, "Approval workspace mismatch.", true);
      return NextResponse.json({ ok: true, skipped: true, reason: "workspace_mismatch" });
    }

    let updatedBundle = await (async () => {
      try {
        return await repository.respondToApproval({
          approvalId: action.approvalId,
          decision: action.decision,
          actor: actorContext,
          scope: "once",
          rationale: null
        });
      } catch (error) {
        if (error instanceof ApprovalMutationError) {
          if (error.code === "not_found") {
            await acknowledgeTelegramCallback(callbackQuery.id, error.message, true);
            return NextResponse.json({ ok: true, skipped: true, reason: "approval_not_found" });
          }

          await acknowledgeTelegramCallback(callbackQuery.id, "This approval was already handled.");
          return NextResponse.json({ ok: true, skipped: true, reason: error.code });
        }

        throw error;
      }
    })();

    if (updatedBundle instanceof NextResponse) {
      await consumeTelegramApprovalActions(action.approvalId);
      return updatedBundle;
    }

    let executionResults: ExecutionResult[] = [];

    if (action.decision === "approved") {
      const approval = updatedBundle.approvals.find((candidate) => candidate.id === action.approvalId);

      if (approval) {
        try {
          const googleAdapters = await resolveGoogleWorkspaceAdapters({
            repository,
            userId: actorUserId,
            workspaceId: updatedBundle.goal.workspaceId
          });
          const adapters = {
            gmail: googleAdapters?.gmail,
            calendar: googleAdapters?.calendar,
            notes: { createLocalNote }
          };
          const governance = updatedBundle.goal.workspaceId
            ? await repository.getWorkspaceGovernance(updatedBundle.goal.workspaceId, actorUserId)
            : null;
          const { results, logs } = await executeApprovedTasks({
            bundle: updatedBundle,
            approvedTaskIds: [approval.taskId],
            adapters,
            governance
          });
          executionResults = results;
          updatedBundle = reconcileExecutionResults({
            bundle: updatedBundle,
            results,
            logs
          });
        } catch (error) {
          console.error("[telegram-webhook][execution] Failed to execute approved task:", error);
        }
      }
    }

    await repository.saveGoalBundle(updatedBundle);
    await consumeTelegramApprovalActions(action.approvalId);

    if (executionResults.length > 0) {
      try {
        await persistCapturedMemories({
          repository,
          captured: captureExecutionOutcomeSignals(updatedBundle, actorUserId, executionResults, actorContext),
          goalId: updatedBundle.goal.id,
          label: "telegram-execution-capture",
          actorContext
        });
      } catch (error) {
        console.error("[telegram-webhook][execution-capture] Failed to persist execution outcome signals:", error);
      }
    }

    if (updatedBundle.goal.status === "completed") {
      try {
        await persistCapturedMemories({
          repository,
          captured: captureMemoriesFromBundle(updatedBundle, actorUserId, actorContext),
          goalId: updatedBundle.goal.id,
          label: "telegram-auto-capture",
          actorContext
        });
      } catch (error) {
        console.error("[telegram-webhook][auto-capture] Failed to persist captured memories:", error);
      }
    }

    if (callbackQuery.message?.chat.id) {
      const taskTitle =
        updatedBundle.tasks.find((task) => task.id === updatedBundle.approvals.find((approval) => approval.id === action.approvalId)?.taskId)
          ?.title ?? "Unknown task";
      const statusLabel = action.decision === "approved" ? "Approved" : "Rejected";
      const statusEmoji = action.decision === "approved" ? "\u2705" : "\u274c";

      try {
        await updateTelegramMessage({
          chatId: callbackQuery.message.chat.id,
          messageId: callbackQuery.message.message_id,
          text: `${statusEmoji} ${statusLabel}: ${taskTitle}`
        });
      } catch (error) {
        console.error("[telegram-webhook] Failed to update Telegram message:", error);
      }
    }

    await acknowledgeTelegramCallback(
      callbackQuery.id,
      action.decision === "approved" ? "Approval recorded." : "Rejection recorded."
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[telegram-webhook] Unhandled error:", error);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
