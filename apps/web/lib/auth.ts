import crypto from "node:crypto";
import { cookies } from "next/headers";
import { SYSTEM_USER_ID } from "@agentic/contracts";
import { getAuthSessionStateStore, type SessionRateLimitEntry } from "./auth-session-store";

// ---------------------------------------------------------------------------
// Rate limiting for the session endpoint
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute sliding window
const RATE_LIMIT_MAX_ATTEMPTS = 10; // attempts before lockout
const RATE_LIMIT_LOCKOUT_MS = 5 * 60_000; // 5 minute lockout

const SESSION_TTL_SECONDS = 60 * 60 * 12;
const SESSION_TOKEN_VERSION = 1 as const;

type SessionTokenPayload = {
  version: typeof SESSION_TOKEN_VERSION;
  userId: string;
  sessionId: string;
  issuedAt: string;
  expiresAt: string;
};

export type AuthPrincipal = {
  authMethod: "access_key" | "session";
  userId: string;
  sessionId: string | null;
  expiresAt: string | null;
};

export function checkSessionRateLimit(key: string): { allowed: boolean; retryAfterMs: number } {
  const store = getAuthSessionStateStore();
  const now = Date.now();
  const entry: SessionRateLimitEntry = store.getRateLimitEntry(key) ?? { attempts: 0, windowStart: now, lockedUntil: null };

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
  store.setRateLimitEntry(key, entry);

  if (entry.attempts > RATE_LIMIT_MAX_ATTEMPTS) {
    entry.lockedUntil = now + RATE_LIMIT_LOCKOUT_MS;
    store.setRateLimitEntry(key, entry);
    return { allowed: false, retryAfterMs: RATE_LIMIT_LOCKOUT_MS };
  }

  return { allowed: true, retryAfterMs: 0 };
}

export function recordSessionSuccess(key: string): void {
  getAuthSessionStateStore().deleteRateLimitEntry(key);
}

export function revokeSessionToken(token: string): void {
  const session = parseAuthorizedSessionToken(token);

  if (!session) {
    return;
  }

  getAuthSessionStateStore().revokeSession(session.sessionId, Date.parse(session.expiresAt));
}

export function isSessionTokenRevoked(sessionId: string): boolean {
  return getAuthSessionStateStore().isSessionRevoked(sessionId);
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

export function getServerSigningSecret(scope: "session" | "share" = "session"): string {
  const resolved = resolveAccessKey();

  if (!resolved.key) {
    throw new AuthError("AGENTIC_ACCESS_KEY is not configured for this runtime.");
  }

  return scope === "session" ? resolved.key : `${resolved.key}:agentic-share-v1`;
}

function signSessionTokenPayload(secret: string, encodedPayload: string): string {
  return crypto.createHmac("sha256", secret).update(`agentic-session-v1.${encodedPayload}`).digest("base64url");
}

function buildSessionTokenPayload(userId = SYSTEM_USER_ID, now = Date.now()): SessionTokenPayload {
  return {
    version: SESSION_TOKEN_VERSION,
    userId,
    sessionId: crypto.randomUUID(),
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_SECONDS * 1000).toISOString()
  };
}

function encodeSessionTokenPayload(payload: SessionTokenPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeSessionTokenPayload(encodedPayload: string): SessionTokenPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<SessionTokenPayload>;

    if (
      parsed.version !== SESSION_TOKEN_VERSION ||
      typeof parsed.userId !== "string" ||
      typeof parsed.sessionId !== "string" ||
      typeof parsed.issuedAt !== "string" ||
      typeof parsed.expiresAt !== "string"
    ) {
      return null;
    }

    const issuedAt = Date.parse(parsed.issuedAt);
    const expiresAt = Date.parse(parsed.expiresAt);

    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) {
      return null;
    }

    return {
      version: SESSION_TOKEN_VERSION,
      userId: parsed.userId,
      sessionId: parsed.sessionId,
      issuedAt: parsed.issuedAt,
      expiresAt: parsed.expiresAt
    };
  } catch {
    return null;
  }
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
  const payload = buildSessionTokenPayload(userId);
  const encodedPayload = encodeSessionTokenPayload(payload);
  const signature = signSessionTokenPayload(getServerSigningSecret("session"), encodedPayload);

  return `${encodedPayload}.${signature}`;
}

export function parseAuthorizedSessionToken(candidate: string | null | undefined, userId = SYSTEM_USER_ID): SessionTokenPayload | null {
  const token = candidate?.trim();

  if (!token) {
    return null;
  }

  const delimiterIndex = token.lastIndexOf(".");

  if (delimiterIndex <= 0 || delimiterIndex === token.length - 1) {
    return null;
  }

  const encodedPayload = token.slice(0, delimiterIndex);
  const providedSignature = token.slice(delimiterIndex + 1);
  const payload = decodeSessionTokenPayload(encodedPayload);

  if (!payload || payload.userId !== userId) {
    return null;
  }

  try {
    const expectedSignature = signSessionTokenPayload(getServerSigningSecret("session"), encodedPayload);

    if (!constantTimeEqual(providedSignature, expectedSignature)) {
      return null;
    }
  } catch {
    return null;
  }

  if (Date.parse(payload.expiresAt) <= Date.now()) {
    return null;
  }

  if (isSessionTokenRevoked(payload.sessionId)) {
    return null;
  }

  return payload;
}

export function isAuthorizedSessionToken(candidate: string | null | undefined, userId = SYSTEM_USER_ID): boolean {
  return parseAuthorizedSessionToken(candidate, userId) !== null;
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
      maxAge: SESSION_TTL_SECONDS
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
  return parseAuthorizedSessionToken(cookieStore.get(AGENTIC_SESSION_COOKIE)?.value) !== null;
}

export function resolveApiPrincipal(request: Request): AuthPrincipal | null {
  const headerKey = request.headers.get(AGENTIC_ACCESS_KEY_HEADER);

  if (verifyAccessKey(headerKey)) {
    return {
      authMethod: "access_key",
      userId: SYSTEM_USER_ID,
      sessionId: null,
      expiresAt: null
    };
  }

  const sessionToken = readCookieValue(request.headers.get("cookie"), AGENTIC_SESSION_COOKIE);
  const session = parseAuthorizedSessionToken(sessionToken);

  if (!session) {
    return null;
  }

  return {
    authMethod: "session",
    userId: session.userId,
    sessionId: session.sessionId,
    expiresAt: session.expiresAt
  };
}

export async function requireApiSession(request?: Request): Promise<AuthPrincipal> {
  if (request) {
    const principal = resolveApiPrincipal(request);

    if (principal) {
      return principal;
    }

    throw new AuthError("Unauthorized. Create a session before calling the Agentic API.");
  }

  const cookieStore = await cookies();
  const session = parseAuthorizedSessionToken(cookieStore.get(AGENTIC_SESSION_COOKIE)?.value);

  if (session) {
    return {
      authMethod: "session",
      userId: session.userId,
      sessionId: session.sessionId,
      expiresAt: session.expiresAt
    };
  }

  throw new AuthError("Unauthorized. Create a session before calling the Agentic API.");
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof Error && error.name === "AuthError";
}
