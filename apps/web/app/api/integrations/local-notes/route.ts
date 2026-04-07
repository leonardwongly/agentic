import { NextResponse } from "next/server";
import { z } from "zod";
import { SYSTEM_USER_ID } from "@agentic/contracts";
import { createLocalNote, searchLocalNotes } from "@agentic/integrations";
import { formatValidationError, isContentTypeError, requireJsonContentType } from "../../../../lib/api-errors";
import { getSeededRepository } from "../../../../lib/server";
import { isAuthError, requireApiSession } from "../../../../lib/auth";

const CreateLocalNoteSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    content: z.string().trim().min(1).max(10_000)
  })
  .strict();

const SearchLocalNotesQuerySchema = z.object({
  q: z.string().trim().max(200).optional().default("")
});

export async function GET(request: Request) {
  try {
    await requireApiSession(request);
    const query = SearchLocalNotesQuerySchema.parse({
      q: new URL(request.url).searchParams.get("q") ?? ""
    }).q;

    return NextResponse.json({
      notes: await searchLocalNotes(query)
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
        error: error instanceof Error ? error.message : "Failed to list local notes."
      },
      { status: 400 }
    );
  }
}

export async function POST(request: Request) {
  try {
    requireJsonContentType(request);
    await requireApiSession(request);
    const body = CreateLocalNoteSchema.parse(await request.json());
    const [note, repository] = await Promise.all([createLocalNote(body), getSeededRepository()]);

    return NextResponse.json({
      note,
      notes: await searchLocalNotes(""),
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
        error: error instanceof Error ? error.message : "Failed to create a local note."
      },
      { status: 400 }
    );
  }
}
