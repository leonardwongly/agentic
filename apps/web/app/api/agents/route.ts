import { z } from "zod";
import {
  AgentCategorySchema,
  AgentDefinitionSchema,
  AgentStatusSchema,
  ArtifactTypeSchema,
  CapabilitySchema,
  RiskClassSchema,
  SYSTEM_USER_ID,
  nowIso
} from "@agentic/contracts";
import { requireApiSession } from "../../../lib/auth";
import { authenticatedJson, handleApiError, parseJsonBody } from "../../../lib/api-response";
import { getSeededRepository } from "../../../lib/server";

const CreateAgentSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z][a-z0-9-]*$/, "Name must be lowercase alphanumeric with hyphens"),
    displayName: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).optional(),
    icon: z.string().max(50).optional(),
    category: AgentCategorySchema.optional(),
    tags: z.array(z.string().max(32)).max(10).optional(),
    systemPrompt: z.string().min(10).max(8000),
    artifactType: ArtifactTypeSchema.optional(),
    behaviorConfig: z
      .object({
        temperature: z.number().min(0).max(2).optional(),
        maxTokens: z.number().int().min(100).max(8000).optional(),
        responseStyle: z.enum(["concise", "detailed", "balanced"]).optional(),
        formality: z.enum(["casual", "professional", "formal"]).optional()
      })
      .optional(),
    allowedCapabilities: z.array(CapabilitySchema).optional(),
    blockedCapabilities: z.array(CapabilitySchema).optional(),
    maxRiskClass: RiskClassSchema.optional(),
    parentAgentId: z.string().nullable().optional()
  })
  .strict();

export async function GET(request: Request) {
  try {
    await requireApiSession(request);
    const repository = await getSeededRepository();

    return authenticatedJson({
      agents: await repository.listAgents(SYSTEM_USER_ID)
    });
  } catch (error) {
    return handleApiError(error, "Failed to list agents.");
  }
}

export async function POST(request: Request) {
  try {
    await requireApiSession(request);
    const body = await parseJsonBody(request, CreateAgentSchema);
    const repository = await getSeededRepository();

    const now = nowIso();
    const agent = AgentDefinitionSchema.parse({
      id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      userId: SYSTEM_USER_ID,
      name: body.name,
      displayName: body.displayName,
      description: body.description ?? "",
      icon: body.icon ?? "🤖",
      category: body.category ?? "custom",
      tags: body.tags ?? [],
      systemPrompt: body.systemPrompt,
      promptVariables: [],
      artifactType: body.artifactType ?? "summary",
      behaviorConfig: {
        temperature: body.behaviorConfig?.temperature ?? 0.7,
        maxTokens: body.behaviorConfig?.maxTokens ?? 1500,
        topP: 1,
        frequencyPenalty: 0,
        presencePenalty: 0,
        responseStyle: body.behaviorConfig?.responseStyle ?? "balanced",
        formality: body.behaviorConfig?.formality ?? "professional"
      },
      allowedCapabilities: body.allowedCapabilities ?? ["read", "search"],
      blockedCapabilities: body.blockedCapabilities ?? [],
      maxRiskClass: body.maxRiskClass ?? "R2",
      integrationPermissions: [],
      memoryPermissions: [],
      isBuiltIn: false,
      parentAgentId: body.parentAgentId ?? null,
      version: 1,
      status: "active",
      createdAt: now,
      updatedAt: now
    });

    const saved = await repository.saveAgent(agent);

    return authenticatedJson({
      agent: saved,
      dashboard: await repository.getDashboardData(SYSTEM_USER_ID)
    });
  } catch (error) {
    return handleApiError(error, "Failed to create agent.");
  }
}
