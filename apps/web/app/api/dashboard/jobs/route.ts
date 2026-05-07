import { jobKindValues, jobStatusValues } from "@agentic/contracts";
import { requireApiSession } from "../../../../lib/auth";
import { authenticatedJson, handleApiError, withApiTelemetry } from "../../../../lib/api-response";
import { buildDashboardCollectionPage, parseDashboardCollectionQuery } from "../../../../lib/dashboard-collection";
import { getSeededRepository } from "../../../../lib/server";

const DASHBOARD_JOB_SOURCE_LIMIT = 500;

export async function GET(request: Request) {
  return withApiTelemetry(request, "api.dashboard.jobs", async () => {
    try {
      const principal = await requireApiSession(request);
      const query = parseDashboardCollectionQuery(request, {
        allowedFilters: ["status", "kind"],
        allowedStatusValues: jobStatusValues,
        allowedKindValues: jobKindValues
      });
      const repository = await getSeededRepository();
      const jobs = await repository.listJobs({
        userId: principal.userId,
        limit: DASHBOARD_JOB_SOURCE_LIMIT
      });
      const filteredJobs = jobs.filter((job) => {
        if (query.status && job.status !== query.status) {
          return false;
        }

        return !query.kind || job.kind === query.kind;
      });

      return authenticatedJson({
        page: buildDashboardCollectionPage(filteredJobs, query, {
          getId: (job) => job.id,
          getCreatedAt: (job) => job.createdAt,
          getUpdatedAt: (job) => job.updatedAt,
          getTitle: (job) => job.id,
          getSearchText: (job) =>
            [job.id, job.kind, job.status, job.lastError ?? "", JSON.stringify(job.payload)].join(" ")
        })
      });
    } catch (error) {
      return handleApiError(error, "Failed to load dashboard jobs.");
    }
  });
}
