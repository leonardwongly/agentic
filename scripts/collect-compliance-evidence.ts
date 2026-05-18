import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

interface ComplianceAutomatedCheck {
  id: string;
  title: string;
  command: string;
  sourcePaths: string[];
}

interface ComplianceEvidenceArtifact {
  path: string;
  description: string;
  required?: boolean;
}

interface ComplianceTraceability {
  issueNumbers: number[];
  issueLabels: string[];
  routePaths: string[];
}

interface ComplianceControl {
  id: string;
  family: string;
  title: string;
  objective: string;
  owner: string;
  traceability: ComplianceTraceability;
  trustBoundaries: string[];
  productSurfaces: string[];
  codePaths: string[];
  runbooks: string[];
  automatedChecks: ComplianceAutomatedCheck[];
  evidenceArtifacts: ComplianceEvidenceArtifact[];
  risks: string[];
  metrics: string[];
}

interface ComplianceControlRegistry {
  version: number;
  reviewedAt: string;
  owners: string[];
  controls: ComplianceControl[];
}

export interface ComplianceReferenceStatus {
  path: string;
  exists: boolean;
  kind: "file" | "directory" | "missing";
  sha256?: string;
}

export interface ComplianceArtifactStatus extends ComplianceReferenceStatus {
  description: string;
  required: boolean;
}

export type ComplianceControlStatus = "ready" | "missing-artifacts";

export interface ComplianceControlEvidence {
  id: string;
  family: string;
  title: string;
  objective: string;
  owner: string;
  traceability: {
    issueNumbers: number[];
    issueLabels: string[];
    routePaths: ComplianceReferenceStatus[];
  };
  trustBoundaries: string[];
  productSurfaces: string[];
  codePaths: ComplianceReferenceStatus[];
  runbooks: ComplianceReferenceStatus[];
  automatedChecks: Array<
    ComplianceAutomatedCheck & {
      sourcePaths: ComplianceReferenceStatus[];
    }
  >;
  evidenceArtifacts: ComplianceArtifactStatus[];
  risks: string[];
  metrics: string[];
  status: ComplianceControlStatus;
  missingRequiredArtifactPaths: string[];
}

export interface ComplianceEvidenceBundle {
  generatedAt: string;
  reviewedAt: string;
  registryVersion: number;
  owners: string[];
  summary: {
    totalControls: number;
    readyControls: number;
    failingControls: number;
    totalRequiredArtifacts: number;
    missingReferences: number;
    missingRequiredArtifacts: number;
  };
  controls: ComplianceControlEvidence[];
}

export interface ComplianceRegistryReferenceIssue {
  controlId: string;
  kind: "codePath" | "runbook" | "automatedCheckSource" | "routePath";
  path: string;
  checkId?: string;
}

function expectedGeneratedArtifactPaths(outputDir: string): string[] {
  return [
    path.posix.join(outputDir, "control-matrix.json"),
    path.posix.join(outputDir, "control-matrix.md"),
    path.posix.join(outputDir, "evidence-manifest.json"),
    path.posix.join(outputDir, "reviewer-summary.md")
  ];
}

function parseArgs(argv: string[]) {
  let outputDir = "artifacts/compliance";
  let registryPath = "config/compliance/controls.json";
  let requireArtifacts = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case "--output-dir":
        if (!next) {
          throw new Error("Missing value for --output-dir.");
        }
        outputDir = next;
        index += 1;
        break;
      case "--registry":
        if (!next) {
          throw new Error("Missing value for --registry.");
        }
        registryPath = next;
        index += 1;
        break;
      case "--require-artifacts":
        requireArtifacts = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { outputDir, registryPath, requireArtifacts };
}

function sha256File(filePath: string): string {
  const hash = createHash("sha256");
  const descriptor = openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);

  try {
    let bytesRead = 0;
    do {
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) {
        hash.update(buffer.subarray(0, bytesRead));
      }
    } while (bytesRead > 0);
  } finally {
    closeSync(descriptor);
  }

  return hash.digest("hex");
}

