import { z } from "zod";
import {
  DEFAULT_COMMITMENT_INBOX_BUCKET,
  DEFAULT_COMMITMENT_INBOX_LIMIT,
  MAX_COMMITMENT_INBOX_LIMIT,
  commitmentInboxBucketValues
} from "@agentic/contracts";
import { CommitmentInboxQueryError } from "@agentic/repository";
import { requireApiSession } from "../../../lib/auth";
import { ApiRouteError, authenticatedJson, handleApiError } from "../../../lib/api-response";
import { getSeededRepository } from "../../../lib/server";

const CommitmentInboxQuerySchema = z
  .object({
    bucket: z.enum(commitmentInboxBucketValues).default(DEFAULT_COMMITMENT_INBOX_BUCKET),
    limit: z.coerce.number().int().min(1).max(MAX_COMMITMENT_INBOX_LIMIT).default(DEFAULT_COMMITMENT_INBOX_LIMIT),
    cursor: z.string().trim().min(1).max(200).nullable().default(null)
  })
  .strict();

export async function GET(request: Request) {
  try {
    const principal = await requireApiSession(request);
    const repository = await getSeededRepository();
    const url = new URL(request.url);
    const query = CommitmentInboxQuerySchema.parse({
      bucket: url.searchParams.get("bucket") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      cursor: url.searchParams.get("cursor")
    });

    return authenticatedJson({
      inbox: await repository.listCommitmentInbox({
        userId: principal.userId,
        bucket: query.bucket,
        limit: query.limit,
        cursor: query.cursor
      })
    });
  } catch (error) {
    if (error instanceof CommitmentInboxQueryError) {
      return handleApiError(new ApiRouteError(400, error.message), "Failed to load commitments inbox.");
    }

    return handleApiError(error, "Failed to load commitments inbox.");
  }
}
