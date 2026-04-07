import { z } from "zod";
import { SYSTEM_USER_ID } from "@agentic/contracts";
import { requireApiSession } from "../../../lib/auth";
import { authenticatedJson, handleApiError, parseJsonBody } from "../../../lib/api-response";
import { getSeededRepository } from "../../../lib/server";

// Workflow template schemas
const WorkflowNodeSchema = z.object({
  id: z.string(),
  type: z.enum(["agent", "trigger", "condition", "action", "output"]),
  agentId: z.string().optional(),
  label: z.string(),
  icon: z.string(),
  position: z.object({
    x: z.number(),
    y: z.number()
  }),
  config: z.record(z.string(), z.unknown()).default({})
});

const WorkflowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string().optional(),
  condition: z.string().optional()
});

const WorkflowTriggerSchema = z.object({
  type: z.string(),
  config: z.record(z.string(), z.unknown()).default({})
});

const WorkflowTemplateCreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).default(""),
  nodes: z.array(WorkflowNodeSchema).default([]),
  edges: z.array(WorkflowEdgeSchema).default([]),
  triggers: z.array(WorkflowTriggerSchema).default([])
});

export type WorkflowTemplate = {
  id: string;
  userId: string;
  name: string;
  description: string;
  nodes: z.infer<typeof WorkflowNodeSchema>[];
  edges: z.infer<typeof WorkflowEdgeSchema>[];
  triggers: z.infer<typeof WorkflowTriggerSchema>[];
  createdAt: string;
  updatedAt: string;
};

// In-memory storage for workflow templates (since repository doesn't have this yet)
const workflowTemplates = new Map<string, WorkflowTemplate>();

export async function GET(request: Request) {
  try {
    await requireApiSession(request);
    
    const templates = Array.from(workflowTemplates.values())
      .filter(t => t.userId === SYSTEM_USER_ID)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return authenticatedJson({ templates });
  } catch (error) {
    return handleApiError(error, "Failed to list workflow templates.");
  }
}

export async function POST(request: Request) {
  try {
    await requireApiSession(request);
    const body = await parseJsonBody(request, WorkflowTemplateCreateSchema);

    const now = new Date().toISOString();
    const template: WorkflowTemplate = {
      id: `workflow-${crypto.randomUUID()}`,
      userId: SYSTEM_USER_ID,
      name: body.name,
      description: body.description,
      nodes: body.nodes,
      edges: body.edges,
      triggers: body.triggers,
      createdAt: now,
      updatedAt: now
    };

    workflowTemplates.set(template.id, template);

    return authenticatedJson({ template }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "Failed to create workflow template.");
  }
}