function inspectReference(cwd: string, relativePath: string): ComplianceReferenceStatus {
  const resolvedPath = path.resolve(cwd, relativePath);
  if (!existsSync(resolvedPath)) {
    return {
      path: relativePath,
      exists: false,
      kind: "missing"
    };
  }

  const stats = statSync(resolvedPath);
  if (stats.isDirectory()) {
    return {
      path: relativePath,
      exists: true,
      kind: "directory"
    };
  }

  return {
    path: relativePath,
    exists: true,
    kind: "file",
    sha256: sha256File(resolvedPath)
  };
}

function isApiRoutePath(relativePath: string): boolean {
  return relativePath.startsWith("apps/web/app/api/") && relativePath.endsWith("/route.ts");
}

function assertComplianceTraceability(control: ComplianceControl) {
  const traceability = control.traceability;
  if (!traceability) {
    throw new Error(`Control ${control.id} must define traceability.`);
  }

  if (
    !Array.isArray(traceability.issueNumbers) ||
    traceability.issueNumbers.length === 0 ||
    traceability.issueNumbers.some((issueNumber) => !Number.isInteger(issueNumber) || issueNumber <= 0)
  ) {
    throw new Error(`Control ${control.id} must trace at least one positive integer issue number.`);
  }

  if (
    !Array.isArray(traceability.issueLabels) ||
    traceability.issueLabels.length === 0 ||
    traceability.issueLabels.some((label) => label.trim().length === 0)
  ) {
    throw new Error(`Control ${control.id} must trace at least one issue label.`);
  }

  if (!Array.isArray(traceability.routePaths)) {
    throw new Error(`Control ${control.id} traceability.routePaths must be an array.`);
  }

  const codeRoutePaths = control.codePaths.filter(isApiRoutePath).sort();
  const tracedRoutePaths = [...traceability.routePaths].sort();

  if (tracedRoutePaths.some((routePath) => !isApiRoutePath(routePath))) {
    throw new Error(`Control ${control.id} traceability.routePaths must contain app/api route files only.`);
  }

  if (codeRoutePaths.join("\n") !== tracedRoutePaths.join("\n")) {
    throw new Error(`Control ${control.id} traceability.routePaths must match API route code paths.`);
  }
}

export function loadComplianceControlRegistry(filePath: string): ComplianceControlRegistry {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  const raw = JSON.parse(readFileSync(resolvedPath, "utf8")) as ComplianceControlRegistry;

  if (raw.version !== 1) {
    throw new Error(`Unsupported compliance control registry version: ${raw.version}`);
  }

  if (!Array.isArray(raw.owners) || raw.owners.length === 0) {
    throw new Error("Compliance control registry must define one or more owners.");
  }

  if (!Array.isArray(raw.controls) || raw.controls.length === 0) {
    throw new Error("Compliance control registry must define at least one control.");
  }

  const ids = new Set<string>();
  for (const control of raw.controls) {
    if (!control.id || !control.family || !control.title || !control.objective || !control.owner) {
      throw new Error("Every control must define id, family, title, objective, and owner.");
    }

    if (ids.has(control.id)) {
      throw new Error(`Duplicate compliance control id: ${control.id}`);
    }
    ids.add(control.id);

    if (
      control.trustBoundaries.length === 0 ||
      control.productSurfaces.length === 0 ||
      control.codePaths.length === 0 ||
      control.runbooks.length === 0 ||
      control.automatedChecks.length === 0 ||
      control.evidenceArtifacts.length === 0
    ) {
      throw new Error(`Control ${control.id} must define trust boundaries, product surfaces, code paths, runbooks, checks, and evidence artifacts.`);
    }

    assertComplianceTraceability(control);
  }

  return raw;
}

