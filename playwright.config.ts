import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const port = 3201;
const e2eRoot = path.join(process.cwd(), ".agentic", "e2e", process.env.PLAYWRIGHT_E2E_RUN_ID ?? `${Date.now()}`);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["html"], ["list"]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"]
      }
    }
  ],
  webServer: {
    command: `npm run build && npm run start -w @agentic/web -- --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      AGENTIC_ACCESS_KEY: "playwright-e2e-key",
      AGENTIC_NOTES_PATH: path.join(e2eRoot, "notes"),
      AGENTIC_RUNTIME_STORE_PATH: path.join(e2eRoot, "runtime-store.json"),
      NODE_ENV: "test"
    }
  }
});
