import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@agentic/agents": path.resolve(projectRoot, "packages/agents/src/index.ts"),
      "@agentic/contracts": path.resolve(projectRoot, "packages/contracts/src/index.ts"),
      "@agentic/db": path.resolve(projectRoot, "packages/db/src/index.ts"),
      "@agentic/docs-runtime": path.resolve(projectRoot, "packages/docs-runtime/src/index.ts"),
      "@agentic/execution": path.resolve(projectRoot, "packages/execution/src/index.ts"),
      "@agentic/integrations": path.resolve(projectRoot, "packages/integrations/src/index.ts"),
      "@agentic/memory": path.resolve(projectRoot, "packages/memory/src/index.ts"),
      "@agentic/notifications": path.resolve(projectRoot, "packages/notifications/src/index.ts"),
      "@agentic/observability": path.resolve(projectRoot, "packages/observability/src/index.ts"),
      "@agentic/orchestrator": path.resolve(projectRoot, "packages/orchestrator/src/index.ts"),
      "@agentic/policy": path.resolve(projectRoot, "packages/policy/src/index.ts"),
      "@agentic/repository": path.resolve(projectRoot, "packages/repository/src/index.ts"),
      "@agentic/runtime-adapters": path.resolve(projectRoot, "packages/runtime-adapters/src/index.ts"),
      "@agentic/self-improvement-memory": path.resolve(projectRoot, "packages/self-improvement-memory/src/index.ts"),
      "@agentic/worker-runtime": path.resolve(projectRoot, "packages/worker-runtime/src/index.ts"),
    }
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"]
  }
});
