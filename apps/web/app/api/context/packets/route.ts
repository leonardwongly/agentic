import { z } from "zod";
import { agentNameValues } from "@agentic/contracts";
import {
  buildContextPacketFromMemory,
  createMemoryRecord,
  queryContextPackets
} from "@agentic/memory";
import { requireApiSession } from "../../../../lib/auth";
import { authenticatedJson, handleApiError, parseJsonBody } from "../../../../lib/api-response";
import { requireJsonContentType } from "../../../../lib/api-errors";
import { createActorContextFromPrincipal } from "../../../../lib/actor-context";
import { getSeededRepository } from "../../../../lib/server";

const QueryAgentSchema = z.enum(agentNameValues);

const CreateContextPacketSchema = z
  .object({
    category: z.string().trim().min(1).max(64),
    content: z.string().trim().min(1).max(1_000),
    memoryType: z.enum(["observed", "inferred", "confirmed"]).default("observed"),
    confidence: z.number().min(0).max(1).optional(),
    source: z.string().trim().min(1).max(80).default("api"),
    sensitivity: z.string().trim().min(1).max(80).default("internal"),
    permissions: z.array(QueryAgentSchema).max(8).default(["orchestrator", "knowledge", "workflow"]),
    reviewAt: z.string().datetime().nullable().optional(),
    expiryAt: z.string().datetime().nullable().optional(),
    consentBasis: z.enum(["explicit", "implied", "system", "derived"]).default("explicit")
  })
  .strict();

function parseCsv(values: string | null): string[] | undefined {
  const parsed = values
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return parsed && parsed.length > 0 ? parsed : undefined;
}

export async function GET(request: Request) {
  try {
    const principal = await requireApiSession(request);
    const url = new URL(request.url);
    const agent = url.searchParams.get("agent");
    const includeExpired = url.searchParams.get("includeExpired") === "true";
    const limit = url.searchParams.get("limit");
    const packets = queryContextPackets(await (await getSeededRepository()).listMemory(principal.userId), {
      userId: principal.userId,
      agent: agent ? QueryAgentSchema.parse(agent) : undefined,
      includeExpired,
      allowedSensitivities: parseCsv(url.searchParams.get("sensitivity")),
      limit: limit ? Number.parseInt(limit, 10) : undefined
    });

    return authenticatedJson({
      packets,
      count: packets.length
    });
  } catch (error) {
    return handleApiError(error, "Failed to list context packets.");
  }
}

export async function POST(request: Request) {
  try {
    requireJsonContentType(request);
    const principal = await requireApiSession(request);
    const body = await parseJsonBody(request, CreateContextPacketSchema);
    const repository = await getSeededRepository();
    const actorContext = createActorContextFromPrincipal(principal);
    const record = createMemoryRecord({
      userId: principal.userId,
      category: body.category,
      memoryType: body.memoryType,
      content: body.content,
      confidence: body.confidence ?? (body.memoryType === "confirmed" ? 0.92 : 0.78),
      source: body.source,
      sensitivity: body.sensitivity,
      permissions: body.permissions,
      actorContext,
      reviewAt: body.reviewAt ?? null,
      expiryAt: body.expiryAt ?? null
    });

    await repository.saveMemory(record);

    return authenticatedJson(
      {
        packet: buildContextPacketFromMemory(record, {
          consent: {
            basis: body.consentBasis,
            grantedBy: principal.userId,
            grantedAt: record.createdAt
          }
        }),
        memoryId: record.id
      },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error, "Failed to create context packet.");
  }
}
