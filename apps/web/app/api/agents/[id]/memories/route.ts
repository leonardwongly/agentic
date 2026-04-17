import { z } from "zod";
import { createMemoryRecord } from "@agentic/memory";
import type { AgenticRepository } from "@agentic/repository";
import { requireApiSession } from "../../../../../lib/auth";
import { createActorContextFromPrincipal } from "../../../../../lib/actor-context";
import { authenticatedJson, handleApiError, parseJsonBody } from "../../../../../lib/api-response";
import { requireJsonContentType } from "../../../../../lib/api-errors";
import { getSeededRepository } from "../../../../../lib/server";

type RouteParams = { params: Promise<{ id: string }> };

const CreateAgentMemorySchema = z
  .object({
    category: z.string().trim().min(1).max(64),
    content: z.string().trim().min(1).max(500),
    memoryType: z.enum(["observed", "inferred", "confirmed"]).optional(),
    agentScope: z.enum(["global", "agent-only", "agent-preferred"]).optional()
  })
  .strict();

type StoredMemories = Awaited<ReturnType<AgenticRepository["listMemory"]>>;

function listAgentMemories(memories: StoredMemories, agentId: string) {
  return memories.filter((memory) => memory.agentId === agentId);
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const principal = await requireApiSession(request);
    const { id } = await params;
    const repository = await getSeededRepository();
    const agent = await repository.getAgent(id, principal.userId);

    if (!agent) {
      return authenticatedJson({ error: "Agent not found" }, { status: 404 });
    }

    const memories = listAgentMemories(await repository.listMemory(principal.userId), agent.id);

    return authenticatedJson({
      agent: {
        id: agent.id,
        name: agent.name,
        displayName: agent.displayName
      },
      memories
    });
  } catch (error) {
    return handleApiError(error, "Failed to list agent memories.");
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    requireJsonContentType(request);
    const principal = await requireApiSession(request);
    const { id } = await params;
    const body = await parseJsonBody(request, CreateAgentMemorySchema);
    const repository = await getSeededRepository();
    const agent = await repository.getAgent(id, principal.userId);

    if (!agent) {
      return authenticatedJson({ error: "Agent not found" }, { status: 404 });
    }

    const actorContext = createActorContextFromPrincipal(principal);
    const memory = createMemoryRecord({
      userId: principal.userId,
      category: body.category,
      memoryType: body.memoryType ?? "observed",
      content: body.content,
      confidence: body.memoryType === "confirmed" ? 0.92 : body.memoryType === "inferred" ? 0.72 : 0.78,
      source: "agent-memory-ui",
      sensitivity: "internal",
      permissions: ["orchestrator", "knowledge", "workflow"],
      actorContext,
      agentId: agent.id,
      agentScope: body.agentScope ?? "agent-only"
    });

    await repository.saveMemory(memory);

    return authenticatedJson({
      agent: {
        id: agent.id,
        name: agent.name,
        displayName: agent.displayName
      },
      memory,
      memories: listAgentMemories(await repository.listMemory(principal.userId), agent.id)
    });
  } catch (error) {
    return handleApiError(error, "Failed to save agent memory.");
  }
}
