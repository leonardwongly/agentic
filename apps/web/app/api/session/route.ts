import { NextResponse } from "next/server";
import { z } from "zod";
import { isContentTypeError, requireJsonContentType } from "../../../lib/api-errors";
import { AGENTIC_SESSION_COOKIE, checkSessionRateLimit, clearSessionCookie, createSessionCookie, getAuthMode, recordSessionSuccess, revokeSessionToken, verifyAccessKey } from "../../../lib/auth";

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
      return NextResponse.json(
        {
          error: "AGENTIC_ACCESS_KEY is not configured."
        },
        { status: 503 }
      );
    }

    const body = SessionRequestSchema.parse(await request.json());

    if (!verifyAccessKey(body.accessKey)) {
      return NextResponse.json({ error: "The supplied access key was rejected." }, { status: 401 });
    }

    recordSessionSuccess(rateLimitKey);

    const response = NextResponse.json({
      ok: true
    });
    const cookie = createSessionCookie();

    response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  } catch (error) {
    if (isContentTypeError(error)) {
      return NextResponse.json({ error: (error as Error).message }, { status: 415 });
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to create a session."
      },
      { status: 400 }
    );
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

  const response = NextResponse.json({ ok: true });
  const cookie = clearSessionCookie();

  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}
