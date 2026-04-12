import { z } from "zod";
import { readLocalNote, searchLocalNotes, updateLocalNote } from "@agentic/integrations";
import { getSeededRepository } from "../../../../../lib/server";
import { requireApiSession } from "../../../../../lib/auth";
import { authenticatedJson, handleApiError, parseJsonBody } from "../../../../../lib/api-response";
import { requireJsonContentType } from "../../../../../lib/api-errors";

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

    return authenticatedJson({
      note: await readLocalNote(NoteSlugSchema.parse(slug))
    });
  } catch (error) {
    return handleApiError(error, "Failed to load the local note.");
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    requireJsonContentType(request);
    const principal = await requireApiSession(request);
    const { slug } = await context.params;
    const body = await parseJsonBody(request, UpdateLocalNoteSchema);
    const note = await updateLocalNote({
      slug: NoteSlugSchema.parse(slug),
      title: body.title,
      content: body.content
    });
    const [notes, repository] = await Promise.all([searchLocalNotes(""), getSeededRepository()]);

    return authenticatedJson({
      note,
      notes,
      dashboard: await repository.getDashboardData(principal.userId)
    });
  } catch (error) {
    return handleApiError(error, "Failed to update the local note.");
  }
}
