const advancedDashboardSections = [
  "workspaces",
  "governance",
  "autopilot",
  "operator-products",
  "operations",
  "provenance",
  "memory",
  "integrations",
  "notes",
  "watchers",
  "templates",
  "agents"
] as const;

export type AdvancedDashboardSection = (typeof advancedDashboardSections)[number];

const dashboardOsSurfaces = [
  {
    id: "cockpit",
    label: "Cockpit",
    routeBoundary: "#section-operate",
    componentBoundary: "DashboardCockpitLanes",
    sections: ["operate", "now", "approvals", "operations"],
    states: {
      loading: "Loading cockpit priorities.",
      empty: "No operator priorities are open.",
      error: "Cockpit priority state could not be loaded.",
      permission: "Cockpit recovery actions require an authenticated operator."
    }
  },
  {
    id: "command",
    label: "Command",
    routeBoundary: "#section-approvals",
    componentBoundary: "DashboardCommandLoop",
    sections: ["approvals", "commitments", "artifacts"],
    states: {
      loading: "Loading command state.",
      empty: "No command actions are pending.",
      error: "Command state could not be loaded.",
      permission: "Command actions require an authenticated operator."
    }
  },
  {
    id: "operations",
    label: "Operations",
    routeBoundary: "#advanced-operations",
    componentBoundary: "DashboardOperationsSurface",
    sections: ["operations", "operator-products", "watchers", "templates"],
    states: {
      loading: "Loading operations state.",
      empty: "No operations require attention.",
      error: "Operations state could not be loaded.",
      permission: "Operations controls require workspace access."
    }
  },
  {
    id: "agents",
    label: "Agents",
    routeBoundary: "#advanced-agents",
    componentBoundary: "DashboardAgentsSurface",
    sections: ["agents", "integrations"],
    states: {
      loading: "Loading agent state.",
      empty: "No agent activity is available.",
      error: "Agent state could not be loaded.",
      permission: "Agent controls require workspace access."
    }
  },
  {
    id: "governance",
    label: "Governance",
    routeBoundary: "#advanced-governance",
    componentBoundary: "DashboardGovernanceSurface",
    sections: ["governance", "autopilot"],
    states: {
      loading: "Loading governance state.",
      empty: "No governance actions are pending.",
      error: "Governance state could not be loaded.",
      permission: "Governance controls require owner or editor access."
    }
  },
  {
    id: "memory",
    label: "Memory",
    routeBoundary: "#advanced-memory",
    componentBoundary: "DashboardMemorySurface",
    sections: ["memory", "notes"],
    states: {
      loading: "Loading memory state.",
      empty: "No memory entries are available.",
      error: "Memory state could not be loaded.",
      permission: "Memory access requires an authenticated operator."
    }
  },
  {
    id: "provenance",
    label: "Provenance",
    routeBoundary: "#section-provenance",
    componentBoundary: "DashboardProvenanceSurface",
    sections: ["provenance", "artifacts", "notes"],
    states: {
      loading: "Loading provenance state.",
      empty: "No provenance records are available.",
      error: "Provenance state could not be loaded.",
      permission: "Provenance access requires workspace access."
    }
  },
  {
    id: "observability",
    label: "Observability",
    routeBoundary: "#advanced-operations",
    componentBoundary: "DashboardObservabilitySurface",
    sections: ["operations", "autopilot"],
    states: {
      loading: "Loading observability state.",
      empty: "No telemetry findings are available.",
      error: "Observability state could not be loaded.",
      permission: "Observability access requires workspace access."
    }
  }
] as const;

export type DashboardOsSurface = (typeof dashboardOsSurfaces)[number];
export type DashboardOsSurfaceId = DashboardOsSurface["id"];

export function isAdvancedDashboardSection(section: string | null | undefined): section is AdvancedDashboardSection {
  if (!section) {
    return false;
  }

  return (advancedDashboardSections as readonly string[]).includes(section);
}

export function getDashboardOsSurface(id: string | null | undefined): DashboardOsSurface | null {
  if (!id) {
    return null;
  }

  return dashboardOsSurfaces.find((surface) => surface.id === id) ?? null;
}

export function getDashboardOsSurfaceForSection(section: string | null | undefined): DashboardOsSurface[] {
  if (!section) {
    return [];
  }

  return dashboardOsSurfaces.filter((surface) => (surface.sections as readonly string[]).includes(section));
}

export { advancedDashboardSections as ADVANCED_DASHBOARD_SECTIONS };
export { dashboardOsSurfaces as DASHBOARD_OS_SURFACES };
