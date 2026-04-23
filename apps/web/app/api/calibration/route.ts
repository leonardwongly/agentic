import { z } from "zod";
import { requireApiSession } from "../../../lib/auth";
import { authenticatedJson, handleApiError } from "../../../lib/api-response";
import { getSeededRepository } from "../../../lib/server";
import { deriveCalibrationInsights } from "../../../../../packages/repository/src/calibration-insights";

const calibrationQuerySchema = z.object({
  agentId: z.string().trim().min(1).max(160).optional(),
  period: z.enum(["day", "week", "month", "all"]).default("all"),
  limit: z.coerce.number().int().min(1).max(50).default(12)
}).strict();

function parseCalibrationQuery(request: Request) {
  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams.entries());
  return calibrationQuerySchema.parse(query);
}

export async function GET(request: Request) {
  try {
    const principal = await requireApiSession(request);
    const query = parseCalibrationQuery(request);
    const repository = await getSeededRepository();

    if (query.agentId) {
      const agent = await repository.getAgent(query.agentId, principal.userId);

      if (!agent) {
        return authenticatedJson({ error: "Agent not found" }, { status: 404 });
      }
    }

    const [agents, goals, evidenceRecords] = await Promise.all([
      repository.listAgents(principal.userId),
      repository.listGoals(principal.userId),
      repository.listEvidenceRecords({ userId: principal.userId })
    ]);
    const calibration = deriveCalibrationInsights({
      agents,
      goals,
      evidenceRecords,
      options: {
      agentId: query.agentId ?? null,
      period: query.period,
      limit: query.limit
      }
    });

    return authenticatedJson({ calibration });
  } catch (error) {
    return handleApiError(error, "Failed to get calibration insights.");
  }
}
