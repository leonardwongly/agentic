import { z } from "zod";
import { SYSTEM_USER_ID } from "@agentic/contracts";
import { requireApiSession } from "../../../../lib/auth";
import { authenticatedJson, handleApiError, parseJsonBody } from "../../../../lib/api-response";

// Import shared storage (in real implementation, this would be in repository)
// For now, we'll use a simple approach
const workflowTemplates = new Map<string, {
  id: string;
  userId: string;
  name: string;
  description: string;
  nodes: unknown[];
  edges: unknown[];
  triggers: unknown[];
  createdAt: string;
  updatedAt: string;
}>();

const WorkflowTemplateUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  nodes: z.array(z.unknown()).optional(),
  edges: z.array(z.unknown()).optional(),
  triggers: z.array(z.unknown()).optional()
});

type Params = Promise<{ id: string }>;

export async function GET(request: Request, { params }: { params: Params }) {
  try {
    await requireApiSession(request);
    const { id } = await params;

    const template = workflowTemplates.get(id);
    
    if (!template) {
      return authenticatedJson({ error: "Workflow template not found" }, { status: 404 });
    }

    if (template.userId !== SYSTEM_USER_ID) {
      return authenticatedJson({ error: "Access denied" }, { status: 403 });
    }

    return authenticatedJson({ template });
  } catch (error) {
    return handleApiError(error, "Failed to get workflow template.");
  }
}

export async function PUT(request: Request, { params }: { params: Params }) {
  try {
    await requireApiSession(request);
    const { id } = await params;
    const body = await parseJsonBody(request, WorkflowTemplateUpdateSchema);

    const template = workflowTemplates.get(id);
    
    if (!template) {
      return authenticatedJson({ error: "Workflow template not found" }, { status: 404 });
    }

    if (template.userId !== SYSTEM_USER_ID) {
      return authenticatedJson({ error: "Access denied" }, { status: 403 });
    }

    const updated = {
      ...template,
      ...body,
      updatedAt: new Date().toISOString()
    };

    workflowTemplates.set(id, updated);

    return authenticatedJson({ template: updated });
  } catch (error) {
    return handleApiError(error, "Failed to update workflow template.");
  }
}

export async function DELETE(request: Request, { params }: { params: Params }) {
  try {
    await requireApiSession(request);
    const { id } = await params;

    const template = workflowTemplates.get(id);
    
    if (!template) {
      return authenticatedJson({ error: "Workflow template not found" }, { status: 404 });
    }

    if (template.userId !== SYSTEM_USER_ID) {
      return authenticatedJson({ error: "Access denied" }, { status: 403 });
    }

    workflowTemplates.delete(id);

    return authenticatedJson({ success: true });
  } catch (error) {
    return handleApiError(error, "Failed to delete workflow template.");
  }
}
