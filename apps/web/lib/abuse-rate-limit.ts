import { checkSessionRateLimit, type AuthPrincipal } from "./auth";
import { getRequestClientIdentity, type RequestClientIdentity } from "./request-client-identity";

export type AbuseRateLimitStatus = {
  allowed: boolean;
  retryAfterMs: number;
  retryAfterSeconds: number;
  key: string;
  identitySource: RequestClientIdentity["source"];
};

type AbuseRateLimitParams = {
  namespace: string;
  request: Request;
  principal?: AuthPrincipal | null;
};

function normalizeKeySegment(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, "-").slice(0, 160);
}

function buildUserScope(principal?: AuthPrincipal | null): string {
  if (!principal) {
    return "anonymous";
  }

  return `user:${normalizeKeySegment(principal.userId)}`;
}

export function buildAbuseRateLimitKey(params: AbuseRateLimitParams): {
  key: string;
  identitySource: RequestClientIdentity["source"];
} {
  const namespace = normalizeKeySegment(params.namespace);
  const identity = getRequestClientIdentity(params.request);

  return {
    key: `${namespace}:${buildUserScope(params.principal)}:${identity.key}`,
    identitySource: identity.source
  };
}

export async function checkAbuseRateLimit(params: AbuseRateLimitParams): Promise<AbuseRateLimitStatus> {
  const scoped = buildAbuseRateLimitKey(params);
  const result = await checkSessionRateLimit(scoped.key);

  return {
    ...result,
    retryAfterSeconds: Math.max(1, Math.ceil(result.retryAfterMs / 1000)),
    key: scoped.key,
    identitySource: scoped.identitySource
  };
}
