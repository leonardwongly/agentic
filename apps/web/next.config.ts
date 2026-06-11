import path from "node:path";
import { fileURLToPath } from "node:url";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";
import { BASE_SECURITY_HEADERS } from "./lib/security-headers";
import { buildContentSecurityPolicy } from "./lib/csp";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// HTML/page responses must not be cached (auth-gated dashboard shell and public
// share views). API responses set their own no-store headers via the response
// helpers, so this is scoped to exclude /api routes and build assets.
const HTML_CACHE_CONTROL = "no-store, max-age=0, must-revalidate";

const nextConfig: NextConfig = {
  // OpenNext (--skipNextBuild) consumes Next's standalone output. Emit it only
  // for the Cloudflare build (cf:build sets CF_BUILD=1) so the Node/Docker build
  // is unchanged.
  output: process.env.CF_BUILD === "1" ? "standalone" : undefined,
  turbopack: {
    root: repoRoot
  },
  // Keep the Postgres driver (and its optional Cloudflare socket shim
  // pg-cloudflare) external so they are resolved at runtime from node_modules
  // instead of being bundled by the server compiler / OpenNext's esbuild pass —
  // esbuild cannot resolve pg-cloudflare's conditional ("workerd") exports.
  serverExternalPackages: ["pg", "pg-cloudflare"],
  async headers() {
    const isDevelopment = process.env.NODE_ENV === "development";
    const contentSecurityPolicy = buildContentSecurityPolicy({ isDevelopment });

    return [
      {
        source: "/:path*",
        headers: [
          ...BASE_SECURITY_HEADERS,
          { key: "Content-Security-Policy", value: contentSecurityPolicy }
        ]
      },
      {
        // No-store for HTML pages: everything except API routes (which manage
        // their own cache headers) and immutable build assets.
        source: "/((?!api/|_next/static|_next/image|favicon.ico).*)",
        headers: [{ key: "Cache-Control", value: HTML_CACHE_CONTROL }]
      }
    ];
  },
  transpilePackages: [
    "@agentic/contracts",
    "@agentic/orchestrator",
    "@agentic/memory",
    "@agentic/policy",
    "@agentic/execution",
    "@agentic/agents",
    "@agentic/integrations",
    "@agentic/observability",
    "@agentic/notifications",
    "@agentic/db",
    "@agentic/repository"
  ]
};

// Integrates Cloudflare bindings with `next dev` when running locally via the
// OpenNext adapter. This is a no-op for the standard Node.js production build.
initOpenNextCloudflareForDev();

export default nextConfig;
