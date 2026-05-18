import crypto from "node:crypto";
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

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

export function deriveIdempotencyKey(params: {
  namespace: string;
  userId: string;
  method: string;
  pathname: string;
  payload: unknown;
}): string {
  if (!/^[A-Za-z0-9:_-]{1,80}$/u.test(params.namespace)) {
    throw new ApiRouteError(500, "Invalid idempotency namespace.");
  }

  const digest = crypto
    .createHash("sha256")
    .update(stableJson({
      method: params.method.toUpperCase(),
      pathname: params.pathname,
      payload: params.payload,
      userId: params.userId
    }))
    .digest("base64url")
    .slice(0, 32);

  return `${params.namespace}:${digest}`;
}

export function parseOrDeriveIdempotencyKey(request: Request, params: {
  namespace: string;
  userId: string;
  payload: unknown;
}): string {
  const supplied = parseIdempotencyKey(request);

  if (supplied) {
    return supplied;
  }

  const url = new URL(request.url);
  return deriveIdempotencyKey({
    namespace: params.namespace,
    userId: params.userId,
    method: request.method,
    pathname: url.pathname,
    payload: params.payload
  });
}
