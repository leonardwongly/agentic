import { NextResponse } from "next/server";
import { createHumanActorContext } from "@agentic/contracts";
import {
  verifySlackSignature
} from "@agentic/integrations";
import { ApprovalMutationError } from "@agentic/repository";
import {
  enqueueApprovalFollowUpJob,
  enqueueApprovalNotificationJob
} from "@agentic/worker-runtime";
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

    const updatedBundle = await (async () => {
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

    const approval = updatedBundle.approvals.find((candidate) => candidate.id === approvalId);

    if (!approval) {
      throw new Error(`Approval ${approvalId} is missing after Slack response mutation.`);
    }

    await enqueueApprovalFollowUpJob({
      repository,
      userId: actorUserId,
      approvalId: approval.id,
      goalId: updatedBundle.goal.id,
      taskId: approval.taskId,
      decision,
      workspaceId: updatedBundle.goal.workspaceId,
      actorContext
    });

    const channel = payload.channel?.id;
    const messageTs = payload.message?.ts;

    if (channel && messageTs) {
      await enqueueApprovalNotificationJob({
        repository,
        userId: actorUserId,
        approvalId: approval.id,
        goalId: updatedBundle.goal.id,
        taskId: approval.taskId,
        decision,
        channel: "slack_receipt",
        slackChannelId: channel,
        slackMessageTs: messageTs,
        workspaceId: updatedBundle.goal.workspaceId,
        actorContext
      });
    }

    // Return 200 to Slack so it stops retrying
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[slack-webhook] Unhandled error:", error);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
