import path from "node:path";
import type { NextConfig } from "next";
import { BASE_SECURITY_HEADERS } from "./lib/security-headers";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'"
    ].join("; ")
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload"
  }
];

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(process.cwd(), "../..")
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...BASE_SECURITY_HEADERS]
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

export default nextConfig;
