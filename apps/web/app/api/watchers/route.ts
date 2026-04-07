import { NextResponse } from "next/server";
import { z } from "zod";
import { SYSTEM_USER_ID, WatcherFrequencySchema, WatcherSchema, nowIso } from "@agentic/contracts";
import { isContentTypeError, requireJsonContentType } from "../../../lib/api-errors";
import { isAuthError, requireApiSession } from "../../../lib/auth";
import { getSeededRepository } from "../../../lib/server";

const CreateWatcherSchema = z
  .object({
    goalId: z.string().trim().min(1),
    targetEntity: z.string().trim().min(1).max(80),
    condition: z.string().trim().min(1).max(200),
    frequency: WatcherFrequencySchema,
    triggerAction: z.string().trim().min(1).max(200),
    sourceSystems: z.array(z.string().trim().min(1).max(40)).max(8).optional()
  })
  .strict();

export async function GET(request: Request) {
  try {
    await requireApiSession(request);
    const repository = await getSeededRepository();
    return NextResponse.json({
      watchers: await repository.listWatchers({ userId: SYSTEM_USER_ID })
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to list watchers."
      },
      { status: 400 }
    );
  }
}

export async function POST(request: Request) {
  try {
    requireJsonContentType(request);
    await requireApiSession(request);
    const body = CreateWatcherSchema.parse(await request.json());
    const repository = await getSeededRepository();
    const goal = await repository.getGoalBundleForUser(body.goalId, SYSTEM_USER_ID);

    if (!goal) {
      return NextResponse.json({ error: `Goal ${body.goalId} was not found.` }, { status: 404 });
    }

    const watcher = WatcherSchema.parse({
      id: crypto.randomUUID(),
      goalId: body.goalId,
      targetEntity: body.targetEntity,
      condition: body.condition,
      frequency: body.frequency,
      triggerAction: body.triggerAction,
      sourceSystems: body.sourceSystems ?? [],
      status: "active",
      expiryAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    await repository.saveWatcher(watcher);

    return NextResponse.json({
      watcher,
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
        error: error instanceof Error ? error.message : "Failed to save watcher."
      },
      { status: 400 }
    );
  }
}
