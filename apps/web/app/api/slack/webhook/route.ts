import { NextResponse } from "next/server";
import { SYSTEM_USER_ID } from "@agentic/contracts";
import { respondToApproval, executeApprovedTasks, captureMemoriesFromBundle } from "@agentic/orchestrator";
import {
  verifySlackSignature,
  updateMessage,
  isGmailReady,
  isCalendarReady,
  createDraft,
  sendDraft,
  listRecentEmails,
  createEvent,
  updateEvent,
  listUpcomingEvents,
  createLocalNote
} from "@agentic/integrations";
import { getSeededRepository, getSeededSelfImprovementRepository } from "../../../../lib/server";

/**
 * POST /api/slack/webhook
 *
 * Receives Slack interactive payloads (button clicks for approve / reject).
 * Authentication is handled via Slack signature verification instead of session auth.
 */
export async function POST(request: Request) {
  try {
    // Read the raw body for signature verification
    const rawBody = await request.text();

    const slackSignature = request.headers.get("x-slack-signature") ?? "";
    const slackTimestamp = request.headers.get("x-slack-request-timestamp") ?? "";

    if (!slackSignature || !slackTimestamp) {
      return NextResponse.json({ error: "Missing Slack signature headers." }, { status: 401 });
    }

    // Reject requests older than 5 minutes to prevent replay attacks
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - Number(slackTimestamp)) > 300) {
      return NextResponse.json({ error: "Request timestamp too old." }, { status: 401 });
    }

    if (!verifySlackSignature({ signature: slackSignature, timestamp: slackTimestamp, body: rawBody })) {
      return NextResponse.json({ error: "Invalid Slack signature." }, { status: 401 });
    }

    // Slack sends interactive payloads as application/x-www-form-urlencoded with a "payload" field
    const params = new URLSearchParams(rawBody);
    const payloadStr = params.get("payload");

    if (!payloadStr) {
      return NextResponse.json({ error: "Missing payload." }, { status: 400 });
    }

    const payload = JSON.parse(payloadStr) as {
      type: string;
      actions?: Array<{
        action_id: string;
        value: string;
      }>;
      channel?: { id: string };
      message?: { ts: string };
    };

    if (payload.type !== "block_actions" || !payload.actions?.length) {
      // Acknowledge unknown interaction types gracefully
      return NextResponse.json({ ok: true });
    }

    const action = payload.actions[0];
    const approvalId = action.value;
    const actionId = action.action_id;

    let decision: "approved" | "rejected";
    if (actionId === "approval_approve") {
      decision = "approved";
    } else if (actionId === "approval_reject") {
      decision = "rejected";
    } else {
      return NextResponse.json({ ok: true });
    }

    // Look up the approval bundle
    const repository = await getSeededRepository();
    const goals = await repository.listGoals(SYSTEM_USER_ID);
    const bundle = goals.find((candidate) =>
      candidate.approvals.some((approval) => approval.id === approvalId)
    );

    if (!bundle) {
      return NextResponse.json({ error: `Approval ${approvalId} not found.` }, { status: 404 });
    }

    const updatedBundle = respondToApproval({ bundle, approvalId, decision });

    // Execute approved tasks via integration adapters
    if (decision === "approved") {
      const approval = updatedBundle.approvals.find((a) => a.id === approvalId);
      if (approval) {
        try {
          const adapters = {
            gmail: isGmailReady() ? { createDraft, sendDraft, listRecentEmails } : undefined,
            calendar: isCalendarReady() ? { createEvent, updateEvent, listUpcomingEvents } : undefined,
            notes: { createLocalNote }
          };
          const { results, logs } = await executeApprovedTasks({
            bundle: updatedBundle,
            approvedTaskIds: [approval.taskId],
            adapters
          });
          updatedBundle.actionLogs.push(...logs);
          console.log(
            `[slack-webhook][execution] Executed ${results.length} task(s):`,
            results.map((r) => `${r.action}: ${r.success ? "OK" : "FAILED"}`).join(", ")
          );
        } catch (execError) {
          console.error("[slack-webhook][execution] Failed to execute approved task:", execError);
        }
      }
    }

    await repository.saveGoalBundle(updatedBundle);

    // Capture memories when goal completes
    if (updatedBundle.goal.status === "completed") {
      try {
        const captured = captureMemoriesFromBundle(updatedBundle, SYSTEM_USER_ID);
        const selfImprovement = await getSeededSelfImprovementRepository();

        await Promise.all([
          ...captured.memories.map((memory) => repository.saveMemory(memory)),
          ...captured.episodes.map((episode) => selfImprovement.appendEpisode(episode))
        ]);

        console.log(
          `[slack-webhook][auto-capture] Goal "${updatedBundle.goal.id}" completed — persisted ${captured.memories.length} memory record(s) and ${captured.episodes.length} episode(s).`
        );
      } catch (captureError) {
        console.error("[slack-webhook][auto-capture] Failed to persist captured memories:", captureError);
      }
    }

    // Update the Slack message to reflect the decision
    const channel = payload.channel?.id;
    const messageTs = payload.message?.ts;

    if (channel && messageTs) {
      const statusEmoji = decision === "approved" ? "\u2713" : "\u2717";
      const statusLabel = decision === "approved" ? "Approved" : "Rejected";
      const taskTitle =
        updatedBundle.tasks.find((t) => t.id === updatedBundle.approvals.find((a) => a.id === approvalId)?.taskId)
          ?.title ?? "Unknown task";

      try {
        await updateMessage({
          channel,
          ts: messageTs,
          text: `${statusEmoji} ${statusLabel}: ${taskTitle}`,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `${statusEmoji} *${statusLabel}:* ${taskTitle}`
              }
            },
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `Decision recorded via Slack at <!date^${Math.floor(Date.now() / 1000)}^{date_short_pretty} {time}|${new Date().toISOString()}>`
                }
              ]
            }
          ]
        });
      } catch (updateError) {
        console.error("[slack-webhook] Failed to update Slack message:", updateError);
      }
    }

    // Return 200 to Slack so it stops retrying
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[slack-webhook] Unhandled error:", error);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
