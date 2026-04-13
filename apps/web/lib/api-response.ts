import { NextResponse } from "next/server";
import { z } from "zod";
import { formatValidationError, isContentTypeError } from "./api-errors";
import { isAuthError } from "./auth";
import { AuthRuntimeStateConfigurationError } from "./auth-runtime-state";
import { SharedAuthStateStoreError } from "./shared-auth-state-db";

export const AUTHENTICATED_API_CACHE_CONTROL = "private, no-store, max-age=0, must-revalidate";

const JSON_CONTENT_TYPE_PREFIX = "application/json";

export class ApiRouteError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiRouteError";
  }
}

function mergeHeaders(init?: ResponseInit, additionalHeaders?: HeadersInit): Headers {
  const headers = new Headers(init?.headers);

  for (const [key, value] of new Headers(additionalHeaders).entries()) {
    headers.set(key, value);
  }

  return headers;
}

export function authenticatedJson<T>(body: T, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: mergeHeaders(init, {
      "Cache-Control": AUTHENTICATED_API_CACHE_CONTROL,
      Pragma: "no-cache",
      Expires: "0",
      Vary: "Cookie, X-Agentic-Access-Key"
    })
  });
}

export function authenticatedError(status: number, error: string) {
  return authenticatedJson({ error }, { status });
}

export async function parseJsonBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (!contentType.startsWith(JSON_CONTENT_TYPE_PREFIX)) {
    throw new ApiRouteError(415, "Content-Type must be application/json.");
  }

  let parsedBody: unknown;

  try {
    parsedBody = await request.json();
  } catch {
    throw new ApiRouteError(400, "Request body must be valid JSON.");
  }

  return schema.parse(parsedBody);
}

export function handleApiError(error: unknown, fallbackMessage: string) {
  if (isAuthError(error)) {
    return authenticatedError(401, error.message);
  }

  if (error instanceof AuthRuntimeStateConfigurationError) {
    return authenticatedError(503, error.message);
  }

  if (error instanceof SharedAuthStateStoreError) {
    return authenticatedError(503, error.message);
  }

  if (error instanceof z.ZodError) {
    return authenticatedError(400, formatValidationError(error));
  }

  if (error instanceof ApiRouteError) {
    return authenticatedError(error.status, error.message);
  }

  if (isContentTypeError(error)) {
    return authenticatedError(415, "Content-Type must be application/json.");
  }

  console.error(fallbackMessage, error);
  return authenticatedError(500, fallbackMessage);
}
