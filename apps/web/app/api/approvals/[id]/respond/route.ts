import { z } from "zod";
import { SYSTEM_USER_ID } from "@agentic/contracts";
import { respondToApproval, captureMemoriesFromBundle, executeApprovedTasks } from "@agentic/orchestrator";
import { isGmailReady, isCalendarReady, isSlackReady, sendNotification, createDraft, sendDraft, listRecentEmails, createEvent, updateEvent, listUpcomingEvents, createLocalNote } from "@agentic/integrations";
import { requireApiSession } from "../../../../../lib/auth";
import { ApiRouteError, authenticatedJson, handleApiError, parseJsonBody } from "../../../../../lib/api-response";
import { getSeededRepository, getSeededSelfImprovementRepository } from "../../../../../lib/server";

const ApprovalIdSchema = z.string().trim().min(1).max(200);

const ApprovalResponseSchema = z
  .object({
    decision: z.enum(["approved", "rejected"])
  })
  .strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireJsonContentType(request);
    await requireApiSession(request);
    const { id } = await context.params;
    const approvalId = ApprovalIdSchema.parse(id);
    const body = await parseJsonBody(request, ApprovalResponseSchema);
    const repository = await getSeededRepository();
    const goals = await repository.listGoals(SYSTEM_USER_ID);
    const bundle = goals.find((candidate) => candidate.approvals.some((approval) => approval.id === approvalId));

    if (!bundle) {
      throw new ApiRouteError(404, `Approval ${approvalId} was not found.`);
    }

    const updatedBundle = respondToApproval({
      bundle,
      approvalId,
      decision: body.decision
    });

    // Execute approved tasks via integration adapters
    if (body.decision === "approved") {
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
          // Append execution logs to the bundle
          updatedBundle.actionLogs.push(...logs);
          console.log(`[execution] Executed ${results.length} task(s) after approval:`, results.map((r) => `${r.action}: ${r.success ? "OK" : "FAILED"}`).join(", "));
        } catch (execError) {
          console.error("[execution] Failed to execute approved task:", execError);
        }
      }
    }

    await repository.saveGoalBundle(updatedBundle);

    if (updatedBundle.goal.status === "completed") {
      try {
        const captured = captureMemoriesFromBundle(updatedBundle, SYSTEM_USER_ID);
        const selfImprovement = await getSeededSelfImprovementRepository();

        await Promise.all([
          ...captured.memories.map((memory) => repository.saveMemory(memory)),
          ...captured.episodes.map((episode) => selfImprovement.appendEpisode(episode))
        ]);

        console.log(
          `[auto-capture] Goal "${updatedBundle.goal.id}" completed — persisted ${captured.memories.length} memory record(s) and ${captured.episodes.length} episode(s).`
        );
      } catch (captureError) {
        console.error("[auto-capture] Failed to persist captured memories after approval:", captureError);
      }
    }

    // Send Slack notification about the decision (non-blocking)
    if (isSlackReady()) {
      try {
        const slackChannel = process.env.SLACK_DEFAULT_CHANNEL ?? "#approvals";
        const taskTitle =
          updatedBundle.tasks.find(
            (t) => t.id === updatedBundle.approvals.find((a) => a.id === approvalId)?.taskId
          )?.title ?? "Unknown task";
        const statusEmoji = body.decision === "approved" ? "\u2713" : "\u2717";
        const statusLabel = body.decision === "approved" ? "Approved" : "Rejected";

        await sendNotification({
          channel: slackChannel,
          text: `${statusEmoji} ${statusLabel}: ${taskTitle}`
        });
      } catch (slackError) {
        console.error("[approval] Failed to send Slack notification:", slackError);
      }
    }

    return authenticatedJson({
      bundle: updatedBundle,
      dashboard: await repository.getDashboardData(SYSTEM_USER_ID)
    });
  } catch (error) {
    return handleApiError(error, "Failed to respond to approval.");
  }
}
