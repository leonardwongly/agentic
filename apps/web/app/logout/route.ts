import { AGENTIC_SESSION_COOKIE, clearSessionCookie, revokeSessionToken } from "../../lib/auth";
import { authenticatedJson, authenticatedRedirect } from "../../lib/api-response";

const LOGOUT_REDIRECT_CACHE_CONTROL = "no-store, max-age=0, must-revalidate";
const CROSS_SITE_LOGOUT_ERROR = "Logout must be submitted from the same site.";

function readSessionCookie(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");

  if (!cookieHeader) {
    return null;
  }

  for (const segment of cookieHeader.split(";")) {
    const [name, ...valueParts] = segment.trim().split("=");

    if (name !== AGENTIC_SESSION_COOKIE) {
      continue;
    }

    const value = valueParts.join("=").trim();
    return value.length > 0 ? value : null;
  }

  return null;
}

function isSameSiteLogoutRequest(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();

  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    return false;
  }

  const origin = request.headers.get("origin")?.trim();

  if (!origin) {
    return true;
  }

  return origin === new URL(request.url).origin;
}

function redirectHome(request: Request) {
  const response = authenticatedRedirect(new URL("/", request.url));
  response.headers.set("Cache-Control", LOGOUT_REDIRECT_CACHE_CONTROL);
  return response;
}

export async function GET(request: Request) {
  return redirectHome(request);
}

export async function POST(request: Request) {
  if (!isSameSiteLogoutRequest(request)) {
    return authenticatedJson({ error: CROSS_SITE_LOGOUT_ERROR }, { status: 403 });
  }

  const existingToken = readSessionCookie(request);

  if (existingToken) {
    await revokeSessionToken(existingToken);
  }

  const response = redirectHome(request);
  const cookie = clearSessionCookie();

  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}
