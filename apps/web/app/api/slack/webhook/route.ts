import { NextResponse } from "next/server";
import { createHumanActorContext } from "@agentic/contracts";
import { captureExecutionOutcomeSignals, executeApprovedTasks, captureMemoriesFromBundle, reconcileExecutionResults, type ExecutionResult } from "@agentic/orchestrator";
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
import { ApprovalMutationError } from "@agentic/repository";
import { persistCapturedMemories } from "../../../../lib/persist-captured-memories";
import { resolveSlackActorUserId, verifySlackApprovalToken } from "../../../../lib/slack-approvals";
import { getSeededRepository } from "../../../../lib/server";

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
      user?: { id?: string };
      channel?: { id: string };
      message?: { ts: string };
    };

    if (payload.type !== "block_actions" || !payload.actions?.length) {
      // Acknowledge unknown interaction types gracefully
      return NextResponse.json({ ok: true });
    }

    const action = payload.actions[0];
    const approvalToken = verifySlackApprovalToken(action.value);
    if (!approvalToken) {
      return NextResponse.json({ error: "Invalid or expired approval action." }, { status: 401 });
    }

    const slackUserId = payload.user?.id?.trim() ?? "";
    const actorUserId = slackUserId ? resolveSlackActorUserId(slackUserId) : null;
    if (!actorUserId) {
      return NextResponse.json({ error: "Slack actor is not authorized for approvals." }, { status: 403 });
    }
    const actorContext = createHumanActorContext(actorUserId);

    const approvalId = approvalToken.approvalId;
    const actionId = action.action_id;

    let decision: "approved" | "rejected";
    if (actionId === "approval_approve") {
      decision = "approved";
    } else if (actionId === "approval_reject") {
      decision = "rejected";
    } else {
      return NextResponse.json({ ok: true });
    }

    const repository = await getSeededRepository();
    const actorBundle = await repository.getGoalBundleForUser(approvalToken.goalId, actorUserId);
    if (!actorBundle) {
      return NextResponse.json({ error: "Approval is not available to this actor." }, { status: 403 });
    }

    const actorApproval = actorBundle.approvals.find((candidate) => candidate.id === approvalId);
    if (!actorApproval) {
      return NextResponse.json({ error: "Approval not found for this goal." }, { status: 404 });
    }

    if ((actorBundle.goal.workspaceId ?? null) !== approvalToken.workspaceId) {
      return NextResponse.json({ error: "Approval workspace mismatch." }, { status: 403 });
    }

    let updatedBundle = await (async () => {
      try {
        return await repository.respondToApproval({
          approvalId,
          decision,
          actor: actorContext,
          scope: "once",
          rationale: null
        });
      } catch (error) {
        if (error instanceof ApprovalMutationError) {
          if (error.code === "not_found") {
            return NextResponse.json({ error: error.message }, { status: 404 });
          }

          // Acknowledge stale or duplicate Slack actions so Slack does not retry them forever.
          return NextResponse.json({ ok: true, skipped: true, reason: error.code });
        }

        throw error;
      }
    })();

    if (updatedBundle instanceof NextResponse) {
      return updatedBundle;
    }

    // Execute approved tasks via integration adapters
    let executionResults: ExecutionResult[] = [];
    if (decision === "approved") {
      const approval = updatedBundle.approvals.find((a) => a.id === approvalId);
      if (approval) {
        try {
          const adapters = {
            gmail: isGmailReady() ? { createDraft, sendDraft, listRecentEmails } : undefined,
            calendar: isCalendarReady() ? { createEvent, updateEvent, listUpcomingEvents } : undefined,
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

    if (executionResults.length > 0) {
      try {
        await persistCapturedMemories({
          repository,
          captured: captureExecutionOutcomeSignals(updatedBundle, actorUserId, executionResults, actorContext),
          goalId: updatedBundle.goal.id,
          label: "slack-execution-capture",
          actorContext
        });
      } catch (captureError) {
        console.error("[slack-webhook][execution-capture] Failed to persist execution outcome signals:", captureError);
      }
    }

    // Capture memories when goal completes
    if (updatedBundle.goal.status === "completed") {
      try {
        await persistCapturedMemories({
          repository,
          captured: captureMemoriesFromBundle(updatedBundle, actorUserId, actorContext),
          goalId: updatedBundle.goal.id,
          label: "slack-webhook][auto-capture",
          actorContext
        });
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
