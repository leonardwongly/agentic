const advancedDashboardSections = [
  "workspaces",
  "governance",
  "autopilot",
  "operator-products",
  "operations",
  "memory",
  "integrations",
  "notes",
  "watchers",
  "templates",
  "agents"
] as const;

export type AdvancedDashboardSection = (typeof advancedDashboardSections)[number];

export function isAdvancedDashboardSection(section: string | null | undefined): section is AdvancedDashboardSection {
  if (!section) {
    return false;
  }

  return (advancedDashboardSections as readonly string[]).includes(section);
}

export { advancedDashboardSections as ADVANCED_DASHBOARD_SECTIONS };
