import { NextResponse } from "next/server";
import { z } from "zod";
import { SYSTEM_USER_ID } from "@agentic/contracts";
import { processUserRequest } from "@agentic/orchestrator";
import { isAuthError, requireApiSession } from "../../../lib/auth";
import { getSeededRepository } from "../../../lib/server";

const GoalRequestSchema = z
  .object({
    request: z.string().trim().min(1).max(2_000)
  })
  .strict();

export async function POST(request: Request) {
  try {
    await requireApiSession(request);
    const body = GoalRequestSchema.parse(await request.json());
    const repository = await getSeededRepository();
    const [memories, integrations] = await Promise.all([
      repository.listMemory(SYSTEM_USER_ID),
      repository.listIntegrations(SYSTEM_USER_ID)
    ]);
    const bundle = processUserRequest({
      userId: SYSTEM_USER_ID,
      request: body.request,
      memories,
      integrations
    });

    await repository.saveGoalBundle(bundle);

    return NextResponse.json({
      bundle,
      dashboard: await repository.getDashboardData(SYSTEM_USER_ID)
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to create goal."
      },
      { status: 400 }
    );
  }
}
