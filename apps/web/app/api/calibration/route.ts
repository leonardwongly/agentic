import { z } from "zod";
import { deriveCalibrationInsights } from "@agentic/repository";
import { requireApiSession } from "../../../lib/auth";
import { authenticatedJson, handleApiError } from "../../../lib/api-response";
import { getSeededRepository } from "../../../lib/server";

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

    const [agents, goals, evidenceRecords] = await Promise.all([
      repository.listAgents(principal.userId),
      repository.listGoals(principal.userId),
      repository.listEvidenceRecords({ userId: principal.userId })
    ]);
    const requestedAgent = query.agentId
      ? agents.find((agent) => agent.id === query.agentId) ?? agents.find((agent) => agent.name === query.agentId) ?? null
      : null;

    if (query.agentId && !requestedAgent) {
      return authenticatedJson({ error: "Agent not found" }, { status: 404 });
    }

    const calibration = deriveCalibrationInsights({
      agents,
      goals,
      evidenceRecords,
      options: {
        agentId: requestedAgent?.id ?? null,
        period: query.period,
        limit: query.limit
      }
    });

    return authenticatedJson({ calibration });
  } catch (error) {
    return handleApiError(error, "Failed to get calibration insights.");
  }
}
