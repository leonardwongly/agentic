import { NextResponse } from "next/server";
import { z } from "zod";
import { SYSTEM_USER_ID } from "@agentic/contracts";
import { readLocalNote, searchLocalNotes, updateLocalNote } from "@agentic/integrations";
import { formatValidationError, isContentTypeError, requireJsonContentType } from "../../../../../lib/api-errors";
import { getSeededRepository } from "../../../../../lib/server";
import { isAuthError, requireApiSession } from "../../../../../lib/auth";

const NoteSlugSchema = z.string().trim().min(1).max(120).regex(/^[a-z0-9-]+$/);

const UpdateLocalNoteSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    content: z.string().trim().min(1).max(10_000)
  })
  .strict();

type RouteContext = {
  params: Promise<{
    slug: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    await requireApiSession(request);
    const { slug } = await context.params;

    return NextResponse.json({
      note: await readLocalNote(NoteSlugSchema.parse(slug))
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: formatValidationError(error) }, { status: 400 });
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to load the local note."
      },
      { status: 400 }
    );
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    requireJsonContentType(request);
    await requireApiSession(request);
    const { slug } = await context.params;
    const body = UpdateLocalNoteSchema.parse(await request.json());
    const note = await updateLocalNote({
      slug: NoteSlugSchema.parse(slug),
      title: body.title,
      content: body.content
    });
    const [notes, repository] = await Promise.all([searchLocalNotes(""), getSeededRepository()]);

    return NextResponse.json({
      note,
      notes,
      dashboard: await repository.getDashboardData(SYSTEM_USER_ID)
    });
  } catch (error) {
    if (isContentTypeError(error)) {
      return NextResponse.json({ error: (error as Error).message }, { status: 415 });
    }
    if (isAuthError(error)) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: formatValidationError(error) }, { status: 400 });
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to update the local note."
      },
      { status: 400 }
    );
  }
}
