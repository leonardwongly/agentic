import crypto from "node:crypto";
import { isIP } from "node:net";

export type RequestClientIdentity = {
  key: string;
  source: "trusted-ip" | "request-fingerprint";
};

const REQUEST_FINGERPRINT_PREFIX = "fp:";
const TRUSTED_IP_PREFIX = "ip:";
const MAX_USER_AGENT_LENGTH = 200;
const MAX_ACCEPT_LANGUAGE_LENGTH = 80;
const MAX_PATHNAME_LENGTH = 120;

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

function normalizeFingerprintSegment(value: string | null | undefined, maxLength: number): string {
  const normalized = value?.trim().toLowerCase().slice(0, maxLength);
  return normalized || "unknown";
}

function getRequestFingerprintKey(request: Request): string {
  const pathname = new URL(request.url).pathname.slice(0, MAX_PATHNAME_LENGTH) || "/";
  const userAgent = request.headers.get("user-agent")?.trim().toLowerCase().slice(0, MAX_USER_AGENT_LENGTH);
  const acceptLanguage = normalizeFingerprintSegment(
    request.headers.get("accept-language"),
    MAX_ACCEPT_LANGUAGE_LENGTH
  );
  const fingerprint = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        method: request.method.toUpperCase(),
        pathname,
        userAgent: userAgent || "unknown",
        acceptLanguage
      })
    )
    .digest("hex")
    .slice(0, 24);

  return `${REQUEST_FINGERPRINT_PREFIX}${pathname}:${fingerprint}`;
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
    key: getRequestFingerprintKey(request),
    source: "request-fingerprint"
  };
}

export function getRequestClientKey(request: Request): string {
  return getRequestClientIdentity(request).key;
}
