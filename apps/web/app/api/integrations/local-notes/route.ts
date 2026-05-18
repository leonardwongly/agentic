import { z } from "zod";
import { createLocalNote, searchLocalNotes } from "@agentic/integrations";
import { getSeededRepository } from "../../../../lib/server";
import { requireApiSession } from "../../../../lib/auth";
import { authenticatedJson, handleApiError, parseJsonBody } from "../../../../lib/api-response";
import { requireJsonContentType } from "../../../../lib/api-errors";
import { normalizeLocalNotesRouteError } from "./local-notes-route-errors";

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

    return authenticatedJson({
      notes: await searchLocalNotes(query)
    });
  } catch (error) {
    return handleApiError(normalizeLocalNotesRouteError(error), "Failed to list local notes.");
  }
}

export async function POST(request: Request) {
  try {
    requireJsonContentType(request);
    const principal = await requireApiSession(request);
    const body = await parseJsonBody(request, CreateLocalNoteSchema);
    const note = await createLocalNote(body);
    const repository = await getSeededRepository();

    return authenticatedJson({
      note,
      notes: await searchLocalNotes(""),
      dashboard: await repository.getDashboardData(principal.userId)
    });
  } catch (error) {
    return handleApiError(normalizeLocalNotesRouteError(error), "Failed to create a local note.");
  }
}
