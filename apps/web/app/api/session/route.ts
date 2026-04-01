import { NextResponse } from "next/server";
import { z } from "zod";
import { clearSessionCookie, createSessionCookie, getAuthMode, verifyAccessKey } from "../../../lib/auth";

const SessionRequestSchema = z
  .object({
    accessKey: z.string().trim().min(1).max(256)
  })
  .strict();

export async function POST(request: Request) {
  try {
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

    const response = NextResponse.json({
      ok: true
    });
    const cookie = createSessionCookie();

    response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to create a session."
      },
      { status: 400 }
    );
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  const cookie = clearSessionCookie();

  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}
