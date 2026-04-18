import { buildSpdxDocument } from "../scripts/generate-sbom";

describe("sbom generation", () => {
  it("emits an SPDX document with root and runtime packages", () => {
    const document = buildSpdxDocument(
      {
        lockfileVersion: 3,
        name: "agentic",
        packages: {
          "": {
            name: "agentic"
          },
          "node_modules/next": {
            version: "16.2.4",
            resolved: "https://registry.npmjs.org/next/-/next-16.2.4.tgz",
            integrity: "sha512-test-next"
          },
          "node_modules/@types/node": {
            version: "24.9.1",
            dev: true
          },
          "packages/contracts": {
            name: "@agentic/contracts",
            version: "0.0.0"
          }
        }
      },
      {
        name: "agentic"
      },
      new Date("2026-04-18T00:00:00.000Z")
    );

    expect(document.spdxVersion).toBe("SPDX-2.3");
    expect(document.packages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          SPDXID: "SPDXRef-Package-root",
          name: "agentic",
          versionInfo: "0.0.0"
        }),
        expect.objectContaining({
          name: "next",
          versionInfo: "16.2.4",
          externalRefs: [
            expect.objectContaining({
              referenceLocator: "pkg:npm/next@16.2.4"
            })
          ]
        }),
        expect.objectContaining({
          name: "@agentic/contracts",
          versionInfo: "0.0.0"
        })
      ])
    );
    expect(document.packages.some((entry) => entry.name === "@types/node")).toBe(false);
    expect(document.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          spdxElementId: "SPDXRef-DOCUMENT",
          relationshipType: "DESCRIBES",
          relatedSpdxElement: "SPDXRef-Package-root"
        })
      ])
    );
  });
});
