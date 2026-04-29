import { z } from "zod";
import { buildExecutionProvenanceGraph } from "@agentic/repository";
import { requireApiSession } from "../../../../lib/auth";
import { authenticatedJson, handleApiError } from "../../../../lib/api-response";
import { getSeededRepository } from "../../../../lib/server";

const GraphQuerySchema = z
  .object({
    rootId: z.string().trim().min(1).max(240).nullable().default(null),
    depth: z.coerce.number().int().min(0).max(4).default(2),
    limit: z.coerce.number().int().min(1).max(500).default(250)
  })
  .strict();

export async function GET(request: Request) {
  try {
    const principal = await requireApiSession(request);
    const url = new URL(request.url);
    const query = GraphQuerySchema.parse({
      rootId: url.searchParams.get("rootId"),
      depth: url.searchParams.get("depth") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined
    });
    const repository = await getSeededRepository();
    const [dashboard, jobs, memories, evidenceRecords] = await Promise.all([
      repository.getDashboardData(principal.userId),
      repository.listJobs({ userId: principal.userId }),
      repository.listMemory(principal.userId),
      repository.listEvidenceRecords({ userId: principal.userId })
    ]);

    return authenticatedJson({
      graph: buildExecutionProvenanceGraph({
        userId: principal.userId,
        goals: dashboard.goals,
        jobs,
        memories,
        evidenceRecords,
        rootId: query.rootId,
        depth: query.depth,
        limit: query.limit
      })
    });
  } catch (error) {
    return handleApiError(error, "Failed to build execution provenance graph.");
  }
}
