import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { BASE_SECURITY_HEADERS } from "./lib/security-headers";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const nextConfig: NextConfig = {
  turbopack: {
    root: repoRoot
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
