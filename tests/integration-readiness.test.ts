import { buildDefaultIntegrationAccounts, describeIntegrationReadiness, integrationSupportsExecutionMode } from "@agentic/integrations";

describe("describeIntegrationReadiness", () => {
  it("marks live notes as autonomous-grade", () => {
    const notes = buildDefaultIntegrationAccounts("user-1").find((integration) => integration.system === "notes");

    expect(notes).toBeDefined();
    expect(describeIntegrationReadiness(notes!)).toEqual(
      expect.objectContaining({
        tier: "autonomous-grade",
        supportedModes: ["draft", "approval", "autonomous"]
      })
    );
    expect(integrationSupportsExecutionMode(notes!, "autonomous")).toBe(true);
  });

  it("keeps manual email at draft-grade", () => {
    const email = {
      ...buildDefaultIntegrationAccounts("user-1").find((integration) => integration.system === "email")!,
      status: "manual" as const
    };

    expect(describeIntegrationReadiness(email)).toEqual(
      expect.objectContaining({
        tier: "draft-grade",
        supportedModes: ["draft"]
      })
    );
    expect(integrationSupportsExecutionMode(email, "approval")).toBe(false);
  });

  it("treats mock adapters as experimental", () => {
    const tasks = buildDefaultIntegrationAccounts("user-1").find((integration) => integration.system === "tasks");

    expect(tasks).toBeDefined();
    expect(describeIntegrationReadiness(tasks!)).toEqual(
      expect.objectContaining({
        tier: "experimental",
        supportedModes: []
      })
    );
  });
});
