import { z } from "zod";
import { isSlackReady, sendApprovalMessage } from "@agentic/integrations";
import { requireApiSession } from "../../../../lib/auth";
import { ApiRouteError, authenticatedJson, handleApiError, parseJsonBody } from "../../../../lib/api-response";
import { buildSlackApprovalToken } from "../../../../lib/slack-approvals";
import { getSeededRepository } from "../../../../lib/server";

const DEFAULT_SLACK_CHANNEL = process.env.SLACK_DEFAULT_CHANNEL ?? "#approvals";

const NotifyBodySchema = z
  .object({
    approvalId: z.string().trim().min(1).max(200),
    channel: z.string().trim().min(1).max(200).optional()
  })
  .strict();

/**
 * POST /api/slack/notify
 *
 * Internal API to send a Slack approval message for a pending approval.
 * Requires session auth.
 */
export async function POST(request: Request) {
  try {
    const principal = await requireApiSession(request);

    if (!isSlackReady()) {
      throw new ApiRouteError(503, "Slack integration is not configured. Set SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET.");
    }

    const body = await parseJsonBody(request, NotifyBodySchema);
    const repository = await getSeededRepository();
    const goals = await repository.listGoals(principal.userId);

    const bundle = goals.find((candidate) =>
      candidate.approvals.some((approval) => approval.id === body.approvalId)
    );

    if (!bundle) {
      throw new ApiRouteError(404, `Approval ${body.approvalId} was not found.`);
    }

    const approval = bundle.approvals.find((a) => a.id === body.approvalId);
    if (!approval) {
      throw new ApiRouteError(404, `Approval ${body.approvalId} was not found.`);
    }

    const task = bundle.tasks.find((t) => t.id === approval.taskId);
    const channel = body.channel ?? DEFAULT_SLACK_CHANNEL;
    const actionValue = buildSlackApprovalToken({
      approvalId: approval.id,
      goalId: bundle.goal.id,
      workspaceId: bundle.goal.workspaceId,
      expiresAt: approval.expiryAt
    });

    const result = await sendApprovalMessage({
      channel,
      approval: {
        id: approval.id,
        title: task?.title ?? bundle.goal.title ?? "Untitled approval",
        rationale: approval.rationale ?? "No rationale provided.",
        riskClass: task?.riskClass ?? "R1",
        requestedAction: task?.title ?? "Unknown action",
        actionValue
      }
    });

    return authenticatedJson({ ok: result.ok, ts: result.ts, channel });
  } catch (error) {
    return handleApiError(error, "Failed to send Slack notification.");
  }
}
