import { NextResponse } from "next/server";
import { z } from "zod";
import { IntegrationAccountSchema, SYSTEM_USER_ID, nowIso } from "@agentic/contracts";
import { isContentTypeError, requireJsonContentType } from "../../../lib/api-errors";
import { isAuthError, requireApiSession } from "../../../lib/auth";
import { getSeededRepository } from "../../../lib/server";

const UpdateIntegrationSchema = z
  .object({
    id: z.string().trim().min(1),
    status: z.enum(["ready", "mock", "manual", "disabled"])
  })
  .strict();

export async function GET(request: Request) {
  try {
    await requireApiSession(request);
    const repository = await getSeededRepository();
    return NextResponse.json({
      integrations: await repository.listIntegrations(SYSTEM_USER_ID)
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to list integrations."
      },
      { status: 400 }
    );
  }
}

export async function POST(request: Request) {
  try {
    requireJsonContentType(request);
    await requireApiSession(request);
    const body = UpdateIntegrationSchema.parse(await request.json());
    const repository = await getSeededRepository();
    const existing = (await repository.listIntegrations(SYSTEM_USER_ID)).find((integration) => integration.id === body.id);

    if (!existing) {
      return NextResponse.json({ error: `Integration ${body.id} was not found.` }, { status: 404 });
    }

    const integration = IntegrationAccountSchema.parse({
      ...existing,
      status: body.status,
      updatedAt: nowIso()
    });

    await repository.upsertIntegration(integration);

    return NextResponse.json({
      integration,
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
        error: error instanceof Error ? error.message : "Failed to update integration."
      },
      { status: 400 }
    );
  }
}