export function findMissingComplianceRegistryReferences(
  registry: ComplianceControlRegistry,
  options?: {
    cwd?: string;
  }
): ComplianceRegistryReferenceIssue[] {
  const cwd = options?.cwd ?? process.cwd();
  const issues: ComplianceRegistryReferenceIssue[] = [];

  for (const control of registry.controls) {
    for (const codePath of control.codePaths) {
      if (!inspectReference(cwd, codePath).exists) {
        issues.push({
          controlId: control.id,
          kind: "codePath",
          path: codePath
        });
      }
    }

    for (const runbook of control.runbooks) {
      if (!inspectReference(cwd, runbook).exists) {
        issues.push({
          controlId: control.id,
          kind: "runbook",
          path: runbook
        });
      }
    }

    for (const routePath of control.traceability.routePaths) {
      if (!inspectReference(cwd, routePath).exists) {
        issues.push({
          controlId: control.id,
          kind: "routePath",
          path: routePath
        });
      }
    }

    for (const check of control.automatedChecks) {
      for (const sourcePath of check.sourcePaths) {
        if (!inspectReference(cwd, sourcePath).exists) {
          issues.push({
            controlId: control.id,
            kind: "automatedCheckSource",
            path: sourcePath,
            checkId: check.id
          });
        }
      }
    }
  }

  return issues;
}

export function buildComplianceEvidenceBundle(
  registry: ComplianceControlRegistry,
  options?: {
    cwd?: string;
    now?: Date;
    requireArtifacts?: boolean;
    generatedArtifactPaths?: string[];
  }
): ComplianceEvidenceBundle {
  const cwd = options?.cwd ?? process.cwd();
  const now = options?.now ?? new Date();
  const requireArtifacts = options?.requireArtifacts ?? false;
  const generatedArtifactPaths = new Set(options?.generatedArtifactPaths ?? []);

  let missingReferences = 0;
  let missingRequiredArtifacts = 0;
  let totalRequiredArtifacts = 0;
  let readyControls = 0;
  let failingControls = 0;

  const controls = registry.controls.map<ComplianceControlEvidence>((control) => {
    const codePaths = control.codePaths.map((entry) => inspectReference(cwd, entry));
    const runbooks = control.runbooks.map((entry) => inspectReference(cwd, entry));
    const traceabilityRoutePaths = control.traceability.routePaths.map((entry) => inspectReference(cwd, entry));
    const automatedChecks = control.automatedChecks.map((check) => ({
      ...check,
      sourcePaths: check.sourcePaths.map((entry) => inspectReference(cwd, entry))
    }));
    const evidenceArtifacts = control.evidenceArtifacts.map<ComplianceArtifactStatus>((artifact) => {
      const status = inspectReference(cwd, artifact.path);
      const required = artifact.required !== false;
      if (required) {
        totalRequiredArtifacts += 1;
      }

      return {
        ...status,
        description: artifact.description,
        required
      };
    });

    for (const status of [
      ...codePaths,
      ...runbooks,
      ...traceabilityRoutePaths,
      ...automatedChecks.flatMap((check) => check.sourcePaths)
    ]) {
      if (!status.exists) {
        missingReferences += 1;
      }
    }

    for (const artifact of evidenceArtifacts) {
      if (!artifact.exists && artifact.required && !generatedArtifactPaths.has(artifact.path)) {
        missingRequiredArtifacts += 1;
      }
    }

    const missingRequiredArtifactPaths = evidenceArtifacts
      .filter((artifact) => !artifact.exists && artifact.required && !generatedArtifactPaths.has(artifact.path))
      .map((artifact) => artifact.path);
    const status: ComplianceControlStatus = missingRequiredArtifactPaths.length === 0 ? "ready" : "missing-artifacts";

    if (status === "ready") {
      readyControls += 1;
    } else {
      failingControls += 1;
    }

    return {
      id: control.id,
      family: control.family,
      title: control.title,
      objective: control.objective,
      owner: control.owner,
      traceability: {
        issueNumbers: control.traceability.issueNumbers,
        issueLabels: control.traceability.issueLabels,
        routePaths: traceabilityRoutePaths
      },
      trustBoundaries: control.trustBoundaries,
      productSurfaces: control.productSurfaces,
      codePaths,
      runbooks,
      automatedChecks,
      evidenceArtifacts,
      risks: control.risks,
      metrics: control.metrics,
      status,
      missingRequiredArtifactPaths
    };
  });

  if (missingReferences > 0) {
    throw new Error(`Compliance control registry contains ${missingReferences} missing file references.`);
  }

  if (requireArtifacts && missingRequiredArtifacts > 0) {
    throw new Error(`Compliance evidence collection is missing ${missingRequiredArtifacts} required artifact(s).`);
  }

  return {
    generatedAt: now.toISOString(),
    reviewedAt: registry.reviewedAt,
    registryVersion: registry.version,
    owners: registry.owners,
    summary: {
      totalControls: controls.length,
      readyControls,
      failingControls,
      totalRequiredArtifacts,
      missingReferences,
      missingRequiredArtifacts
    },
    controls
  };
}

