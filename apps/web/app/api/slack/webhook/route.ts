import { createHumanActorContext } from "@agentic/contracts";
import {
  verifySlackSignature
} from "@agentic/integrations";
import { logError } from "@agentic/observability";
import { ApprovalMutationError } from "@agentic/repository";
import {
  enqueueApprovalNotificationJob,
  respondToApprovalAndEnqueueFollowUpJob
} from "@agentic/worker-runtime";
import { ApiRouteError, operationalJson, readBoundedRequestText } from "../../../../lib/api-response";
import { resolveSlackActorUserId, verifySlackApprovalToken } from "../../../../lib/slack-approvals";
import { getSeededRepository } from "../../../../lib/server";

const MAX_SLACK_WEBHOOK_BYTES = 64 * 1024;

/**
 * POST /api/slack/webhook
 *
 * Receives Slack interactive payloads (button clicks for approve / reject).
 * Authentication is handled via Slack signature verification instead of session auth.
 */
export async function POST(request: Request) {
  try {
    // Read the raw body for signature verification
    const rawBody = await readBoundedRequestText(request, {
      maxBytes: MAX_SLACK_WEBHOOK_BYTES,
      tooLargeMessage: "Slack webhook payload is too large."
    });

    const slackSignature = request.headers.get("x-slack-signature") ?? "";
    const slackTimestamp = request.headers.get("x-slack-request-timestamp") ?? "";

    if (!slackSignature || !slackTimestamp) {
      return operationalJson({ error: "Missing Slack signature headers." }, { status: 401 });
    }

    // Reject requests older than 5 minutes to prevent replay attacks
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - Number(slackTimestamp)) > 300) {
      return operationalJson({ error: "Request timestamp too old." }, { status: 401 });
    }

    if (!verifySlackSignature({ signature: slackSignature, timestamp: slackTimestamp, body: rawBody })) {
      return operationalJson({ error: "Invalid Slack signature." }, { status: 401 });
    }

    // Slack sends interactive payloads as application/x-www-form-urlencoded with a "payload" field
    const params = new URLSearchParams(rawBody);
    const payloadStr = params.get("payload");

    if (!payloadStr) {
      return operationalJson({ error: "Missing payload." }, { status: 400 });
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
      return operationalJson({ ok: true });
    }

    const action = payload.actions[0];
    const approvalToken = verifySlackApprovalToken(action.value);
    if (!approvalToken) {
      return operationalJson({ error: "Invalid or expired approval action." }, { status: 401 });
    }

    const slackUserId = payload.user?.id?.trim() ?? "";
    const actorUserId = slackUserId ? resolveSlackActorUserId(slackUserId) : null;
    if (!actorUserId) {
      return operationalJson({ error: "Slack actor is not authorized for approvals." }, { status: 403 });
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
      return operationalJson({ ok: true });
    }

    const repository = await getSeededRepository();
    const actorBundle = await repository.getGoalBundleForUser(approvalToken.goalId, actorUserId);
    if (!actorBundle) {
      return operationalJson({ error: "Approval is not available to this actor." }, { status: 403 });
    }

    const actorApproval = actorBundle.approvals.find((candidate) => candidate.id === approvalId);
    if (!actorApproval) {
      return operationalJson({ error: "Approval not found for this goal." }, { status: 404 });
    }

    if ((actorBundle.goal.workspaceId ?? null) !== approvalToken.workspaceId) {
      return operationalJson({ error: "Approval workspace mismatch." }, { status: 403 });
    }

    const decisionResult = await (async () => {
      try {
        return await respondToApprovalAndEnqueueFollowUpJob({
          repository,
          userId: actorUserId,
          approvalId,
          decision,
          actorContext,
          scope: "once",
          rationale: null
        });
      } catch (error) {
        if (error instanceof ApprovalMutationError) {
          if (error.code === "not_found") {
            return operationalJson({ error: error.message }, { status: 404 });
          }

          // Acknowledge stale or duplicate Slack actions so Slack does not retry them forever.
          return operationalJson({ ok: true, skipped: true, reason: error.code });
        }

        throw error;
      }
    })();

    if (decisionResult instanceof Response) {
      return decisionResult;
    }

    const updatedBundle = decisionResult.bundle;

    const approval = updatedBundle.approvals.find((candidate) => candidate.id === approvalId);

    if (!approval) {
      throw new Error(`Approval ${approvalId} is missing after Slack response mutation.`);
    }

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
    return operationalJson({ ok: true });
  } catch (error) {
    if (error instanceof ApiRouteError) {
      return operationalJson({ error: error.message }, { status: error.status });
    }

    logError("slack.webhook.unhandled_error", error);
    return operationalJson({ error: "Internal server error." }, { status: 500 });
  }
}
