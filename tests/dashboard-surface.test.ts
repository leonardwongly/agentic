import {
  ADVANCED_DASHBOARD_SECTIONS,
  DASHBOARD_OS_SURFACES,
  getDashboardOsSurface,
  getDashboardOsSurfaceForSection,
  isAdvancedDashboardSection
} from "../apps/web/lib/dashboard-surface";

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

  it("defines explicit OS surfaces for command, operations, agents, governance, memory, provenance, and observability", () => {
    expect(DASHBOARD_OS_SURFACES.map((surface) => surface.id)).toEqual([
      "command",
      "operations",
      "agents",
      "governance",
      "memory",
      "provenance",
      "observability"
    ]);

    for (const surface of DASHBOARD_OS_SURFACES) {
      expect(surface.routeBoundary).toMatch(/^#/u);
      expect(surface.componentBoundary).toMatch(/^Dashboard/u);
      expect(surface.states).toMatchObject({
        loading: expect.any(String),
        empty: expect.any(String),
        error: expect.any(String),
        permission: expect.any(String)
      });
    }
  });

  it("maps advanced sections to their owning OS surfaces", () => {
    expect(getDashboardOsSurface("governance")?.sections).toEqual(expect.arrayContaining(["governance", "autopilot"]));
    expect(getDashboardOsSurfaceForSection("templates")?.id).toBe("operations");
    expect(getDashboardOsSurfaceForSection("integrations")?.id).toBe("agents");
    expect(getDashboardOsSurfaceForSection("notes")?.id).toBe("memory");
    expect(getDashboardOsSurfaceForSection("unknown")).toBeNull();
  });
});
