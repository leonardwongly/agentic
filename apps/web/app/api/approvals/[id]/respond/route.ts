import { NextResponse } from "next/server";
import { z } from "zod";
import { SYSTEM_USER_ID } from "@agentic/contracts";
import { respondToApproval } from "@agentic/orchestrator";
import { isContentTypeError, requireJsonContentType } from "../../../../../lib/api-errors";
import { isAuthError, requireApiSession } from "../../../../../lib/auth";
import { getSeededRepository } from "../../../../../lib/server";

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
    const body = ApprovalResponseSchema.parse(await request.json());
    const repository = await getSeededRepository();
    const goals = await repository.listGoals(SYSTEM_USER_ID);
    const bundle = goals.find((candidate) => candidate.approvals.some((approval) => approval.id === id));

    if (!bundle) {
      return NextResponse.json({ error: `Approval ${id} was not found.` }, { status: 404 });
    }

    const updatedBundle = respondToApproval({
      bundle,
      approvalId: id,
      decision: body.decision
    });

    await repository.saveGoalBundle(updatedBundle);

    return NextResponse.json({
      bundle: updatedBundle,
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
        error: error instanceof Error ? error.message : "Failed to respond to approval."
      },
      { status: 400 }
    );
  }
}
