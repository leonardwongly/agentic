import { ADVANCED_DASHBOARD_SECTIONS, isAdvancedDashboardSection } from "../apps/web/lib/dashboard-surface";

describe("dashboard surface helpers", () => {
  it("marks advanced sections explicitly instead of relying on scattered UI checks", () => {
    expect(ADVANCED_DASHBOARD_SECTIONS).toEqual(
      expect.arrayContaining(["memory", "notes", "integrations", "watchers", "templates", "agents"])
    );
    expect(isAdvancedDashboardSection("memory")).toBe(true);
    expect(isAdvancedDashboardSection("governance")).toBe(true);
  });

  it("keeps the main operating loop sections out of the advanced boundary", () => {
    expect(isAdvancedDashboardSection("approvals")).toBe(false);
    expect(isAdvancedDashboardSection("commitments")).toBe(false);
    expect(isAdvancedDashboardSection("artifacts")).toBe(false);
    expect(isAdvancedDashboardSection("")).toBe(false);
    expect(isAdvancedDashboardSection(null)).toBe(false);
  });
});
