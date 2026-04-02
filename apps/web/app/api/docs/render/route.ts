import { NextResponse } from "next/server";
import { SYSTEM_USER_ID } from "@agentic/contracts";
import { isAuthError, requireApiSession } from "../../../../lib/auth";
import { getSeededRepository, runDocsBuild } from "../../../../lib/server";

export async function POST(request: Request) {
  try {
    await requireApiSession(request);
    const [result, repository] = await Promise.all([runDocsBuild(), getSeededRepository()]);

    return NextResponse.json({
      result,
      dashboard: await repository.getDashboardData(SYSTEM_USER_ID)
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to render the document."
      },
      { status: 500 }
    );
  }
}
