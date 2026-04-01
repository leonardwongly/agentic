import crypto from "node:crypto";
import { cookies } from "next/headers";
import { SYSTEM_USER_ID } from "@agentic/contracts";

export const AGENTIC_SESSION_COOKIE = "agentic_session";
export const AGENTIC_ACCESS_KEY_HEADER = "x-agentic-access-key";

class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

function readCookieValue(cookieHeader: string | null | undefined, cookieName: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const segment of cookieHeader.split(";")) {
    const [rawName, ...rawValueParts] = segment.trim().split("=");

    if (rawName !== cookieName) {
      continue;
    }

    return rawValueParts.join("=").trim() || null;
  }

  return null;
}

function resolveAccessKey(): { key: string | null; source: "env" | "development-fallback" | "missing" } {
  const configured = process.env.AGENTIC_ACCESS_KEY?.trim();

  if (configured) {
    return { key: configured, source: "env" };
  }

  if (process.env.NODE_ENV !== "production") {
    return { key: "agentic-local-dev-key", source: "development-fallback" };
  }

  return { key: null, source: "missing" };
}

function deriveSessionToken(secret: string, userId = SYSTEM_USER_ID): string {
  return crypto.createHash("sha256").update(`${userId}:${secret}:agentic-session-v1`).digest("hex");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function getAuthMode() {
  const resolved = resolveAccessKey();

  return {
    requiresConfiguredKey: resolved.source === "missing",
    usesDevelopmentFallback: resolved.source === "development-fallback",
    configured: resolved.source !== "missing"
  };
}

export function verifyAccessKey(candidate: string | null | undefined): boolean {
  const attempted = candidate?.trim();
  const resolved = resolveAccessKey();

  if (!attempted || !resolved.key) {
    return false;
  }

  return constantTimeEqual(attempted, resolved.key);
}

export function buildSessionToken(userId = SYSTEM_USER_ID): string {
  const resolved = resolveAccessKey();

  if (!resolved.key) {
    throw new AuthError("AGENTIC_ACCESS_KEY is not configured for this runtime.");
  }

  return deriveSessionToken(resolved.key, userId);
}

export function isAuthorizedSessionToken(candidate: string | null | undefined, userId = SYSTEM_USER_ID): boolean {
  const resolved = resolveAccessKey();
  const token = candidate?.trim();

  if (!token || !resolved.key) {
    return false;
  }

  return constantTimeEqual(token, deriveSessionToken(resolved.key, userId));
}

export function createSessionCookie(userId = SYSTEM_USER_ID) {
  return {
    name: AGENTIC_SESSION_COOKIE,
    value: buildSessionToken(userId),
    options: {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 12
    }
  };
}

export function clearSessionCookie() {
  return {
    name: AGENTIC_SESSION_COOKIE,
    value: "",
    options: {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0
    }
  };
}

export async function hasActiveSession() {
  const cookieStore = await cookies();
  return isAuthorizedSessionToken(cookieStore.get(AGENTIC_SESSION_COOKIE)?.value);
}

export async function requireApiSession(request?: Request) {
  const headerKey = request?.headers.get(AGENTIC_ACCESS_KEY_HEADER);

  if (verifyAccessKey(headerKey)) {
    return;
  }

  if (request) {
    const sessionToken = readCookieValue(request.headers.get("cookie"), AGENTIC_SESSION_COOKIE);

    if (isAuthorizedSessionToken(sessionToken)) {
      return;
    }

    throw new AuthError("Unauthorized. Create a session before calling the Agentic API.");
  }

  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(AGENTIC_SESSION_COOKIE)?.value;

  if (isAuthorizedSessionToken(sessionToken)) {
    return;
  }

  throw new AuthError("Unauthorized. Create a session before calling the Agentic API.");
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof Error && error.name === "AuthError";
}
