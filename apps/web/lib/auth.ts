import crypto from "node:crypto";
import { cookies } from "next/headers";
import { getAuthSessionStateStore } from "./auth-session-store";
import { resolveBootstrapOwnerUserId } from "./instance-owner";

const SESSION_TTL_SECONDS = 60 * 60 * 12;
const SESSION_TOKEN_VERSION = 1 as const;
const OAUTH_STATE_TTL_SECONDS = 60 * 10;
const OAUTH_STATE_TOKEN_VERSION = 1 as const;

type SessionTokenPayload = {
  version: typeof SESSION_TOKEN_VERSION;
  userId: string;
  sessionId: string;
  issuedAt: string;
  expiresAt: string;
};

type OAuthStateTokenPayload = {
  version: typeof OAUTH_STATE_TOKEN_VERSION;
  userId: string;
  workspaceId: string | null;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
};

export type AuthPrincipalKind = "session" | "bootstrap_access_key" | "machine_token";

export type BootstrapAccessKeyPrincipal = {
  kind: "bootstrap_access_key";
  authMethod: "access_key";
  userId: string;
  sessionId: string | null;
  expiresAt: string | null;
};

export type SessionPrincipal = {
  kind: "session";
  authMethod: "session";
  userId: string;
  sessionId: string;
  expiresAt: string;
};

export type MachineTokenPrincipal = {
  kind: "machine_token";
  authMethod: "machine_token";
  userId: string;
  sessionId: string | null;
  expiresAt: string | null;
  tokenId: string;
  subject: string;
  scopes: string[];
  routeGroups: string[];
  workspaceIds: string[] | null;
};

export type AuthPrincipal = BootstrapAccessKeyPrincipal | SessionPrincipal | MachineTokenPrincipal;

type MachineTokenConfig = {
  id: string;
  subject: string;
  userId: string;
  tokenHash: string;
  scopes: string[];
  routeGroups: string[];
  workspaceIds: string[] | null;
  expiresAt: string | null;
  revoked: boolean;
};

export type RequireApiPrincipalOptions = {
  routeGroup?: string;
  scope?: string;
  workspaceId?: string;
  allowBootstrapAccessKey?: boolean;
  allowMachineToken?: boolean;
};

export async function checkSessionRateLimit(key: string): Promise<{ allowed: boolean; retryAfterMs: number }> {
  return getAuthSessionStateStore().checkRateLimit(key);
}

export async function recordSessionSuccess(key: string): Promise<void> {
  await getAuthSessionStateStore().clearRateLimit(key);
}

export async function revokeSessionToken(token: string): Promise<void> {
  const session = await parseAuthorizedSessionToken(token);

  if (!session) {
    return;
  }

  await getAuthSessionStateStore().revokeSession(session.sessionId, Date.parse(session.expiresAt));
}

export async function isSessionTokenRevoked(sessionId: string): Promise<boolean> {
  return getAuthSessionStateStore().isSessionRevoked(sessionId);
}

export const AGENTIC_SESSION_COOKIE = "agentic_session";
export const AGENTIC_ACCESS_KEY_HEADER = "x-agentic-access-key";
export const AGENTIC_MACHINE_TOKEN_HEADER = "x-agentic-machine-token";
export const AGENTIC_MACHINE_TOKENS_ENV = "AGENTIC_MACHINE_TOKENS_JSON";

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

function isExplicitLocalDevKeyEnabled(): boolean {
  return process.env.AGENTIC_ENABLE_LOCAL_DEV_KEY?.trim().toLowerCase() === "true";
}

function resolveAccessKey(options?: {
  emitDevelopmentWarning?: boolean;
}): { key: string | null; source: "env" | "development-fallback" | "missing" } {
  const configured = process.env.AGENTIC_ACCESS_KEY?.trim();

  if (configured) {
    return { key: configured, source: "env" };
  }

  if (process.env.NODE_ENV !== "production" && isExplicitLocalDevKeyEnabled()) {
    if (options?.emitDevelopmentWarning !== false && !_devKeyWarningEmitted) {
      console.warn(
        "[agentic] SECURITY WARNING: AGENTIC_ACCESS_KEY is not set. " +
          "Using the explicitly enabled well-known development fallback key. " +
          "Do not expose this instance to external networks."
      );
      _devKeyWarningEmitted = true;
    }
    return { key: "agentic-local-dev-key", source: "development-fallback" };
  }

  return { key: null, source: "missing" };
}

