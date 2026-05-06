import { memoryTypeValues } from "@agentic/contracts";
import { requireApiSession } from "../../../../lib/auth";
import { authenticatedJson, handleApiError, withApiTelemetry } from "../../../../lib/api-response";
import { buildDashboardCollectionPage, parseDashboardCollectionQuery } from "../../../../lib/dashboard-collection";
import { getSeededRepository } from "../../../../lib/server";

export async function GET(request: Request) {
  return withApiTelemetry(request, "api.dashboard.memories", async () => {
    try {
      const principal = await requireApiSession(request);
      const query = parseDashboardCollectionQuery(request, {
        allowedFilters: ["kind"],
        allowedKindValues: memoryTypeValues
      });
      const repository = await getSeededRepository();
      const memories = await repository.listMemory(principal.userId);
      const filteredMemories = memories.filter((memory) => !query.kind || memory.memoryType === query.kind);

      return authenticatedJson({
        page: buildDashboardCollectionPage(filteredMemories, query, {
          getId: (memory) => memory.id,
          getCreatedAt: (memory) => memory.createdAt,
          getUpdatedAt: (memory) => memory.updatedAt,
          getTitle: (memory) => memory.category,
          getSearchText: (memory) => [memory.id, memory.category, memory.content, memory.source].join(" ")
        })
      });
    } catch (error) {
      return handleApiError(error, "Failed to load dashboard memories.");
    }
  });
}
