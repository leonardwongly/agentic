export const AGENTIC_PUBLIC_BASE_URL_ENV = "AGENTIC_PUBLIC_BASE_URL";

export class PublicOriginConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicOriginConfigurationError";
  }
}

function normalizePublicBaseUrl(candidate: string): URL {
  let parsed: URL;

  try {
    parsed = new URL(candidate);
  } catch {
    throw new PublicOriginConfigurationError(`${AGENTIC_PUBLIC_BASE_URL_ENV} must be a valid absolute URL.`);
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new PublicOriginConfigurationError(`${AGENTIC_PUBLIC_BASE_URL_ENV} must use http or https.`);
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new PublicOriginConfigurationError(`${AGENTIC_PUBLIC_BASE_URL_ENV} must not include credentials, query, or hash.`);
  }

  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new PublicOriginConfigurationError(`${AGENTIC_PUBLIC_BASE_URL_ENV} must point to an origin, not a nested path.`);
  }

  return new URL(parsed.origin);
}

function fallbackOriginFromRequest(requestUrl: string): URL {
  const parsed = new URL(requestUrl);
  return new URL(parsed.origin);
}

export function getPublicBaseUrl(requestUrl?: string): URL {
  const configured = process.env[AGENTIC_PUBLIC_BASE_URL_ENV]?.trim();

  if (configured) {
    return normalizePublicBaseUrl(configured);
  }

  if (process.env.NODE_ENV === "production") {
    throw new PublicOriginConfigurationError(`${AGENTIC_PUBLIC_BASE_URL_ENV} is required in production.`);
  }

  if (!requestUrl) {
    throw new PublicOriginConfigurationError(`${AGENTIC_PUBLIC_BASE_URL_ENV} is required when no request URL is available.`);
  }

  return fallbackOriginFromRequest(requestUrl);
}

export function buildPublicUrl(requestUrl: string, pathname: string): URL {
  const baseUrl = getPublicBaseUrl(requestUrl);
  const url = new URL(pathname, baseUrl);

  url.search = "";
  url.hash = "";
  return url;
}
