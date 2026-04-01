import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(process.cwd(), "../..")
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
