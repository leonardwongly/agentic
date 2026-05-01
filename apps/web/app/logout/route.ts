import { AGENTIC_SESSION_COOKIE, clearSessionCookie, revokeSessionToken } from "../../lib/auth";
import { authenticatedRedirect } from "../../lib/api-response";

const LOGOUT_REDIRECT_CACHE_CONTROL = "no-store, max-age=0, must-revalidate";

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

export async function GET(request: Request) {
  const existingToken = readSessionCookie(request);

  if (existingToken) {
    await revokeSessionToken(existingToken);
  }

  const response = authenticatedRedirect(new URL("/", request.url));
  const cookie = clearSessionCookie();

  response.cookies.set(cookie.name, cookie.value, cookie.options);
  response.headers.set("Cache-Control", LOGOUT_REDIRECT_CACHE_CONTROL);
  return response;
}
