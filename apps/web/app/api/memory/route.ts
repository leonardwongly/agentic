import { NextResponse } from "next/server";
import { z } from "zod";
import { SYSTEM_USER_ID } from "@agentic/contracts";
import { createMemoryRecord } from "@agentic/memory";
import { isContentTypeError, requireJsonContentType } from "../../../lib/api-errors";
import { isAuthError, requireApiSession } from "../../../lib/auth";
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
    return NextResponse.json({
      memories: await repository.listMemory(SYSTEM_USER_ID)
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to list memory."
      },
      { status: 400 }
    );
  }
}

export async function POST(request: Request) {
  try {
    requireJsonContentType(request);
    await requireApiSession(request);
    const body = CreateMemorySchema.parse(await request.json());
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

    return NextResponse.json({
      memory: record,
      dashboard: await repository.getDashboardData(SYSTEM_USER_ID)
    });
  } catch (error) {
    if (isContentTypeError(error)) {
      return NextResponse.json({ error: (error as Error).message }, { status: 415 });
    }
    if (isAuthError(error)) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to save memory."
      },
      { status: 400 }
    );
  }
}
