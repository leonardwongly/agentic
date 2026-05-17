import { NextResponse } from "next/server";
import { z } from "zod";
import {
  appendCorrelationHeaders,
  getOrCreateRequestId,
  getOrCreateTraceId,
  getParentSpanId,
  getTelemetryContext,
  logError,
  logInfo,
  recordCounter,
  recordHistogram,
  withSpan,
  withTelemetryContext
} from "@agentic/observability";
import { formatValidationError, isContentTypeError } from "./api-errors";
import { isAuthError } from "./auth";
import { AuthRuntimeStateConfigurationError } from "./auth-runtime-state";
import { applyBaseSecurityHeaders } from "./security-headers";
import { SharedAuthStateStoreError } from "./shared-auth-state-db";

export const AUTHENTICATED_API_CACHE_CONTROL = "private, no-store, max-age=0, must-revalidate";
export const OPERATIONAL_API_CACHE_CONTROL = "no-store, max-age=0, must-revalidate";

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

function mergeApiHeaders(init?: ResponseInit, additionalHeaders?: HeadersInit): Headers {
  return applyBaseSecurityHeaders(mergeHeaders(init, additionalHeaders));
}

export function authenticatedJson<T>(body: T, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: appendCorrelationHeaders(mergeApiHeaders(init, {
      "Cache-Control": AUTHENTICATED_API_CACHE_CONTROL,
      Pragma: "no-cache",
      Expires: "0",
      Vary: "Cookie, X-Agentic-Access-Key"
    }))
  });
}

export function operationalJson<T>(body: T, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: appendCorrelationHeaders(mergeApiHeaders(init, {
      "Cache-Control": OPERATIONAL_API_CACHE_CONTROL,
      Pragma: "no-cache",
      Expires: "0"
    }))
  });
}

export function authenticatedRedirect(url: string | URL, init?: ResponseInit & { status?: number }) {
  return NextResponse.redirect(url, {
    ...init,
    headers: appendCorrelationHeaders(mergeApiHeaders(init, {
      "Cache-Control": AUTHENTICATED_API_CACHE_CONTROL,
      Pragma: "no-cache",
      Expires: "0",
      Vary: "Cookie, X-Agentic-Access-Key"
    }))
  });
}

export function authenticatedResponse(body?: BodyInit | null, init?: ResponseInit) {
  return new Response(body, {
    ...init,
    headers: appendCorrelationHeaders(mergeApiHeaders(init, {
      "Cache-Control": AUTHENTICATED_API_CACHE_CONTROL,
      Pragma: "no-cache",
      Expires: "0",
      Vary: "Cookie, X-Agentic-Access-Key"
    }))
  });
}

export function operationalResponse(body?: BodyInit | null, init?: ResponseInit) {
  return new Response(body, {
    ...init,
    headers: appendCorrelationHeaders(mergeApiHeaders(init, {
      "Cache-Control": OPERATIONAL_API_CACHE_CONTROL,
      Pragma: "no-cache",
      Expires: "0"
    }))
  });
}

export function authenticatedError(status: number, error: string) {
  return authenticatedJson({ error }, { status });
}

export function operationalError(status: number, error: string) {
  return operationalJson({ error }, { status });
}

export function authenticatedRateLimitError(error: string, retryAfterSeconds: number) {
  return authenticatedJson(
    { error },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds)
      }
    }
  );
}

export function operationalRateLimitResponse<T>(body: T, retryAfterSeconds: number, init?: ResponseInit) {
  return operationalJson(body, {
    ...init,
    headers: mergeHeaders(init, {
      "Retry-After": String(retryAfterSeconds)
    })
  });
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

  logError("api.request.unhandled_error", error, {
    fallbackMessage
  });
  return authenticatedError(500, fallbackMessage);
}

export function handleOperationalApiError(error: unknown, fallbackMessage: string) {
  if (error instanceof z.ZodError) {
    return operationalError(400, formatValidationError(error));
  }

  if (error instanceof ApiRouteError) {
    return operationalError(error.status, error.message);
  }

  if (isContentTypeError(error)) {
    return operationalError(415, "Content-Type must be application/json.");
  }

  logError("api.request.unhandled_error", error, {
    fallbackMessage
  });
  return operationalError(500, fallbackMessage);
}

type ApiTelemetryHandler = () => Promise<Response> | Response;

export async function withApiTelemetry(
  request: Request,
  route: string,
  handler: ApiTelemetryHandler
): Promise<Response> {
  const url = new URL(request.url);
  const started = Date.now();

  return withTelemetryContext(
    {
      requestId: getOrCreateRequestId(request.headers.get("x-request-id")),
      traceId: getOrCreateTraceId(request.headers.get("x-trace-id")),
      parentSpanId: getParentSpanId(request.headers.get("x-parent-span-id")),
      route,
      method: request.method,
      path: url.pathname
    },
    async () =>
      withSpan(
        "http.request",
        {
          route,
          method: request.method,
          path: url.pathname
        },
        async () => {
          logInfo("api.request.started", {
            route,
            method: request.method,
            path: url.pathname
          });

          const response = await handler();
          const durationMs = Math.max(0, Date.now() - started);
          const headers = applyBaseSecurityHeaders(appendCorrelationHeaders(response.headers));
          const finalized = new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers
          });
          const requestId = getTelemetryContext()?.requestId ?? null;

          recordCounter("http.request.total", 1, {
            route,
            method: request.method,
            path: url.pathname,
            statusCode: finalized.status,
            statusClass: `${Math.floor(finalized.status / 100)}xx`,
            outcome: finalized.status >= 500 ? "error" : "ok"
          });
          recordHistogram("http.request.duration_ms", durationMs, {
            route,
            method: request.method,
            path: url.pathname,
            statusCode: finalized.status,
            statusClass: `${Math.floor(finalized.status / 100)}xx`,
            outcome: finalized.status >= 500 ? "error" : "ok"
          });

          if (finalized.status >= 500) {
            logError("api.request.completed_with_server_error", undefined, {
              route,
              method: request.method,
              path: url.pathname,
              statusCode: finalized.status,
              durationMs,
              requestId
            });
          } else {
            logInfo("api.request.completed", {
              route,
              method: request.method,
              path: url.pathname,
              statusCode: finalized.status,
              durationMs,
              requestId
            });
          }

          return finalized;
        }
      )
  );
}
