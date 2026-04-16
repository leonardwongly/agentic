import { z } from "zod";
import { createMemoryRecord } from "@agentic/memory";
import { requireApiSession } from "../../../lib/auth";
import { authenticatedJson, handleApiError, parseJsonBody } from "../../../lib/api-response";
import { requireJsonContentType } from "../../../lib/api-errors";
import { createActorContextFromPrincipal } from "../../../lib/actor-context";
import { getSeededRepository } from "../../../lib/server";

const CreateMemorySchema = z
  .object({
    category: z.string().trim().min(1).max(64),
    content: z.string().trim().min(1).max(500),
    memoryType: z.enum(["observed", "inferred", "confirmed"]).optional()
  })
  .strict();

export async function GET(request: Request) {
  try {
    const principal = await requireApiSession(request);
    const repository = await getSeededRepository();
    return authenticatedJson({
      memories: await repository.listMemory(principal.userId)
    });
  } catch (error) {
    return handleApiError(error, "Failed to list memory.");
  }
}

export async function POST(request: Request) {
  try {
    requireJsonContentType(request);
    const principal = await requireApiSession(request);
    const body = await parseJsonBody(request, CreateMemorySchema);
    const repository = await getSeededRepository();
    const actorContext = createActorContextFromPrincipal(principal);
    const record = createMemoryRecord({
      userId: principal.userId,
      category: body.category,
      memoryType: body.memoryType ?? "observed",
      content: body.content,
      confidence: body.memoryType === "confirmed" ? 0.92 : 0.78,
      source: "ui",
      sensitivity: "internal",
      permissions: ["orchestrator", "knowledge", "workflow"],
      actorContext
    });

    await repository.saveMemory(record);

    return authenticatedJson({
      memory: record,
      dashboard: await repository.getDashboardData(principal.userId)
    });
  } catch (error) {
    return handleApiError(error, "Failed to save memory.");
  }
}
