import { NextResponse } from "next/server";
import { z } from "zod";
import { IntegrationAccountSchema, nowIso } from "@agentic/contracts";
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
      integrations: await repository.listIntegrations()
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
    await requireApiSession(request);
    const body = UpdateIntegrationSchema.parse(await request.json());
    const repository = await getSeededRepository();
    const existing = (await repository.listIntegrations()).find((integration) => integration.id === body.id);

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
      dashboard: await repository.getDashboardData()
    });
  } catch (error) {
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
