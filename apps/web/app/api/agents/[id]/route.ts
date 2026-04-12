import { z } from "zod";
import {
  AgentCategorySchema,
  AgentDefinitionSchema,
  AgentStatusSchema,
  ArtifactTypeSchema,
  CapabilitySchema,
  RiskClassSchema,
  nowIso
} from "@agentic/contracts";
import { requireApiSession } from "../../../../lib/auth";
import { authenticatedJson, handleApiError, parseJsonBody } from "../../../../lib/api-response";
import { getSeededRepository } from "../../../../lib/server";

type RouteParams = { params: Promise<{ id: string }> };

const UpdateAgentSchema = z
  .object({
    displayName: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).optional(),
    icon: z.string().max(50).optional(),
    category: AgentCategorySchema.optional(),
    tags: z.array(z.string().max(32)).max(10).optional(),
    systemPrompt: z.string().min(10).max(8000).optional(),
    artifactType: ArtifactTypeSchema.optional(),
    behaviorConfig: z
      .object({
        temperature: z.number().min(0).max(2).optional(),
        maxTokens: z.number().int().min(100).max(8000).optional(),
        topP: z.number().min(0).max(1).optional(),
        frequencyPenalty: z.number().min(-2).max(2).optional(),
        presencePenalty: z.number().min(-2).max(2).optional(),
        responseStyle: z.enum(["concise", "detailed", "balanced"]).optional(),
        formality: z.enum(["casual", "professional", "formal"]).optional()
      })
      .optional(),
    allowedCapabilities: z.array(CapabilitySchema).optional(),
    blockedCapabilities: z.array(CapabilitySchema).optional(),
    maxRiskClass: RiskClassSchema.optional(),
    status: AgentStatusSchema.optional()
  })
  .strict();

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const principal = await requireApiSession(request);
    const { id } = await params;
    const repository = await getSeededRepository();
    const agent = await repository.getAgent(id);

    if (!agent || (!agent.isBuiltIn && agent.userId !== principal.userId)) {
      return authenticatedJson({ error: "Agent not found" }, { status: 404 });
    }

    return authenticatedJson({ agent });
  } catch (error) {
    return handleApiError(error, "Failed to get agent.");
  }
}

export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const principal = await requireApiSession(request);
    const { id } = await params;
    const body = await parseJsonBody(request, UpdateAgentSchema);
    const repository = await getSeededRepository();
    const existing = await repository.getAgent(id);

    if (!existing || (!existing.isBuiltIn && existing.userId !== principal.userId)) {
      return authenticatedJson({ error: "Agent not found" }, { status: 404 });
    }

    if (existing.isBuiltIn) {
      return authenticatedJson({ error: "Cannot modify a built-in agent" }, { status: 403 });
    }

    const updated = AgentDefinitionSchema.parse({
      ...existing,
      displayName: body.displayName ?? existing.displayName,
      description: body.description ?? existing.description,
      icon: body.icon ?? existing.icon,
      category: body.category ?? existing.category,
      tags: body.tags ?? existing.tags,
      systemPrompt: body.systemPrompt ?? existing.systemPrompt,
      artifactType: body.artifactType ?? existing.artifactType,
      behaviorConfig: body.behaviorConfig
        ? { ...existing.behaviorConfig, ...body.behaviorConfig }
        : existing.behaviorConfig,
      allowedCapabilities: body.allowedCapabilities ?? existing.allowedCapabilities,
      blockedCapabilities: body.blockedCapabilities ?? existing.blockedCapabilities,
      maxRiskClass: body.maxRiskClass ?? existing.maxRiskClass,
      status: body.status ?? existing.status,
      version: existing.version + 1,
      updatedAt: nowIso()
    });

    const saved = await repository.saveAgent(updated);

    return authenticatedJson({
      agent: saved,
      dashboard: await repository.getDashboardData(principal.userId)
    });
  } catch (error) {
    return handleApiError(error, "Failed to update agent.");
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const principal = await requireApiSession(request);
    const { id } = await params;
    const repository = await getSeededRepository();
    const existing = await repository.getAgent(id);

    if (!existing || (!existing.isBuiltIn && existing.userId !== principal.userId)) {
      return authenticatedJson({ error: "Agent not found" }, { status: 404 });
    }

    if (existing.isBuiltIn) {
      return authenticatedJson({ error: "Cannot delete a built-in agent" }, { status: 403 });
    }

    await repository.deleteAgent(id);

    return authenticatedJson({
      success: true,
      dashboard: await repository.getDashboardData(principal.userId)
    });
  } catch (error) {
    return handleApiError(error, "Failed to delete agent.");
  }
}
