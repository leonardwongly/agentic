import { z } from "zod";
import { AgentDefinitionSchema, nowIso } from "@agentic/contracts";
import { requireApiSession } from "../../../../../lib/auth";
import { authenticatedJson, handleApiError, parseJsonBody } from "../../../../../lib/api-response";
import { getSeededRepository } from "../../../../../lib/server";

type RouteParams = { params: Promise<{ id: string }> };

const CloneAgentSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z][a-z0-9-]*$/, "Name must be lowercase alphanumeric with hyphens"),
    displayName: z.string().trim().min(1).max(100)
  })
  .strict();

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const principal = await requireApiSession(request);
    const { id } = await params;
    const body = await parseJsonBody(request, CloneAgentSchema);
    const repository = await getSeededRepository();
    const source = await repository.getAgent(id);

    if (!source || (!source.isBuiltIn && source.userId !== principal.userId)) {
      return authenticatedJson({ error: "Source agent not found" }, { status: 404 });
    }

    const now = nowIso();
    const cloned = AgentDefinitionSchema.parse({
      ...source,
      id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      userId: principal.userId,
      name: body.name,
      displayName: body.displayName,
      isBuiltIn: false,
      parentAgentId: source.id,
      version: 1,
      status: "draft",
      createdAt: now,
      updatedAt: now
    });

    const saved = await repository.saveAgent(cloned);

    return authenticatedJson({
      agent: saved,
      dashboard: await repository.getDashboardData(principal.userId)
    });
  } catch (error) {
    return handleApiError(error, "Failed to clone agent.");
  }
}
