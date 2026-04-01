import { NextResponse } from "next/server";
import { SYSTEM_USER_ID } from "@agentic/contracts";
import { isAuthError, requireApiSession } from "../../../../lib/auth";
import { getSeededRepository } from "../../../../lib/server";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireApiSession(request);
    const { id } = await context.params;
    const repository = await getSeededRepository();
    const bundle = await repository.getGoalBundleForUser(id, SYSTEM_USER_ID);

    if (!bundle) {
      return NextResponse.json({ error: `Goal ${id} was not found.` }, { status: 404 });
    }

    return NextResponse.json({ bundle });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to load goal."
      },
      { status: 400 }
    );
  }
}
