import { z } from "zod";
import { CommitmentSchema, nowIso } from "@agentic/contracts";
import { requireApiSession } from "../../../../lib/auth";
import { ApiRouteError, authenticatedJson, handleApiError, parseJsonBody } from "../../../../lib/api-response";
import { requireJsonContentType } from "../../../../lib/api-errors";
import { requireUpdatedAtPrecondition } from "../../../../lib/mutation-preconditions";
import { createActorContextFromPrincipal } from "../../../../lib/actor-context";
import { getSeededRepository } from "../../../../lib/server";

const CommitmentIdSchema = z.string().trim().min(1).max(200);

const UpdateCommitmentSchema = z
  .object({
    action: z.enum(["complete", "dismiss", "reopen"])
  })
  .strict();

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireJsonContentType(request);
    const principal = await requireApiSession(request);
    const { id } = await context.params;
    const commitmentId = CommitmentIdSchema.parse(id);
    const body = await parseJsonBody(request, UpdateCommitmentSchema);
    const repository = await getSeededRepository();
    const actorContext = createActorContextFromPrincipal(principal);
    const existing = await repository.getCommitment(commitmentId, principal.userId);

    if (!existing) {
      throw new ApiRouteError(404, `Commitment ${commitmentId} was not found.`);
    }

    requireUpdatedAtPrecondition(request, existing.updatedAt);

    if (body.action === "reopen") {
      await repository.deleteCommitment(commitmentId, principal.userId);
      const dashboard = await repository.getDashboardData(principal.userId);
      const commitment = dashboard.commitments.find((candidate) => candidate.id === commitmentId) ?? null;

      return authenticatedJson({
        commitment,
        dashboard
      });
    }

    const updated = CommitmentSchema.parse({
      ...existing,
      status: body.action === "complete" ? "completed" : "dismissed",
      actorContext,
      updatedAt: nowIso()
    });

    await repository.saveCommitment(updated);

    return authenticatedJson({
      commitment: updated,
      dashboard: await repository.getDashboardData(principal.userId)
    });
  } catch (error) {
    return handleApiError(error, "Failed to update commitment.");
  }
}
