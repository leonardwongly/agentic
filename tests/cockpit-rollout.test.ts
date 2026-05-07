import { resolveDashboardCockpitRollout } from "@agentic/repository";
import { describe, expect, it } from "vitest";

describe("dashboard cockpit rollout flag", () => {
  it("defaults to the legacy cockpit when no flag is configured", () => {
    expect(resolveDashboardCockpitRollout({})).toMatchObject({
      enabled: false,
      variant: "legacy",
      source: "default"
    });
  });

  it("enables the redesigned variant for explicit truthy rollout values", () => {
    expect(resolveDashboardCockpitRollout({ AGENTIC_DASHBOARD_COCKPIT: "redesigned" })).toMatchObject({
      enabled: true,
      variant: "redesigned",
      source: "env"
    });
  });

  it("fails closed to the legacy cockpit for invalid values", () => {
    expect(resolveDashboardCockpitRollout({ AGENTIC_DASHBOARD_COCKPIT: "maybe" })).toMatchObject({
      enabled: false,
      variant: "legacy",
      source: "invalid",
      rawValue: "maybe"
    });
  });
});
