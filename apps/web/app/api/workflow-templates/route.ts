import crypto from "node:crypto";
import {
  WorkflowCanvasTemplateCreateSchema,
  WorkflowCanvasTemplateSchema,
  nowIso
} from "@agentic/contracts";
import { requireApiSession } from "../../../lib/auth";
import { authenticatedJson, handleApiError, parseJsonBody } from "../../../lib/api-response";
import { getSeededRepository } from "../../../lib/server";

export async function GET(request: Request) {
  try {
    const principal = await requireApiSession(request);
    const repository = await getSeededRepository();
    const templates = await repository.listWorkflowTemplates(principal.userId);

    return authenticatedJson({ templates });
  } catch (error) {
    return handleApiError(error, "Failed to list workflow templates.");
  }
}

export async function POST(request: Request) {
  try {
    const principal = await requireApiSession(request);
    const repository = await getSeededRepository();
    const body = await parseJsonBody(request, WorkflowCanvasTemplateCreateSchema);
    const timestamp = nowIso();
    const template = WorkflowCanvasTemplateSchema.parse({
      id: `workflow-${crypto.randomUUID()}`,
      userId: principal.userId,
      ...body,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    await repository.saveWorkflowTemplate(template);

    return authenticatedJson({ template }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "Failed to create workflow template.");
  }
}
