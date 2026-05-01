import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildComplianceEvidenceBundle,
  findMissingComplianceRegistryReferences,
  loadComplianceControlRegistry,
  renderComplianceEvidenceMarkdown,
  renderComplianceReviewerSummary,
  type ComplianceEvidenceBundle,
  type ComplianceReferenceStatus
} from "../scripts/collect-compliance-evidence";

function writeFixture(root: string, relativePath: string, contents = "fixture") {
  const resolvedPath = path.join(root, relativePath);
  mkdirSync(path.dirname(resolvedPath), { recursive: true });
  writeFileSync(resolvedPath, contents, "utf8");
}

describe("compliance evidence collector", () => {
  it("builds a bundle with hashed references and required artifact accounting", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "agentic-compliance-"));

    writeFixture(root, "apps/web/lib/auth-runtime-state.ts");
    writeFixture(root, "docs/runbooks/security-incident-response.md");
    writeFixture(root, "tests/runtime-readiness.test.ts");
    writeFixture(root, "artifacts/security/runtime-audit-report.json", "{\"ok\":true}");

    const bundle = buildComplianceEvidenceBundle(
      {
        version: 1,
        reviewedAt: "2026-04-18T00:00:00.000Z",
        owners: ["platform-security"],
        controls: [
          {
            id: "AUTH-01",
            family: "Identity",
            title: "Auth control",
            objective: "Protect auth runtime",
            owner: "platform-security",
            trustBoundaries: ["browser to web"],
            productSurfaces: ["dashboard"],
            codePaths: ["apps/web/lib/auth-runtime-state.ts"],
            runbooks: ["docs/runbooks/security-incident-response.md"],
            automatedChecks: [
              {
                id: "CHECK-AUTH",
                title: "Auth test",
                command: "npm test -- runtime-readiness.test.ts",
                sourcePaths: ["tests/runtime-readiness.test.ts"]
              }
            ],
            evidenceArtifacts: [
              {
                path: "artifacts/security/runtime-audit-report.json",
                description: "Audit report",
                required: true
              }
            ],
            risks: ["session drift"],
            metrics: ["readiness pass rate"]
          }
        ]
      },
      {
        cwd: root,
        now: new Date("2026-04-18T12:00:00.000Z"),
        requireArtifacts: true
      }
    );

    expect(bundle.summary.totalControls).toBe(1);
    expect(bundle.summary.readyControls).toBe(1);
    expect(bundle.summary.failingControls).toBe(0);
    expect(bundle.summary.totalRequiredArtifacts).toBe(1);
    expect(bundle.summary.missingRequiredArtifacts).toBe(0);
    expect(bundle.controls[0]?.status).toBe("ready");
    expect(bundle.controls[0]?.missingRequiredArtifactPaths).toEqual([]);
    expect(bundle.controls[0]?.codePaths[0]).toEqual(
      expect.objectContaining({
        path: "apps/web/lib/auth-runtime-state.ts",
        exists: true,
        kind: "file",
        sha256: expect.any(String)
      })
    );
    expect(bundle.controls[0]?.evidenceArtifacts[0]).toEqual(
      expect.objectContaining({
        path: "artifacts/security/runtime-audit-report.json",
        exists: true,
        required: true,
        sha256: expect.any(String)
      })
    );
  });

  it("allows local generation without built artifacts when artifact enforcement is disabled", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "agentic-compliance-"));

    writeFixture(root, "apps/web/lib/request-client-identity.ts");
    writeFixture(root, "docs/runbooks/security-incident-response.md");
    writeFixture(root, "tests/public-share-view-route.test.ts");

    const bundle = buildComplianceEvidenceBundle(
      {
        version: 1,
        reviewedAt: "2026-04-18T00:00:00.000Z",
        owners: ["platform-security"],
        controls: [
          {
            id: "AUTH-02",
            family: "Identity",
            title: "Request identity control",
            objective: "Protect request identity",
            owner: "platform-security",
            trustBoundaries: ["proxy to app"],
            productSurfaces: ["public share"],
            codePaths: ["apps/web/lib/request-client-identity.ts"],
            runbooks: ["docs/runbooks/security-incident-response.md"],
            automatedChecks: [
              {
                id: "CHECK-IDENTITY",
                title: "Identity test",
                command: "npm test -- public-share-view-route.test.ts",
                sourcePaths: ["tests/public-share-view-route.test.ts"]
              }
            ],
            evidenceArtifacts: [
              {
                path: "artifacts/compliance/control-matrix.json",
                description: "Generated later in CI",
                required: true
              }
            ],
            risks: ["proxy spoofing"],
            metrics: ["identity rejection rate"]
          }
        ]
      },
      {
        cwd: root,
        now: new Date("2026-04-18T12:00:00.000Z"),
        requireArtifacts: false
      }
    );

    expect(bundle.summary.failingControls).toBe(1);
    expect(bundle.summary.missingRequiredArtifacts).toBe(1);
    expect(bundle.controls[0]?.status).toBe("missing-artifacts");
    expect(bundle.controls[0]?.missingRequiredArtifactPaths).toEqual(["artifacts/compliance/control-matrix.json"]);
  });

  it("fails when required artifacts are missing in strict mode", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "agentic-compliance-"));

    writeFixture(root, "apps/web/lib/runtime-readiness.ts");
    writeFixture(root, "docs/runbooks/deployment.md");
    writeFixture(root, "scripts/check-performance-fitness.ts");

    expect(() =>
      buildComplianceEvidenceBundle(
        {
          version: 1,
          reviewedAt: "2026-04-18T00:00:00.000Z",
          owners: ["platform"],
          controls: [
            {
              id: "ASYNC-01",
              family: "Resilience",
              title: "Async control",
              objective: "Queue heavy work",
              owner: "platform",
              trustBoundaries: ["web to worker"],
              productSurfaces: ["goals"],
              codePaths: ["apps/web/lib/runtime-readiness.ts"],
              runbooks: ["docs/runbooks/deployment.md"],
              automatedChecks: [
                {
                  id: "CHECK-PERF",
                  title: "Performance fitness",
                  command: "npm run test:performance:fitness",
                  sourcePaths: ["scripts/check-performance-fitness.ts"]
                }
              ],
              evidenceArtifacts: [
                {
                  path: "artifacts/build/agentic-runtime-bundle.tgz",
                  description: "Build bundle",
                  required: true
                }
              ],
              risks: ["timeouts"],
              metrics: ["queue depth"]
            }
          ]
        },
        {
          cwd: root,
          requireArtifacts: true
        }
      )
    ).toThrow(/missing 1 required artifact/iu);
  });

  it("does not fail strict mode for compliance artifacts that will be generated by the collector", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "agentic-compliance-"));

    writeFixture(root, "scripts/collect-compliance-evidence.ts");
    writeFixture(root, "docs/runbooks/security-incident-response.md");
    writeFixture(root, ".github/ISSUE_TEMPLATE/security-vulnerability-report.yml");

    const bundle = buildComplianceEvidenceBundle(
      {
        version: 1,
        reviewedAt: "2026-04-18T00:00:00.000Z",
        owners: ["platform-security"],
        controls: [
          {
            id: "OPS-01",
            family: "Operations",
            title: "Compliance outputs are self-generated",
            objective: "Allow strict validation to bootstrap generated evidence",
            owner: "platform-security",
            trustBoundaries: ["ci to artifact store"],
            productSurfaces: ["compliance evidence"],
            codePaths: [".github/ISSUE_TEMPLATE/security-vulnerability-report.yml"],
            runbooks: ["docs/runbooks/security-incident-response.md"],
            automatedChecks: [
              {
                id: "CHECK-COMPLIANCE",
                title: "Collector script",
                command: "npm run security:collect-evidence -- --require-artifacts",
                sourcePaths: ["scripts/collect-compliance-evidence.ts"]
              }
            ],
            evidenceArtifacts: [
              {
                path: "artifacts/compliance/control-matrix.json",
                description: "Generated control matrix",
                required: true
              }
            ],
            risks: ["implicit evidence"],
            metrics: ["bundle generation pass rate"]
          }
        ]
      },
      {
        cwd: root,
        requireArtifacts: true,
        generatedArtifactPaths: ["artifacts/compliance/control-matrix.json"]
      }
    );

    expect(bundle.summary.missingRequiredArtifacts).toBe(0);
  });

  it("keeps every real control-registry reference aligned with tracked source files", () => {
    const registry = loadComplianceControlRegistry("config/compliance/controls.json");
    const missing = findMissingComplianceRegistryReferences(registry);

    expect(missing).toEqual([]);
  });

  it("reports missing registry references with control and check context", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "agentic-compliance-"));

    writeFixture(root, "apps/web/lib/runtime-readiness.ts");
    writeFixture(root, "docs/runbooks/deployment.md");

    const missing = findMissingComplianceRegistryReferences(
      {
        version: 1,
        reviewedAt: "2026-04-18T00:00:00.000Z",
        owners: ["platform"],
        controls: [
          {
            id: "PIPELINE-01",
            family: "Operations",
            title: "Pipeline registry stays aligned",
            objective: "Catch stale paths before evidence collection.",
            owner: "platform",
            trustBoundaries: ["source to ci"],
            productSurfaces: ["build pipeline"],
            codePaths: ["apps/web/lib/runtime-readiness.ts", ".github/workflows/missing.yml"],
            runbooks: ["docs/runbooks/deployment.md", "docs/runbooks/missing.md"],
            automatedChecks: [
              {
                id: "CHECK-MISSING",
                title: "Missing check fixture",
                command: "npm test -- missing.test.ts",
                sourcePaths: ["tests/missing.test.ts"]
              }
            ],
            evidenceArtifacts: [
              {
                path: "artifacts/compliance/control-matrix.json",
                description: "Generated matrix"
              }
            ],
            risks: ["stale evidence"],
            metrics: ["registry validation pass rate"]
          }
        ]
      },
      {
        cwd: root
      }
    );

    expect(missing).toEqual([
      {
        controlId: "PIPELINE-01",
        kind: "codePath",
        path: ".github/workflows/missing.yml"
      },
      {
        controlId: "PIPELINE-01",
        kind: "runbook",
        path: "docs/runbooks/missing.md"
      },
      {
        controlId: "PIPELINE-01",
        kind: "automatedCheckSource",
        path: "tests/missing.test.ts",
        checkId: "CHECK-MISSING"
      }
    ]);
  });

  it("renders a human-readable markdown report", () => {
    const bundle: ComplianceEvidenceBundle = {
      generatedAt: "2026-04-18T12:00:00.000Z",
      reviewedAt: "2026-04-18T00:00:00.000Z",
      registryVersion: 1,
      owners: ["platform-security"],
      summary: {
        totalControls: 1,
        readyControls: 1,
        failingControls: 0,
        totalRequiredArtifacts: 1,
        missingReferences: 0,
        missingRequiredArtifacts: 0
      },
      controls: [
        {
          id: "SUPPLY-01",
          family: "Supply Chain",
          title: "Dependency gate",
          objective: "Fail closed on vulnerable runtime packages",
          owner: "platform-security",
          trustBoundaries: ["source to CI"],
          productSurfaces: ["build pipeline"],
          codePaths: [
            {
              path: ".github/workflows/ci.yml",
              exists: true,
              kind: "file",
              sha256: "abc"
            }
          ],
          runbooks: [
            {
              path: "docs/security/supply-chain-controls.md",
              exists: true,
              kind: "file",
              sha256: "def"
            }
          ],
          automatedChecks: [
            {
              id: "CHECK-SUPPLY",
              title: "Supply chain gate",
              command: "npm run security:audit-runtime",
              sourcePaths: [
                {
                  path: "scripts/runtime-vulnerability-gate.ts",
                  exists: true,
                  kind: "file",
                  sha256: "123"
                } satisfies ComplianceReferenceStatus
              ]
            }
          ],
          evidenceArtifacts: [
            {
              path: "artifacts/security/runtime-audit-report.json",
              description: "Audit report",
              required: true,
              exists: true,
              kind: "file",
              sha256: "456"
            }
          ],
          risks: ["shipping vulnerable deps"],
          metrics: ["blocking vulnerability count"]
          ,
          status: "ready",
          missingRequiredArtifactPaths: []
        }
      ]
    };

    const markdown = renderComplianceEvidenceMarkdown(bundle);

    expect(markdown).toContain("# Compliance Control Matrix");
    expect(markdown).toContain("## SUPPLY-01 Dependency gate");
    expect(markdown).toContain("Command: npm run security:audit-runtime");
    expect(markdown).toContain("SHA-256: 456");
  });

  it("renders a reviewer summary that highlights controls missing required evidence", () => {
    const bundle: ComplianceEvidenceBundle = {
      generatedAt: "2026-04-18T12:00:00.000Z",
      reviewedAt: "2026-04-18T00:00:00.000Z",
      registryVersion: 1,
      owners: ["platform-security"],
      summary: {
        totalControls: 2,
        readyControls: 1,
        failingControls: 1,
        totalRequiredArtifacts: 2,
        missingReferences: 0,
        missingRequiredArtifacts: 1
      },
      controls: [
        {
          id: "OPS-01",
          family: "Operations",
          title: "Incident response runbook",
          objective: "Keep the incident workflow documented.",
          owner: "platform-security",
          trustBoundaries: ["operator to incident queue"],
          productSurfaces: ["runbooks"],
          codePaths: [],
          runbooks: [],
          automatedChecks: [],
          evidenceArtifacts: [],
          risks: ["slow incident response"],
          metrics: ["time to acknowledge"],
          status: "ready",
          missingRequiredArtifactPaths: []
        },
        {
          id: "SUPPLY-02",
          family: "Supply Chain",
          title: "Runtime audit evidence",
          objective: "Retain vulnerability-gate evidence.",
          owner: "platform-security",
          trustBoundaries: ["ci to artifact store"],
          productSurfaces: ["build pipeline"],
          codePaths: [],
          runbooks: [],
          automatedChecks: [],
          evidenceArtifacts: [],
          risks: ["missing audit evidence"],
          metrics: ["evidence freshness"],
          status: "missing-artifacts",
          missingRequiredArtifactPaths: ["artifacts/security/runtime-audit-report.json"]
        }
      ]
    };

    const summary = renderComplianceReviewerSummary(bundle);

    expect(summary).toContain("# Compliance Evidence Reviewer Summary");
    expect(summary).toContain("Controls ready: 1/2");
    expect(summary).toContain("SUPPLY-02 Runtime audit evidence");
    expect(summary).toContain("Missing artifact: artifacts/security/runtime-audit-report.json");
  });
});