export function getServerSigningSecret(scope: "session" | "share" | "oauth" = "session"): string {
  const resolved = resolveAccessKey();

  if (!resolved.key) {
    throw new AuthError("AGENTIC_ACCESS_KEY is not configured for this runtime.");
  }

  switch (scope) {
    case "session":
      return resolved.key;
    case "share":
      return `${resolved.key}:agentic-share-v1`;
    case "oauth":
      return `${resolved.key}:agentic-oauth-v1`;
  }
}

function signSessionTokenPayload(secret: string, encodedPayload: string): string {
  return crypto.createHmac("sha256", secret).update(`agentic-session-v1.${encodedPayload}`).digest("base64url");
}

function signOAuthStatePayload(secret: string, encodedPayload: string): string {
  return crypto.createHmac("sha256", secret).update(`agentic-oauth-state-v1.${encodedPayload}`).digest("base64url");
}

function resolveSessionCreationUserId(): string {
  return resolveBootstrapOwnerUserId({
    requireExplicit: process.env.NODE_ENV === "production"
  });
}

function buildSessionTokenPayload(userId = resolveSessionCreationUserId(), now = Date.now()): SessionTokenPayload {
  return {
    version: SESSION_TOKEN_VERSION,
    userId,
    sessionId: crypto.randomUUID(),
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_SECONDS * 1000).toISOString()
  };
}

function buildOAuthStatePayload(params: { userId: string; workspaceId?: string | null }, now = Date.now()): OAuthStateTokenPayload {
  return {
    version: OAUTH_STATE_TOKEN_VERSION,
    userId: params.userId,
    workspaceId: params.workspaceId ?? null,
    nonce: crypto.randomUUID(),
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + OAUTH_STATE_TTL_SECONDS * 1000).toISOString()
  };
}

function encodeSessionTokenPayload(payload: SessionTokenPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function encodeOAuthStatePayload(payload: OAuthStateTokenPayload): string {
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

function decodeOAuthStatePayload(encodedPayload: string): OAuthStateTokenPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<OAuthStateTokenPayload>;

    if (
      parsed.version !== OAUTH_STATE_TOKEN_VERSION ||
      typeof parsed.userId !== "string" ||
      (parsed.workspaceId !== null && typeof parsed.workspaceId !== "string" && typeof parsed.workspaceId !== "undefined") ||
      typeof parsed.nonce !== "string" ||
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
      version: OAUTH_STATE_TOKEN_VERSION,
      userId: parsed.userId,
      workspaceId: parsed.workspaceId ?? null,
      nonce: parsed.nonce,
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

function readMachineTokenHeader(request: Request): string | null {
  const directHeader = request.headers.get(AGENTIC_MACHINE_TOKEN_HEADER)?.trim();

  if (directHeader) {
    return directHeader;
  }

  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/iu);

  return bearerMatch?.[1]?.trim() || null;
}

export function hashMachineTokenSecret(secret: string): string {
  const normalized = secret.trim();

  if (!normalized) {
    throw new AuthError("Machine token secrets must not be empty.");
  }

  return `sha256:${crypto.createHash("sha256").update(normalized).digest("hex")}`;
}

function parseStringList(value: unknown, field: string, options?: { allowEmpty?: boolean }): string[] {
  if (!Array.isArray(value)) {
    throw new AuthError(`Machine token ${field} must be an array of strings.`);
  }

  const parsed = value.map((entry) => {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new AuthError(`Machine token ${field} must contain only non-empty strings.`);
    }

    return entry.trim();
  });

  if (parsed.length === 0 && options?.allowEmpty !== true) {
    throw new AuthError(`Machine token ${field} must contain at least one value.`);
  }

  return [...new Set(parsed)].sort((left, right) => left.localeCompare(right));
}

function parseMachineTokenConfigEntry(value: unknown): MachineTokenConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuthError("Machine token entries must be objects.");
  }

  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const subject = typeof raw.subject === "string" ? raw.subject.trim() : "";
  const userId = typeof raw.userId === "string" ? raw.userId.trim() : "";
  const tokenHash = typeof raw.tokenHash === "string" ? raw.tokenHash.trim().toLowerCase() : "";
  const expiresAt = raw.expiresAt === null || raw.expiresAt === undefined ? null : typeof raw.expiresAt === "string" ? raw.expiresAt.trim() : "";

  if (!id || !subject || !userId) {
    throw new AuthError("Machine token entries require id, subject, and userId.");
  }

  if (!/^sha256:[a-f0-9]{64}$/u.test(tokenHash)) {
    throw new AuthError("Machine token entries require a sha256 tokenHash.");
  }

  if (expiresAt !== null && (!expiresAt || !Number.isFinite(Date.parse(expiresAt)))) {
    throw new AuthError("Machine token expiresAt must be a valid ISO timestamp when present.");
  }

  const workspaceIds =
    raw.workspaceIds === null || raw.workspaceIds === undefined
      ? null
      : parseStringList(raw.workspaceIds, "workspaceIds", { allowEmpty: true });

  return {
    id,
    subject,
    userId,
    tokenHash,
    scopes: parseStringList(raw.scopes, "scopes"),
    routeGroups: parseStringList(raw.routeGroups, "routeGroups"),
    workspaceIds,
    expiresAt,
    revoked: raw.revoked === true
  };
}

