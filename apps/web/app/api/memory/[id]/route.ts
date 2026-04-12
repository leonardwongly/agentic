import { z } from "zod";
import { MemoryRecordSchema, nowIso } from "@agentic/contracts";
import { requireApiSession } from "../../../../lib/auth";
import { ApiRouteError, authenticatedJson, handleApiError, parseJsonBody } from "../../../../lib/api-response";
import { requireJsonContentType } from "../../../../lib/api-errors";
import { getSeededRepository } from "../../../../lib/server";

const MemoryIdSchema = z.string().trim().min(1).max(200);
const MEMORY_REVIEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const UpdateMemorySchema = z
  .object({
    action: z.enum(["review", "confirm"])
  })
  .strict();

function buildReviewedMemoryExpiry(expiryAt: string | null, now: number): string | null {
  if (!expiryAt) {
    return null;
  }

  return Date.parse(expiryAt) <= now ? null : expiryAt;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireJsonContentType(request);
    const principal = await requireApiSession(request);
    const { id } = await context.params;
    const memoryId = MemoryIdSchema.parse(id);
    const body = await parseJsonBody(request, UpdateMemorySchema);
    const repository = await getSeededRepository();
    const memories = await repository.listMemory(principal.userId);
    const existing = memories.find((record) => record.id === memoryId);

    if (!existing) {
      throw new ApiRouteError(404, `Memory ${memoryId} was not found.`);
    }

    const now = Date.now();
    const updated = MemoryRecordSchema.parse({
      ...existing,
      memoryType: body.action === "confirm" ? "confirmed" : existing.memoryType,
      confidence: body.action === "confirm" ? Math.max(existing.confidence, 0.92) : existing.confidence,
      reviewAt: new Date(now + MEMORY_REVIEW_WINDOW_MS).toISOString(),
      expiryAt: buildReviewedMemoryExpiry(existing.expiryAt, now),
      updatedAt: nowIso()
    });

    await repository.saveMemory(updated);

    return authenticatedJson({
      memory: updated,
      dashboard: await repository.getDashboardData(principal.userId)
    });
  } catch (error) {
    return handleApiError(error, "Failed to update memory.");
  }
}
