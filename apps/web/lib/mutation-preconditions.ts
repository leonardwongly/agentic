import { ApiRouteError } from "./api-response";

function normalizeIfMatchValue(candidate: string): string {
  const trimmed = candidate.trim();

  if (!trimmed || trimmed === "*") {
    throw new ApiRouteError(428, 'Mutating requests must include a concrete If-Match header for the current "updatedAt" value.');
  }

  return trimmed.startsWith("\"") && trimmed.endsWith("\"") ? trimmed.slice(1, -1) : trimmed;
}

export function requireUpdatedAtPrecondition(request: Request, expectedUpdatedAt: string): void {
  const headerValue = request.headers.get("if-match");

  if (!headerValue) {
    throw new ApiRouteError(428, 'Mutating requests must include an If-Match header for the current "updatedAt" value.');
  }

  const actualUpdatedAt = normalizeIfMatchValue(headerValue);

  if (actualUpdatedAt !== expectedUpdatedAt) {
    throw new ApiRouteError(412, "The record changed before this action was applied. Refresh and retry.");
  }
}
