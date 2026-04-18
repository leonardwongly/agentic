import { isDocsRenderJob } from "@agentic/worker-runtime";
import { requireApiSession } from "../../../../../lib/auth";
import { ApiRouteError, authenticatedJson, handleApiError } from "../../../../../lib/api-response";
import { getSeededRepository } from "../../../../../lib/server";

const DOCS_RENDER_SUCCESS_MESSAGE = "Rendered and validated build/agentic.docx.";
const DOCS_RENDER_FAILURE_MESSAGE = "Document build failed. Retry the request or inspect worker logs.";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const principal = await requireApiSession(request);
    const { id } = await context.params;

    if (!id.trim()) {
      throw new ApiRouteError(400, "Document job id is required.");
    }

    const repository = await getSeededRepository();
    const job = await repository.getJob(id, principal.userId);

    if (!isDocsRenderJob(job)) {
      throw new ApiRouteError(404, `Document job ${id} was not found.`);
    }

    const responseBody = {
      job: {
        id: job.id,
        kind: job.kind,
        status: job.status,
        attemptCount: job.attemptCount,
        maxAttempts: job.maxAttempts,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt
      }
    };

    if (job.status === "completed") {
      return authenticatedJson({
        ...responseBody,
        result: {
          message: DOCS_RENDER_SUCCESS_MESSAGE
        },
        error: null
      });
    }

    if (job.status === "dead_letter") {
      return authenticatedJson({
        ...responseBody,
        result: null,
        error: DOCS_RENDER_FAILURE_MESSAGE
      });
    }

    return authenticatedJson(
      {
        ...responseBody,
        result: null,
        error: null
      },
      { status: 202 }
    );
  } catch (error) {
    return handleApiError(error, "Failed to load document job.");
  }
}
