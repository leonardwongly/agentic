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

function goalIdFromRoot(rootId: string | null): string | null {
  return rootId?.startsWith("goal:") ? rootId.slice("goal:".length) : null;
}

function rootIdParts(rootId: string | null): { type: string; id: string } | null {
  const separator = rootId?.indexOf(":") ?? -1;
  if (!rootId || separator <= 0) {
    return null;
  }

  return {
    type: rootId.slice(0, separator),
    id: rootId.slice(separator + 1)
  };
}

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
    const rootGoalId = goalIdFromRoot(query.rootId);
    const root = rootIdParts(query.rootId);
    const goalsPromise = rootGoalId
      ? repository.getGoalBundleForUser(rootGoalId, principal.userId).then((goal) => (goal ? [goal] : []))
      : repository.listGoalsPage({ userId: principal.userId, limit: query.limit }).then((page) => page.items);
    const rootJobPromise =
      root?.type === "job" || root?.type === "failure" ? repository.getJob(root.id, principal.userId) : Promise.resolve(null);
    const rootMemoryPromise =
      root?.type === "memory" || root?.type === "context_packet"
        ? repository.listMemory(principal.userId).then((memories) =>
            memories.find((memory) => memory.id === root.id || `ctx_${memory.id}` === root.id) ?? null
          )
        : Promise.resolve(null);
    const [goals, jobs, memories, evidenceRecords, rootJob, rootMemory] = await Promise.all([
      goalsPromise,
      repository.listJobs({ userId: principal.userId, limit: query.limit }),
      repository.listContextPacketMemory({ userId: principal.userId, limit: query.limit }),
      repository.listEvidenceRecords({ userId: principal.userId, goalId: rootGoalId ?? undefined, limit: query.limit }),
      rootJobPromise,
      rootMemoryPromise
    ]);

    return authenticatedJson({
      graph: buildExecutionProvenanceGraph({
        userId: principal.userId,
        goals,
        jobs: rootJob ? [rootJob, ...jobs.filter((job) => job.id !== rootJob.id)] : jobs,
        memories: rootMemory ? [rootMemory, ...memories.filter((memory) => memory.id !== rootMemory.id)] : memories,
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