function getConfiguredMachineTokens(): MachineTokenConfig[] {
  const raw = process.env[AGENTIC_MACHINE_TOKENS_ENV]?.trim();

  if (!raw) {
    return [];
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AuthError(`${AGENTIC_MACHINE_TOKENS_ENV} must be valid JSON.`);
  }

  if (!Array.isArray(parsed)) {
    throw new AuthError(`${AGENTIC_MACHINE_TOKENS_ENV} must be a JSON array.`);
  }

  const tokens = parsed.map(parseMachineTokenConfigEntry);
  const ids = new Set<string>();

  for (const token of tokens) {
    if (ids.has(token.id)) {
      throw new AuthError(`Duplicate machine token id "${token.id}".`);
    }

    ids.add(token.id);
  }

  return tokens;
}

function verifyMachineToken(candidate: string | null | undefined, now = Date.now()): MachineTokenPrincipal | null {
  const attempted = candidate?.trim();

  if (!attempted) {
    return null;
  }

  const tokens = getConfiguredMachineTokens();

  if (tokens.length === 0) {
    return null;
  }

  const attemptedHash = hashMachineTokenSecret(attempted);
  let matched: MachineTokenConfig | null = null;

  for (const token of tokens) {
    if (constantTimeEqual(attemptedHash, token.tokenHash)) {
      matched = token;
    }
  }

  if (!matched || matched.revoked) {
    return null;
  }

  if (matched.expiresAt && Date.parse(matched.expiresAt) <= now) {
    return null;
  }

  return {
    kind: "machine_token",
    authMethod: "machine_token",
    userId: matched.userId,
    sessionId: null,
    expiresAt: matched.expiresAt,
    tokenId: matched.id,
    subject: matched.subject,
    scopes: matched.scopes,
    routeGroups: matched.routeGroups,
    workspaceIds: matched.workspaceIds
  };
}

function assertPrincipalAllowed(principal: AuthPrincipal, options: RequireApiPrincipalOptions = {}): void {
  if (principal.kind === "bootstrap_access_key" && options.allowBootstrapAccessKey === false) {
    throw new AuthError("Bootstrap access key is not allowed for this API route.");
  }

  if (principal.kind !== "machine_token") {
    return;
  }

  if (options.allowMachineToken !== true) {
    throw new AuthError("Machine token is not allowed for this API route.");
  }

  if (options.routeGroup && !principal.routeGroups.includes(options.routeGroup)) {
    throw new AuthError("Machine token is not scoped for this API route.");
  }

  if (options.scope && !principal.scopes.includes(options.scope)) {
    throw new AuthError("Machine token does not have the required scope.");
  }

  if (options.workspaceId && principal.workspaceIds !== null && !principal.workspaceIds.includes(options.workspaceId)) {
    throw new AuthError("Machine token is not scoped for this workspace.");
  }
}

