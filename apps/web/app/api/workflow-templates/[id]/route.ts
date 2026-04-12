import { z } from "zod";
import {
  WorkflowCanvasTemplateSchema,
  WorkflowCanvasTemplateUpdateSchema,
  nowIso
} from "@agentic/contracts";
import { requireApiSession } from "../../../../lib/auth";
import { authenticatedJson, handleApiError, parseJsonBody } from "../../../../lib/api-response";
import { getSeededRepository } from "../../../../lib/server";

const TemplateIdSchema = z.string().trim().min(1).max(200);

type Params = Promise<{ id: string }>;

export async function GET(request: Request, { params }: { params: Params }) {
  try {
    const principal = await requireApiSession(request);
    const { id } = await params;
    const repository = await getSeededRepository();
    const template = await repository.getWorkflowTemplate(TemplateIdSchema.parse(id), principal.userId);

    if (!template) {
      return authenticatedJson({ error: "Workflow template not found" }, { status: 404 });
    }

    return authenticatedJson({ template });
  } catch (error) {
    return handleApiError(error, "Failed to get workflow template.");
  }
}

export async function PUT(request: Request, { params }: { params: Params }) {
  try {
    const principal = await requireApiSession(request);
    const { id } = await params;
    const templateId = TemplateIdSchema.parse(id);
    const repository = await getSeededRepository();
    const body = await parseJsonBody(request, WorkflowCanvasTemplateUpdateSchema);
    const template = await repository.getWorkflowTemplate(templateId, principal.userId);

    if (!template) {
      return authenticatedJson({ error: "Workflow template not found" }, { status: 404 });
    }

    const updated = WorkflowCanvasTemplateSchema.parse({
      ...template,
      ...body,
      updatedAt: nowIso()
    });

    await repository.saveWorkflowTemplate(updated);

    return authenticatedJson({ template: updated });
  } catch (error) {
    return handleApiError(error, "Failed to update workflow template.");
  }
}

export async function DELETE(request: Request, { params }: { params: Params }) {
  try {
    const principal = await requireApiSession(request);
    const { id } = await params;
    const templateId = TemplateIdSchema.parse(id);
    const repository = await getSeededRepository();
    const template = await repository.getWorkflowTemplate(templateId, principal.userId);

    if (!template) {
      return authenticatedJson({ error: "Workflow template not found" }, { status: 404 });
    }

    await repository.deleteWorkflowTemplate(templateId, principal.userId);

    return authenticatedJson({ success: true });
  } catch (error) {
    return handleApiError(error, "Failed to delete workflow template.");
  }
}
