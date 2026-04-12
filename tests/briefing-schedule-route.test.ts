import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { briefingTypeValues } from "@agentic/contracts";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import { GET as briefingScheduleGetRoute, POST as briefingSchedulePostRoute } from "../apps/web/app/api/briefing/schedule/route";

describe("briefing schedule route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-briefing-schedule-route-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  it("returns default persisted briefing preferences", async () => {
    const response = await briefingScheduleGetRoute(
      new Request("http://localhost/api/briefing/schedule", {
        method: "GET",
        headers: {
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        }
      })
    );
    const payload = (await response.json()) as { preferences: { timezone: string; focus: string; schedules: Array<{ type: string }> } };

    expect(response.status).toBe(200);
    expect(payload.preferences.focus).toBe("balanced");
    expect(payload.preferences.schedules.map((schedule) => schedule.type)).toEqual(briefingTypeValues);
  });

  it("persists updated briefing preferences and returns refreshed dashboard data", async () => {
    const response = await briefingSchedulePostRoute(
      new Request("http://localhost/api/briefing/schedule", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        },
        body: JSON.stringify({
          timezone: "America/Los_Angeles",
          focus: "deep",
          schedules: [
            { type: "startup", enabled: true, time: "08:30" },
            { type: "midday", enabled: true, time: "12:15" },
            { type: "pre_meeting", enabled: false, time: "09:45" },
            { type: "end_of_day", enabled: true, time: "17:45" },
            { type: "next_day", enabled: true, time: "18:30" }
          ]
        })
      })
    );
    const payload = (await response.json()) as {
      preferences: { timezone: string; focus: string; schedules: Array<{ type: string; enabled: boolean; time: string }> };
      dashboard: { briefingPreferences: { timezone: string; focus: string } };
    };

    expect(response.status).toBe(200);
    expect(payload.preferences).toMatchObject({
      timezone: "America/Los_Angeles",
      focus: "deep"
    });
    expect(payload.preferences.schedules.find((schedule) => schedule.type === "midday")).toMatchObject({
      enabled: true,
      time: "12:15"
    });
    expect(payload.dashboard.briefingPreferences).toMatchObject({
      timezone: "America/Los_Angeles",
      focus: "deep"
    });
  });

  it("rejects incomplete schedule payloads", async () => {
    const response = await briefingSchedulePostRoute(
      new Request("http://localhost/api/briefing/schedule", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        },
        body: JSON.stringify({
          schedules: [{ type: "startup", enabled: true, time: "08:30" }]
        })
      })
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain("Missing briefing schedule");
  });
});