export function renderComplianceEvidenceMarkdown(bundle: ComplianceEvidenceBundle): string {
  const lines: string[] = [
    "# Compliance Control Matrix",
    "",
    `Generated at: ${bundle.generatedAt}`,
    `Registry version: ${bundle.registryVersion}`,
    `Reviewed at: ${bundle.reviewedAt}`,
    `Owners: ${bundle.owners.join(", ")}`,
    "",
    "## Summary",
    "",
    `- Controls: ${bundle.summary.totalControls}`,
    `- Ready controls: ${bundle.summary.readyControls}`,
    `- Controls needing evidence: ${bundle.summary.failingControls}`,
    `- Required evidence artifacts: ${bundle.summary.totalRequiredArtifacts}`,
    `- Missing references: ${bundle.summary.missingReferences}`,
    `- Missing required artifacts: ${bundle.summary.missingRequiredArtifacts}`
  ];

  for (const control of bundle.controls) {
    lines.push(
      "",
      `## ${control.id} ${control.title}`,
      "",
      `Family: ${control.family}`,
      `Owner: ${control.owner}`,
      `Status: ${control.status}`,
      "",
      control.objective,
      ""
    );
    lines.push("### Issue traceability", "");
    lines.push(`- Issues: ${control.traceability.issueNumbers.map((issueNumber) => `#${issueNumber}`).join(", ")}`);
    lines.push(`- Labels: ${control.traceability.issueLabels.join(", ")}`);
    lines.push(
      "- Route coverage:",
      ...(
        control.traceability.routePaths.length > 0
          ? control.traceability.routePaths.map((entry) => `  - ${entry.path} (${entry.kind})`)
          : ["  - none"]
      )
    );
    lines.push("### Trust boundaries", "", ...control.trustBoundaries.map((entry) => `- ${entry}`));
    lines.push("", "### Product surfaces", "", ...control.productSurfaces.map((entry) => `- ${entry}`));
    lines.push("", "### Code paths", "", ...control.codePaths.map((entry) => `- ${entry.path} (${entry.kind})`));
    lines.push("", "### Runbooks", "", ...control.runbooks.map((entry) => `- ${entry.path} (${entry.kind})`));
    lines.push("", "### Automated checks", "");
    for (const check of control.automatedChecks) {
      lines.push(`- ${check.id}: ${check.title}`);
      lines.push(`  Command: ${check.command}`);
      for (const sourcePath of check.sourcePaths) {
        lines.push(`  Source: ${sourcePath.path} (${sourcePath.kind})`);
      }
    }
    lines.push("", "### Evidence artifacts", "");
    for (const artifact of control.evidenceArtifacts) {
      lines.push(`- ${artifact.path} (${artifact.exists ? artifact.kind : "missing"})`);
      lines.push(`  Description: ${artifact.description}`);
      lines.push(`  Required: ${artifact.required ? "yes" : "no"}`);
      if (artifact.sha256) {
        lines.push(`  SHA-256: ${artifact.sha256}`);
      }
    }
    if (control.missingRequiredArtifactPaths.length > 0) {
      lines.push("", "### Missing required artifacts", "", ...control.missingRequiredArtifactPaths.map((entry) => `- ${entry}`));
    }
    lines.push("", "### Risks", "", ...control.risks.map((entry) => `- ${entry}`));
    lines.push("", "### Metrics", "", ...control.metrics.map((entry) => `- ${entry}`));
  }

  return `${lines.join("\n")}\n`;
}

export function renderComplianceReviewerSummary(bundle: ComplianceEvidenceBundle): string {
  const lines: string[] = [
    "# Compliance Evidence Reviewer Summary",
    "",
    `Generated at: ${bundle.generatedAt}`,
    `Reviewed at: ${bundle.reviewedAt}`,
    "",
    "## Status",
    "",
    `- Controls ready: ${bundle.summary.readyControls}/${bundle.summary.totalControls}`,
    `- Controls missing evidence: ${bundle.summary.failingControls}`,
    `- Missing references: ${bundle.summary.missingReferences}`,
    `- Missing required artifacts: ${bundle.summary.missingRequiredArtifacts}`
  ];

  const failingControls = bundle.controls.filter((control) => control.status !== "ready");

  if (failingControls.length === 0) {
    lines.push("", "All controls have the required evidence artifacts for this bundle.");
    return `${lines.join("\n")}\n`;
  }

  lines.push("", "## Controls needing follow-up", "");
  for (const control of failingControls) {
    lines.push(`- ${control.id} ${control.title}`);
    lines.push(`  Owner: ${control.owner}`);
    for (const artifactPath of control.missingRequiredArtifactPaths) {
      lines.push(`  Missing artifact: ${artifactPath}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function appendGitHubStepSummary(markdown: string) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    return;
  }

  writeFileSync(summaryPath, markdown, {
    encoding: "utf8",
    flag: "a"
  });
}

function writeOutputFiles(outputDir: string, bundle: ComplianceEvidenceBundle) {
  const resolvedOutputDir = path.resolve(process.cwd(), outputDir);
  mkdirSync(resolvedOutputDir, { recursive: true });

  const controlMatrixJsonPath = path.join(resolvedOutputDir, "control-matrix.json");
  const controlMatrixMarkdownPath = path.join(resolvedOutputDir, "control-matrix.md");
  const evidenceManifestPath = path.join(resolvedOutputDir, "evidence-manifest.json");
  const reviewerSummaryPath = path.join(resolvedOutputDir, "reviewer-summary.md");

  writeFileSync(controlMatrixJsonPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  writeFileSync(controlMatrixMarkdownPath, renderComplianceEvidenceMarkdown(bundle), "utf8");
  writeFileSync(
    evidenceManifestPath,
    `${JSON.stringify(
      {
        generatedAt: bundle.generatedAt,
        summary: bundle.summary,
        controls: bundle.controls.map((control) => ({
          id: control.id,
          title: control.title,
          owner: control.owner,
          issueNumbers: control.traceability.issueNumbers,
          issueLabels: control.traceability.issueLabels,
          routePaths: control.traceability.routePaths.map((entry) => entry.path),
          status: control.status,
          missingRequiredArtifactPaths: control.missingRequiredArtifactPaths
        })),
        evidenceArtifacts: bundle.controls.flatMap((control) =>
          control.evidenceArtifacts.map((artifact) => ({
            controlId: control.id,
            path: artifact.path,
            description: artifact.description,
            required: artifact.required,
            exists: artifact.exists,
            sha256: artifact.sha256
          }))
        )
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  writeFileSync(reviewerSummaryPath, renderComplianceReviewerSummary(bundle), "utf8");
  appendGitHubStepSummary(`${renderComplianceReviewerSummary(bundle)}\n`);
}

function main() {
  const { outputDir, registryPath, requireArtifacts } = parseArgs(process.argv.slice(2));
  const registry = loadComplianceControlRegistry(registryPath);
  const generatedArtifacts = expectedGeneratedArtifactPaths(outputDir);
  const initialBundle = buildComplianceEvidenceBundle(registry, {
    requireArtifacts,
    generatedArtifactPaths: generatedArtifacts
  });
  writeOutputFiles(outputDir, initialBundle);
  const finalBundle = buildComplianceEvidenceBundle(registry, {
    requireArtifacts
  });
  writeOutputFiles(outputDir, finalBundle);
  console.log(`Wrote compliance evidence bundle to ${outputDir}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
