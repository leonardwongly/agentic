import { z } from "zod";
import { SYSTEM_USER_ID } from "@agentic/contracts";
import { createMemoryRecord } from "@agentic/memory";
import { requireApiSession } from "../../../lib/auth";
import { authenticatedJson, handleApiError, parseJsonBody } from "../../../lib/api-response";
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
    await requireApiSession(request);
    const repository = await getSeededRepository();
    return authenticatedJson({
      memories: await repository.listMemory(SYSTEM_USER_ID)
    });
  } catch (error) {
    return handleApiError(error, "Failed to list memory.");
  }
}

export async function POST(request: Request) {
  try {
    requireJsonContentType(request);
    await requireApiSession(request);
    const body = await parseJsonBody(request, CreateMemorySchema);
    const repository = await getSeededRepository();
    const record = createMemoryRecord({
      userId: SYSTEM_USER_ID,
      category: body.category,
      memoryType: body.memoryType ?? "observed",
      content: body.content,
      confidence: body.memoryType === "confirmed" ? 0.92 : 0.78,
      source: "ui",
      sensitivity: "internal",
      permissions: ["orchestrator", "knowledge", "workflow"]
    });

    await repository.saveMemory(record);

    return authenticatedJson({
      memory: record,
      dashboard: await repository.getDashboardData(SYSTEM_USER_ID)
    });
  } catch (error) {
    return handleApiError(error, "Failed to save memory.");
  }
}
