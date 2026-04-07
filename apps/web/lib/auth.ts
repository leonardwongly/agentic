import crypto from "node:crypto";
import { cookies } from "next/headers";
import { SYSTEM_USER_ID } from "@agentic/contracts";

// ---------------------------------------------------------------------------
// Rate limiting for the session endpoint
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute sliding window
const RATE_LIMIT_MAX_ATTEMPTS = 10; // attempts before lockout
const RATE_LIMIT_LOCKOUT_MS = 5 * 60_000; // 5 minute lockout

type RateLimitEntry = {
  attempts: number;
  windowStart: number;
  lockedUntil: number | null;
};

const rateLimitStore = new Map<string, RateLimitEntry>();

export function checkSessionRateLimit(key: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(key) ?? { attempts: 0, windowStart: now, lockedUntil: null };

  if (entry.lockedUntil !== null) {
    if (now < entry.lockedUntil) {
      return { allowed: false, retryAfterMs: entry.lockedUntil - now };
    }
    // lockout expired — reset
    entry.attempts = 0;
    entry.windowStart = now;
    entry.lockedUntil = null;
  }

  if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry.attempts = 0;
    entry.windowStart = now;
  }

  entry.attempts += 1;
  rateLimitStore.set(key, entry);

  if (entry.attempts > RATE_LIMIT_MAX_ATTEMPTS) {
    entry.lockedUntil = now + RATE_LIMIT_LOCKOUT_MS;
    rateLimitStore.set(key, entry);
    return { allowed: false, retryAfterMs: RATE_LIMIT_LOCKOUT_MS };
  }

  return { allowed: true, retryAfterMs: 0 };
}

export function recordSessionSuccess(key: string): void {
  rateLimitStore.delete(key);
}

// ---------------------------------------------------------------------------
// Server-side session revocation
// ---------------------------------------------------------------------------

const revokedTokens = new Set<string>();

export function revokeSessionToken(token: string): void {
  revokedTokens.add(token);
}

export function isSessionTokenRevoked(token: string): boolean {
  return revokedTokens.has(token);
}

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

let _devKeyWarningEmitted = false;

function resolveAccessKey(): { key: string | null; source: "env" | "development-fallback" | "missing" } {
  const configured = process.env.AGENTIC_ACCESS_KEY?.trim();

  if (configured) {
    return { key: configured, source: "env" };
  }

  if (process.env.NODE_ENV !== "production") {
    if (!_devKeyWarningEmitted) {
      console.warn(
        "[agentic] SECURITY WARNING: AGENTIC_ACCESS_KEY is not set. " +
          "Using the well-known development fallback key. " +
          "Do not expose this instance to external networks."
      );
      _devKeyWarningEmitted = true;
    }
    return { key: "agentic-local-dev-key", source: "development-fallback" };
  }

  return { key: null, source: "missing" };
}

function deriveSessionToken(secret: string, userId = SYSTEM_USER_ID): string {
  return crypto.createHmac("sha256", secret).update(`${userId}:agentic-session-v1`).digest("hex");
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

  if (isSessionTokenRevoked(token)) {
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
