import { isIP } from "node:net";

export type RequestClientIdentity = {
  key: string;
  source: "trusted-ip" | "user-agent-fallback";
};

const USER_AGENT_FALLBACK_PREFIX = "ua:";
const TRUSTED_IP_PREFIX = "ip:";
const MAX_USER_AGENT_LENGTH = 200;

function isTrue(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function shouldTrustProxyHeaders(): boolean {
  return isTrue(process.env.AGENTIC_TRUST_PROXY_HEADERS);
}

function normalizeIpCandidate(candidate: string | null | undefined): string | null {
  if (!candidate) {
    return null;
  }

  const trimmed = candidate.trim().toLowerCase();

  if (!trimmed) {
    return null;
  }

  const bracketedIpv6 = trimmed.match(/^\[([a-f0-9:.]+)\](?::\d+)?$/i);

  if (bracketedIpv6) {
    return normalizeIpCandidate(bracketedIpv6[1]);
  }

  const ipv4WithPort = trimmed.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);

  if (ipv4WithPort) {
    return normalizeIpCandidate(ipv4WithPort[1]);
  }

  const withoutZoneId = trimmed.split("%", 1)[0] ?? trimmed;
  const normalized = withoutZoneId.startsWith("::ffff:") ? withoutZoneId.slice("::ffff:".length) : withoutZoneId;

  return isIP(normalized) === 0 ? null : normalized;
}

function parseTrustedForwardedFor(header: string | null): string | null {
  if (!header) {
    return null;
  }

  const firstHop = header.split(",")[0];
  return normalizeIpCandidate(firstHop);
}

function getTrustedProxyIp(request: Request): string | null {
  if (!shouldTrustProxyHeaders()) {
    return null;
  }

  const candidates = [
    normalizeIpCandidate(request.headers.get("cf-connecting-ip")),
    parseTrustedForwardedFor(request.headers.get("x-forwarded-for")),
    normalizeIpCandidate(request.headers.get("x-real-ip"))
  ];

  return candidates.find((candidate) => candidate !== null) ?? null;
}

function getUserAgentFallbackKey(request: Request): string {
  const userAgent = request.headers.get("user-agent")?.trim().toLowerCase().slice(0, MAX_USER_AGENT_LENGTH);
  return `${USER_AGENT_FALLBACK_PREFIX}${userAgent || "unknown"}`;
}

export function getRequestClientIdentity(request: Request): RequestClientIdentity {
  const trustedIp = getTrustedProxyIp(request);

  if (trustedIp) {
    return {
      key: `${TRUSTED_IP_PREFIX}${trustedIp}`,
      source: "trusted-ip"
    };
  }

  return {
    key: getUserAgentFallbackKey(request),
    source: "user-agent-fallback"
  };
}

export function getRequestClientKey(request: Request): string {
  return getRequestClientIdentity(request).key;
}
