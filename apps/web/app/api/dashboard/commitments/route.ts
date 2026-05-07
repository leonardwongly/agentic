import { commitmentInboxBucketValues, commitmentStatusValues, type Commitment, type CommitmentInboxBucket } from "@agentic/contracts";
import { requireApiSession } from "../../../../lib/auth";
import { authenticatedJson, handleApiError, withApiTelemetry } from "../../../../lib/api-response";
import { buildDashboardCollectionPage, parseDashboardCollectionQuery } from "../../../../lib/dashboard-collection";
import { getSeededRepository } from "../../../../lib/server";

const DUE_SOON_MS = 72 * 60 * 60 * 1000;

function isDueSoon(commitment: Commitment): boolean {
  if (!commitment.dueAt) {
    return false;
  }

  const dueAtMs = Date.parse(commitment.dueAt);
  return Number.isFinite(dueAtMs) && dueAtMs <= Date.now() + DUE_SOON_MS;
}

function matchesBucket(commitment: Commitment, bucket: CommitmentInboxBucket): boolean {
  if (bucket === "all") {
    return true;
  }

  if (bucket === "completed") {
    return commitment.status === "completed" || commitment.status === "dismissed";
  }

  if (bucket === "urgent") {
    return commitment.urgency === "immediate" || commitment.urgency === "today" || commitment.status === "needs-review";
  }

  if (bucket === "due_soon") {
    return isDueSoon(commitment);
  }

  if (bucket === "waiting_on_others") {
    return commitment.status === "blocked" || commitment.status === "needs-review";
  }

  if (bucket === "low_confidence") {
    return commitment.confidence < 0.75;
  }

  return commitment.status !== "completed" && commitment.status !== "dismissed";
}

export async function GET(request: Request) {
  return withApiTelemetry(request, "api.dashboard.commitments", async () => {
    try {
      const principal = await requireApiSession(request);
      const query = parseDashboardCollectionQuery(request, {
        allowedFilters: ["status", "riskClass", "bucket"],
        allowedStatusValues: commitmentStatusValues
      });
      const repository = await getSeededRepository();
      const dashboard = await repository.getDashboardData(principal.userId);
      const bucket = query.bucket ?? "all";
      const commitments = dashboard.commitments.filter((commitment) => {
        if (!commitmentInboxBucketValues.includes(bucket) || !matchesBucket(commitment, bucket)) {
          return false;
        }

        if (query.status && commitment.status !== query.status) {
          return false;
        }

        return !query.riskClass || commitment.riskClass === query.riskClass;
      });

      return authenticatedJson({
        page: buildDashboardCollectionPage(commitments, query, {
          getId: (commitment) => commitment.id,
          getCreatedAt: (commitment) => commitment.createdAt,
          getUpdatedAt: (commitment) => commitment.updatedAt,
          getTitle: (commitment) => commitment.title,
          getSearchText: (commitment) =>
            [
              commitment.id,
              commitment.title,
              commitment.summary,
              commitment.status,
              commitment.provenanceSummary,
              commitment.evidence.map((item) => item.label).join(" ")
            ].join(" ")
        })
      });
    } catch (error) {
      return handleApiError(error, "Failed to load dashboard commitments.");
    }
  });
}
