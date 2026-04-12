import { z } from "zod";
import { AgentDefinitionSchema, AgentExportSchema, nowIso } from "@agentic/contracts";
import { requireApiSession } from "../../../../lib/auth";
import { authenticatedJson, handleApiError, parseJsonBody } from "../../../../lib/api-response";
import { getSeededRepository } from "../../../../lib/server";

const ImportAgentSchema = z
  .object({
    exportData: AgentExportSchema,
    newName: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z][a-z0-9-]*$/, "Name must be lowercase alphanumeric with hyphens")
      .optional()
  })
  .strict();

export async function POST(request: Request) {
  try {
    const principal = await requireApiSession(request);
    const body = await parseJsonBody(request, ImportAgentSchema);
    const repository = await getSeededRepository();

    const imported = body.exportData.agent;
    const now = nowIso();

    const agent = AgentDefinitionSchema.parse({
      ...imported,
      id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      userId: principal.userId,
      name: body.newName ?? imported.name,
      isBuiltIn: false,
      parentAgentId: imported.id,
      version: 1,
      status: "draft",
      createdAt: now,
      updatedAt: now
    });

    const saved = await repository.saveAgent(agent);

    return authenticatedJson({
      agent: saved,
      dashboard: await repository.getDashboardData(principal.userId)
    });
  } catch (error) {
    return handleApiError(error, "Failed to import agent.");
  }
}
