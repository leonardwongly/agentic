import { ApiRouteError } from "./api-response";

export const IDEMPOTENCY_KEY_HEADER = "x-idempotency-key";

export function parseIdempotencyKey(request: Request): string | null {
  const candidate = request.headers.get(IDEMPOTENCY_KEY_HEADER)?.trim() ?? "";

  if (!candidate) {
    return null;
  }

  if (!/^[A-Za-z0-9:_-]{1,200}$/u.test(candidate)) {
    throw new ApiRouteError(400, `${IDEMPOTENCY_KEY_HEADER} must be 1-200 URL-safe characters.`);
  }

  return candidate;
}
