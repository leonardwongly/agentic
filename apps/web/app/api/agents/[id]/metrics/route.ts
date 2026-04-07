import { z } from "zod";
import { requireApiSession } from "../../../../../lib/auth";
import { authenticatedJson, handleApiError } from "../../../../../lib/api-response";
import { getSeededRepository } from "../../../../../lib/server";

type RouteParams = { params: Promise<{ id: string }> };

const periodSchema = z.enum(["day", "week", "month", "all"]).default("all");

export async function GET(request: Request, { params }: RouteParams) {
  try {
    await requireApiSession(request);
    const { id } = await params;
    const repository = await getSeededRepository();

    const agent = await repository.getAgent(id);

    if (!agent) {
      return authenticatedJson({ error: "Agent not found" }, { status: 404 });
    }

    const url = new URL(request.url);
    const period = periodSchema.parse(url.searchParams.get("period") ?? "all");

    const metrics = await repository.getAgentMetrics(id, period);

    return authenticatedJson({
      agentId: id,
      period,
      metrics
    });
  } catch (error) {
    return handleApiError(error, "Failed to get agent metrics.");
  }
}
