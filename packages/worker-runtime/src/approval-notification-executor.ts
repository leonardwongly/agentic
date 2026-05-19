import {
  type ApprovalNotificationJobPayload,
  type JobRecord
} from "@agentic/contracts";
import {
  isSlackReady,
  isTelegramReady,
  sendNotification,
  updateMessage,
  updateTelegramMessage
} from "@agentic/integrations";
import type { AgenticRepository } from "@agentic/repository";

export function isApprovalNotificationJob(
  job: JobRecord | null
): job is JobRecord & { payload: ApprovalNotificationJobPayload } {
  return job?.kind === "approval_notification" && job.payload.type === "approval_notification";
}

export async function executeApprovalNotificationJob(params: {
  repository: AgenticRepository;
  job: JobRecord;
  signal?: AbortSignal;
}) {
  const { job, repository } = params;

  if (!isApprovalNotificationJob(job)) {
    throw new Error(`Expected an approval_notification payload for job ${job.id}.`);
  }

  const bundle = await repository.getGoalBundleForUser(job.payload.goalId, job.userId);

  if (!bundle) {
    throw new Error(`Goal ${job.payload.goalId} was not found.`);
  }

  const approval = bundle.approvals.find((candidate) => candidate.id === job.payload.approvalId);

  if (!approval) {
    throw new Error(`Approval ${job.payload.approvalId} was not found.`);
  }

  if (approval.taskId !== job.payload.taskId) {
    throw new Error(`Approval ${approval.id} no longer matches queued task ${job.payload.taskId}.`);
  }

  if (approval.decision !== job.payload.decision) {
    throw new Error(`Approval ${approval.id} decision changed from ${job.payload.decision} to ${approval.decision}.`);
  }

  const task = bundle.tasks.find((candidate) => candidate.id === approval.taskId);

  if (!task) {
    throw new Error(`Task ${approval.taskId} was not found for approval ${approval.id}.`);
  }

  const statusEmoji = job.payload.decision === "approved" ? "\u2713" : "\u2717";
  const statusLabel = job.payload.decision === "approved" ? "Approved" : "Rejected";
  const receiptLabel = job.payload.decision === "approved" ? "Approved" : "Rejected";

  switch (job.payload.channel) {
    case "slack":
      if (!isSlackReady()) {
        throw new Error("Slack integration is not configured.");
      }

      params.signal?.throwIfAborted();
      await sendNotification({
        channel: process.env.SLACK_DEFAULT_CHANNEL ?? "#approvals",
        text: `${statusEmoji} ${statusLabel}: ${task.title}`,
        signal: params.signal
      });
      return;
    case "slack_receipt":
      if (!isSlackReady()) {
        throw new Error("Slack integration is not configured.");
      }

      params.signal?.throwIfAborted();
      await updateMessage({
        channel: job.payload.slackChannelId,
        ts: job.payload.slackMessageTs,
        text: `${statusEmoji} ${receiptLabel}: ${task.title}`,
        signal: params.signal,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `${statusEmoji} *${receiptLabel}:* ${task.title}`
            }
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `Decision recorded via Slack worker for approval ${approval.id}.`
              }
            ]
          }
        ]
      });
      return;
    case "telegram_receipt":
      if (!isTelegramReady()) {
        throw new Error("Telegram integration is not configured.");
      }

      params.signal?.throwIfAborted();
      await updateTelegramMessage({
        chatId: job.payload.telegramChatId,
        messageId: job.payload.telegramMessageId,
        text: `${job.payload.decision === "approved" ? "\u2705" : "\u274c"} ${receiptLabel}: ${task.title}`,
        signal: params.signal
      });
      return;
  }
}
