import {
  buildPrivacyControlSummary,
  loadPrivacyControlRegistry,
  parsePrivacyControlRegistry
} from "@agentic/policy/src/privacy-controls";

describe("privacy control registry", () => {
  it("loads the checked-in registry and summarizes dataset coverage", () => {
    const registry = loadPrivacyControlRegistry();
    const summary = buildPrivacyControlSummary(registry);

    expect(registry.version).toBe(1);
    expect(registry.datasets).toHaveLength(4);
    expect(summary.totalDatasets).toBe(4);
    expect(summary.classifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "workspace_operational",
          datasetCount: 2
        }),
        expect.objectContaining({
          id: "shared_personal",
          datasetCount: 1
        }),
        expect.objectContaining({
          id: "regulated_export",
          datasetCount: 1
        })
      ])
    );
    expect(summary.lifecycleOperations).toEqual(["retention_enforcement", "workspace_export", "workspace_delete"]);
    expect(summary.datasets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "goal-share-records",
          classificationLabel: "Shared personal data",
          tokenizationStrategy: "opaque_identifier"
        }),
        expect.objectContaining({
          id: "audit-and-export-packages",
          retentionLabel: "365 days default via workspace governance",
          tokenizationStrategy: "redacted_reference"
        })
      ])
    );
  });

  it("rejects datasets that reference an unknown classification", () => {
    expect(() =>
      parsePrivacyControlRegistry({
        version: 1,
        reviewedAt: "2026-04-19T00:00:00.000Z",
        owners: ["platform-security"],
        classifications: [
          {
            id: "known",
            label: "Known",
            summary: "Known classification."
          }
        ],
        datasets: [
          {
            id: "unknown-ref",
            title: "Unknown ref",
            classificationId: "missing",
            productSurfaces: ["dashboard"],
            recordExamples: ["record"],
            codePaths: ["apps/web/app/api/governance/privacy/route.ts"],
            minimizationRules: ["Limit surface area."],
            maskingRules: ["Mask sensitive values."],
            tokenizationStrategy: "not_applicable",
            retention: {
              mode: "fixed",
              defaultDays: 30,
              deletionFlow: "Delete on expiry."
            },
            accessRules: ["Owner only."],
            lifecycleOperations: ["workspace_export"]
          }
        ]
      })
    ).toThrow(/unknown classification/iu);
  });

  it("rejects duplicate dataset ids instead of accepting ambiguous inventory entries", () => {
    expect(() =>
      parsePrivacyControlRegistry({
        version: 1,
        reviewedAt: "2026-04-19T00:00:00.000Z",
        owners: ["platform-security"],
        classifications: [
          {
            id: "known",
            label: "Known",
            summary: "Known classification."
          }
        ],
        datasets: [
          {
            id: "duplicate-id",
            title: "First dataset",
            classificationId: "known",
            productSurfaces: ["dashboard"],
            recordExamples: ["record"],
            codePaths: ["apps/web/app/api/governance/privacy/route.ts"],
            minimizationRules: ["Limit surface area."],
            maskingRules: ["Mask sensitive values."],
            tokenizationStrategy: "not_applicable",
            retention: {
              mode: "fixed",
              defaultDays: 30,
              deletionFlow: "Delete on expiry."
            },
            accessRules: ["Owner only."],
            lifecycleOperations: ["workspace_export"]
          },
          {
            id: "duplicate-id",
            title: "Second dataset",
            classificationId: "known",
            productSurfaces: ["privacy"],
            recordExamples: ["record"],
            codePaths: ["packages/policy/src/privacy-controls.ts"],
            minimizationRules: ["Limit surface area."],
            maskingRules: ["Mask sensitive values."],
            tokenizationStrategy: "redacted_reference",
            retention: {
              mode: "workspace_governance",
              defaultDays: 90,
              deletionFlow: "Delete on expiry."
            },
            accessRules: ["Owner only."],
            lifecycleOperations: ["workspace_delete"]
          }
        ]
      })
    ).toThrow(/duplicate privacy dataset id/iu);
  });
});