export function getAuthMode(options?: { emitDevelopmentWarning?: boolean }) {
  const resolved = resolveAccessKey(options);

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

export function buildSessionToken(userId = resolveSessionCreationUserId()): string {
  const payload = buildSessionTokenPayload(userId);
  const encodedPayload = encodeSessionTokenPayload(payload);
  const signature = signSessionTokenPayload(getServerSigningSecret("session"), encodedPayload);

  return `${encodedPayload}.${signature}`;
}

export function buildOAuthStateToken(params: { userId: string; workspaceId?: string | null }): string {
  const payload = buildOAuthStatePayload(params);
  const encodedPayload = encodeOAuthStatePayload(payload);
  const signature = signOAuthStatePayload(getServerSigningSecret("oauth"), encodedPayload);

  return `${encodedPayload}.${signature}`;
}

function parseSignedSessionToken(candidate: string | null | undefined, userId = resolveBootstrapOwnerUserId()): SessionTokenPayload | null {
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

  return payload;
}

export function parseAuthorizedOAuthStateToken(
  candidate: string | null | undefined,
  expectedUserId?: string
): OAuthStateTokenPayload | null {
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
  const payload = decodeOAuthStatePayload(encodedPayload);

  if (!payload || (expectedUserId && payload.userId !== expectedUserId)) {
    return null;
  }

  try {
    const expectedSignature = signOAuthStatePayload(getServerSigningSecret("oauth"), encodedPayload);

    if (!constantTimeEqual(providedSignature, expectedSignature)) {
      return null;
    }
  } catch {
    return null;
  }

  if (Date.parse(payload.expiresAt) <= Date.now()) {
    return null;
  }

  return payload;
}

export async function parseAuthorizedSessionToken(
  candidate: string | null | undefined,
  userId = resolveBootstrapOwnerUserId()
): Promise<SessionTokenPayload | null> {
  const payload = parseSignedSessionToken(candidate, userId);

  if (!payload) {
    return null;
  }

  if (await isSessionTokenRevoked(payload.sessionId)) {
    return null;
  }

  return payload;
}

export async function isAuthorizedSessionToken(candidate: string | null | undefined, userId = resolveBootstrapOwnerUserId()): Promise<boolean> {
  return (await parseAuthorizedSessionToken(candidate, userId)) !== null;
}

export function createSessionCookie(userId = resolveSessionCreationUserId()) {
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
  return (await parseAuthorizedSessionToken(cookieStore.get(AGENTIC_SESSION_COOKIE)?.value)) !== null;
}

export async function resolveApiPrincipal(request: Request): Promise<AuthPrincipal | null> {
  const machineToken = readMachineTokenHeader(request);
  const machinePrincipal = verifyMachineToken(machineToken);

  if (machinePrincipal) {
    return machinePrincipal;
  }

  if (machineToken) {
    throw new AuthError("Unauthorized. Machine token was rejected.");
  }

  const headerKey = request.headers.get(AGENTIC_ACCESS_KEY_HEADER);

  if (verifyAccessKey(headerKey)) {
    return {
      kind: "bootstrap_access_key",
      authMethod: "access_key",
      userId: resolveBootstrapOwnerUserId(),
      sessionId: null,
      expiresAt: null
    };
  }

  const sessionToken = readCookieValue(request.headers.get("cookie"), AGENTIC_SESSION_COOKIE);
  const session = await parseAuthorizedSessionToken(sessionToken);

  if (!session) {
    return null;
  }

  return {
    kind: "session",
    authMethod: "session",
    userId: session.userId,
    sessionId: session.sessionId,
    expiresAt: session.expiresAt
  };
}

export async function requireApiPrincipal(
  request: Request,
  options: RequireApiPrincipalOptions = {}
): Promise<AuthPrincipal> {
  const principal = await resolveApiPrincipal(request);

  if (principal) {
    assertPrincipalAllowed(principal, options);
    return principal;
  }

  throw new AuthError("Unauthorized. Create a session before calling the Agentic API.");
}

export async function requireApiSession(request?: Request): Promise<AuthPrincipal> {
  if (request) {
    return requireApiPrincipal(request);
  }

  const cookieStore = await cookies();
  const session = await parseAuthorizedSessionToken(cookieStore.get(AGENTIC_SESSION_COOKIE)?.value);

  if (session) {
    return {
      kind: "session",
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
