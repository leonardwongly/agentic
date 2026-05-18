import { AgentExportSchema, nowIso } from "@agentic/contracts";
import { requireApiSession } from "../../../../../lib/auth";
import { authenticatedJson, authenticatedResponse, handleApiError } from "../../../../../lib/api-response";
import { getSeededRepository } from "../../../../../lib/server";

type RouteParams = { params: Promise<{ id: string }> };

function buildAgentExportFileName(name: string): string {
  const safeName = name.trim().replace(/[^\w.-]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 80);
  return `${safeName || "agent"}.agent.json`;
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

    const exportData = AgentExportSchema.parse({
      version: 1,
      exportedAt: nowIso(),
      agent: {
        id: agent.id,
        name: agent.name,
        displayName: agent.displayName,
        description: agent.description,
        icon: agent.icon,
        category: agent.category,
        tags: agent.tags,
        systemPrompt: agent.systemPrompt,
        promptVariables: agent.promptVariables,
        artifactType: agent.artifactType,
        behaviorConfig: agent.behaviorConfig,
        allowedCapabilities: agent.allowedCapabilities,
        blockedCapabilities: agent.blockedCapabilities,
        maxRiskClass: agent.maxRiskClass,
        parentAgentId: agent.parentAgentId,
        version: agent.version,
        status: agent.status
      },
      metadata: {
        exportedBy: "agentic-user",
        sourceVersion: "1.0.0",
        description: agent.description,
        tags: agent.tags,
        usageHints: []
      }
    });

    return authenticatedResponse(JSON.stringify(exportData, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${buildAgentExportFileName(agent.name)}"`
      }
    });
  } catch (error) {
    return handleApiError(error, "Failed to export agent.");
  }
}
