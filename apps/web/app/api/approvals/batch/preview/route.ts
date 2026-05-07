import { authenticatedJson } from "../../../../../lib/api-response";
import { createGovernedMutationRoute } from "../../../../../lib/governed-route";
import {
  ApprovalBatchPreviewRequestSchema,
  buildApprovalBatchPreview
} from "../../../../../lib/approval-batches";
import { getSeededRepository } from "../../../../../lib/server";

export const POST = createGovernedMutationRoute(
  {
    route: "api.approvals.batch.preview",
    fallbackError: "Failed to preview approval batch.",
    bodySchema: ApprovalBatchPreviewRequestSchema,
    rateLimit: {
      namespace: "approval-batch-preview",
      error: "Too many approval batch preview requests. Try again later."
    }
  },
  async ({ principal, body }) => {
    const repository = await getSeededRepository();
    const preview = await buildApprovalBatchPreview({
      repository,
      userId: principal.userId,
      request: body
    });

    return authenticatedJson({ preview });
  }
);
