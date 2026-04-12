import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import { GET as autopilotSettingsGetRoute, POST as autopilotSettingsPostRoute } from "../apps/web/app/api/autopilot/settings/route";

describe("autopilot settings route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-autopilot-settings-route-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  it("returns default autopilot settings after seeding", async () => {
    const response = await autopilotSettingsGetRoute(
      new Request("http://localhost/api/autopilot/settings", {
        method: "GET",
        headers: {
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        }
      })
    );
    const payload = (await response.json()) as {
      settings: {
        mode: string;
        debounceMinutes: number;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.settings).toMatchObject({
      mode: "notify_only",
      debounceMinutes: 15
    });
  });

  it("persists updated autopilot settings and returns refreshed dashboard data", async () => {
    const response = await autopilotSettingsPostRoute(
      new Request("http://localhost/api/autopilot/settings", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        },
        body: JSON.stringify({
          mode: "notify_only",
          debounceMinutes: 45
        })
      })
    );
    const payload = (await response.json()) as {
      settings: {
        mode: string;
        debounceMinutes: number;
      };
      dashboard: {
        autopilotSettings: {
          mode: string;
          debounceMinutes: number;
        };
      };
    };

    expect(response.status).toBe(200);
    expect(payload.settings).toMatchObject({
      mode: "notify_only",
      debounceMinutes: 45
    });
    expect(payload.dashboard.autopilotSettings).toMatchObject({
      mode: "notify_only",
      debounceMinutes: 45
    });
  });

  it("rejects auto-run mode when persistence is file-backed", async () => {
    const response = await autopilotSettingsPostRoute(
      new Request("http://localhost/api/autopilot/settings", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        },
        body: JSON.stringify({
          mode: "auto_run"
        })
      })
    );
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(409);
    expect(payload.error).toMatch(/requires Postgres-backed persistence/i);
  });
});
