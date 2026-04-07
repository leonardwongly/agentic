import { z } from "zod";
import { AGENTIC_SESSION_COOKIE, clearSessionCookie, createSessionCookie, getAuthMode, revokeSessionToken, verifyAccessKey } from "../../../lib/auth";
import { authenticatedError, authenticatedJson, handleApiError, parseJsonBody } from "../../../lib/api-response";
import {
  clearFailedSessionUnlockAttempts,
  getSessionUnlockRateLimitStatus,
  recordFailedSessionUnlockAttempt
} from "../../../lib/session-unlock-rate-limit";

const SessionRequestSchema = z
  .object({
    accessKey: z.string().trim().min(1).max(256)
  })
  .strict();

export async function POST(request: Request) {
  try {
    requireJsonContentType(request);

    const rateLimitKey = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "unknown";
    const rateLimit = checkSessionRateLimit(rateLimitKey);

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many login attempts. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000)) }
        }
      );
    }

    const authMode = getAuthMode();

    if (authMode.requiresConfiguredKey) {
      return authenticatedError(503, "AGENTIC_ACCESS_KEY is not configured.");
    }

    const rateLimitStatus = getSessionUnlockRateLimitStatus(request);

    if (rateLimitStatus.throttled) {
      return authenticatedJson(
        {
          error: "Too many failed unlock attempts. Try again later."
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimitStatus.retryAfterSeconds)
          }
        }
      );
    }

    const body = await parseJsonBody(request, SessionRequestSchema);

    if (!verifyAccessKey(body.accessKey)) {
      const failureStatus = recordFailedSessionUnlockAttempt(request);

      if (failureStatus.throttled) {
        return authenticatedJson(
          {
            error: "Too many failed unlock attempts. Try again later."
          },
          {
            status: 429,
            headers: {
              "Retry-After": String(failureStatus.retryAfterSeconds)
            }
          }
        );
      }

      return authenticatedError(401, "The supplied access key was rejected.");
    }

    clearFailedSessionUnlockAttempts(request);

    const response = authenticatedJson({
      ok: true
    });
    const cookie = createSessionCookie();

    response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  } catch (error) {
    return handleApiError(error, "Failed to create a session.");
  }
}

export async function DELETE(request: Request) {
  const existingToken = request.headers.get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${AGENTIC_SESSION_COOKIE}=`))
    ?.slice(AGENTIC_SESSION_COOKIE.length + 1);

  if (existingToken) {
    revokeSessionToken(existingToken);
  }

  const response = authenticatedJson({ ok: true });
  const cookie = clearSessionCookie();

  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}
