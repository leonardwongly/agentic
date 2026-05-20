import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const DEFAULT_REMEDIATION_EVIDENCE_MAP_PATH = "config/remediation/issue-evidence-map.json";

export type RemediationEvidenceKind = "config" | "docs" | "script" | "test" | "ci" | "github_issue" | "github_pr";

export type RemediationEvidenceReference = {
  kind: RemediationEvidenceKind;
  ref: string;
  note: string;
};

export type RemediationEvidenceStatus = "implemented" | "blocked" | "superseded" | "open";

export type RemediationEvidenceEntry = {
  issue: number;
  parent?: number;
  title: string;
  status: RemediationEvidenceStatus;
  ownerLane: string;
  implementationProof: RemediationEvidenceReference[];
  validationGates: string[];
  deploymentProof: {
    status: "not_required" | "blocked" | "available";
    evidence: RemediationEvidenceReference[];
    blockers?: number[];
  };
  residualRisks: Array<{
    title: string;
    owner: string;
    blockerIssues?: number[];
    mitigation: string;
  }>;
  blockers?: number[];
};

export type RemediationEvidenceMap = {
  version: 1;
  generatedFor: string;
  roadmapIssue: number;
  workstreamIssue: number;
  entries: RemediationEvidenceEntry[];
};

export type RemediationEvidenceMapIssue = {
  path: string;
  issue?: number;
  message: string;
};

export type RemediationEvidenceMapReport = {
  ok: boolean;
  summary: {
    entries: number;
    blockedEntries: number;
    entriesWithDeploymentProof: number;
    residualRisks: number;
  };
  issues: RemediationEvidenceMapIssue[];
};

const REQUIRED_W7_ISSUES = [184, 185, 186, 187, 188];
const PRODUCTION_PROOF_ISSUE = 190;
const REQUIRED_PRODUCTION_PROOF_VALIDATION_GATES = [
  "npm run deploy:ingress:check",
  "npm run db:status -- --require-ready",
  "npm run test:smoke:deployment",
  "npm run test:smoke:deployment-async",
  "npm run github:app-sync:preflight",
  "npm run release:closeout:evidence"
];
const REQUIRED_PRODUCTION_PROOF_EVIDENCE_REFS = [
  "scripts/github-app-sync-live-preflight.ts",
  "config/release/production-runtime-closeout.json"
];
const REQUIRED_ROADMAP_ISSUE = 152;
const REQUIRED_WORKSTREAM_ISSUE = 184;
const GITHUB_AGENTIC_URL_PATTERN = /^https:\/\/github\.com\/leonardwongly\/agentic\/(?:issues|pull)\/\d+$/u;
const ISSUE_REF_PATTERN = /^#\d+$/u;
const REPO_PATH_PATTERN = /^(?:\.github|apps|config|deploy|docs|packages|scripts|tests|README\.md|SECURITY\.md|Dockerfile|package\.json|package-lock\.json)(?:\/|$)/u;
const SECRET_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bghp_[A-Za-z0-9_]{20,}\b/u,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/u,
  /\bsk-[A-Za-z0-9]{20,}\b/u,
  /\bpostgres(?:ql)?:\/\/[^/\s:@]+:[^@\s]+@/iu,
  /\bhttps?:\/\/[^/\s:@]+:[^@\s]+@/iu,
  /[?&](?:access_)?(?:token|secret|key|password)=[^&\s<>"']{8,}/iu
];

function issue(pathValue: string, message: string, issueNumber?: number): RemediationEvidenceMapIssue {
  return { path: pathValue, issue: issueNumber, message };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRepoPath(value: string) {
  return path.posix.normalize(value.replaceAll("\\", "/").replace(/^\.\/+/u, "").trim());
}

function collectStrings(value: unknown, prefix: string): Array<{ path: string; value: string }> {
  if (typeof value === "string") {
    return [{ path: prefix, value }];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectStrings(entry, `${prefix}[${index}]`));
  }

  if (isObject(value)) {
    return Object.entries(value).flatMap(([key, entry]) => collectStrings(entry, `${prefix}.${key}`));
  }

  return [];
}

function isSafeEvidenceReference(evidence: RemediationEvidenceReference, cwd: string) {
  if (evidence.kind === "github_issue" || evidence.kind === "github_pr") {
    return ISSUE_REF_PATTERN.test(evidence.ref) || GITHUB_AGENTIC_URL_PATTERN.test(evidence.ref);
  }

  if (evidence.kind === "ci") {
    return evidence.ref.trim().length > 0;
  }

  const evidencePath = normalizeRepoPath(evidence.ref);
  return REPO_PATH_PATTERN.test(evidencePath) && existsSync(path.join(cwd, evidencePath));
}

function validateEvidenceReferences(
  references: RemediationEvidenceReference[] | undefined,
  pathValue: string,
  cwd: string,
  issues: RemediationEvidenceMapIssue[],
  issueNumber?: number
) {
  if (!Array.isArray(references) || references.length === 0) {
    issues.push(issue(pathValue, "At least one evidence reference is required.", issueNumber));
    return;
  }

  references.forEach((reference, index) => {
    const referencePath = `${pathValue}[${index}]`;

    if (!reference.note?.trim()) {
      issues.push(issue(`${referencePath}.note`, "Evidence references must explain what they prove.", issueNumber));
    }

    if (!reference.ref?.trim()) {
      issues.push(issue(`${referencePath}.ref`, "Evidence references must include a ref.", issueNumber));
      return;
    }

    if (!isSafeEvidenceReference(reference, cwd)) {
      issues.push(
        issue(
          `${referencePath}.ref`,
          `Evidence reference '${reference.ref}' is not a safe ${reference.kind} reference or does not resolve.`,
          issueNumber
        )
      );
    }
  });
}

export function validateRemediationEvidenceMap(
  map: RemediationEvidenceMap,
  options: { cwd: string }
): RemediationEvidenceMapReport {
  const issues: RemediationEvidenceMapIssue[] = [];

  if (!isObject(map)) {
    return {
      ok: false,
      summary: {
        entries: 0,
        blockedEntries: 0,
        entriesWithDeploymentProof: 0,
        residualRisks: 0
      },
      issues: [issue("map", "Remediation evidence map must be a JSON object.")]
    };
  }

  if (map.version !== 1) {
    issues.push(issue("version", "Remediation evidence map version must be 1."));
  }

  if (map.roadmapIssue !== REQUIRED_ROADMAP_ISSUE) {
    issues.push(issue("roadmapIssue", "Remediation evidence map must link roadmap issue #152."));
  }

  if (map.workstreamIssue !== REQUIRED_WORKSTREAM_ISSUE) {
    issues.push(issue("workstreamIssue", "Remediation evidence map must link workstream issue #184."));
  }

  const seenIssues = new Set<number>();
  if (!Array.isArray(map.entries)) {
    issues.push(issue("entries", "Remediation evidence map entries must be an array."));
  } else {
    map.entries.forEach((entry, index) => {
      const entryPath = `entries[${index}]`;
      seenIssues.add(entry.issue);

      const isRequiredW7Child = REQUIRED_W7_ISSUES.includes(entry.issue) && entry.issue !== map.workstreamIssue;
      if (isRequiredW7Child && entry.parent !== map.workstreamIssue) {
        issues.push(issue(`${entryPath}.parent`, `Issue #${entry.issue} must link back to #184.`, entry.issue));
      }

      if ((entry.status === "blocked" || entry.status === "open") && (entry.blockers ?? []).length === 0) {
        issues.push(issue(`${entryPath}.blockers`, "Open or blocked entries must link blockers.", entry.issue));
      }

      if (!entry.ownerLane?.trim()) {
        issues.push(issue(`${entryPath}.ownerLane`, "Entries must define an owner lane.", entry.issue));
      }

      if (!Array.isArray(entry.validationGates) || entry.validationGates.length === 0) {
        issues.push(issue(`${entryPath}.validationGates`, "Entries must list validation gates.", entry.issue));
      }

      validateEvidenceReferences(entry.implementationProof, `${entryPath}.implementationProof`, options.cwd, issues, entry.issue);

      if (entry.issue === PRODUCTION_PROOF_ISSUE) {
        const validationGates = new Set(entry.validationGates);
        for (const requiredGate of REQUIRED_PRODUCTION_PROOF_VALIDATION_GATES) {
          if (!validationGates.has(requiredGate)) {
            issues.push(
              issue(
                `${entryPath}.validationGates`,
                `Production proof evidence must include validation gate '${requiredGate}'.`,
                entry.issue
              )
            );
          }
        }

        const implementationRefs = new Set((entry.implementationProof ?? []).map(reference => reference.ref));
        for (const requiredRef of REQUIRED_PRODUCTION_PROOF_EVIDENCE_REFS) {
          if (!implementationRefs.has(requiredRef)) {
            issues.push(
              issue(
                `${entryPath}.implementationProof`,
                `Production proof evidence must include '${requiredRef}'.`,
                entry.issue
              )
            );
          }
        }
      }

      if (entry.deploymentProof.status !== "not_required") {
        if ((entry.deploymentProof.blockers ?? []).length === 0 && entry.deploymentProof.status === "blocked") {
          issues.push(
            issue(`${entryPath}.deploymentProof.blockers`, "Blocked deployment proof must link blockers.", entry.issue)
          );
        }

        validateEvidenceReferences(entry.deploymentProof.evidence, `${entryPath}.deploymentProof.evidence`, options.cwd, issues, entry.issue);
      }

      for (const [riskIndex, risk] of entry.residualRisks.entries()) {
        if (!risk.title?.trim() || !risk.owner?.trim() || !risk.mitigation?.trim()) {
          issues.push(issue(`${entryPath}.residualRisks[${riskIndex}]`, "Residual risks must include title, owner, and mitigation.", entry.issue));
        }

        if ((risk.blockerIssues ?? []).length === 0) {
          issues.push(issue(`${entryPath}.residualRisks[${riskIndex}].blockerIssues`, "Residual risks must link blocker issues.", entry.issue));
        }
      }
    });

    for (const requiredIssue of REQUIRED_W7_ISSUES) {
      if (!seenIssues.has(requiredIssue)) {
        issues.push(issue("entries", `Required W7 issue #${requiredIssue} is missing from the evidence map.`, requiredIssue));
      }
    }
  }

  for (const entry of collectStrings(map, "map")) {
    for (const pattern of SECRET_VALUE_PATTERNS) {
      if (pattern.test(entry.value)) {
        issues.push(issue(entry.path, "Evidence maps must not contain raw secrets, tokens, credentials, or URL credentials."));
        break;
      }
    }
  }

  const entries = Array.isArray(map.entries) ? map.entries : [];
  return {
    ok: issues.length === 0,
    summary: {
      entries: entries.length,
      blockedEntries: entries.filter(entry => entry.status === "blocked" || entry.status === "open").length,
      entriesWithDeploymentProof: entries.filter(entry => entry.deploymentProof.status === "available").length,
      residualRisks: entries.reduce((count, entry) => count + entry.residualRisks.length, 0)
    },
    issues
  };
}

export function readRemediationEvidenceMap(
  mapPath = DEFAULT_REMEDIATION_EVIDENCE_MAP_PATH,
  options: { cwd?: string } = {}
) {
  const cwd = options.cwd ?? process.cwd();
  const resolvedPath = path.isAbsolute(mapPath) ? mapPath : path.join(cwd, mapPath);
  return JSON.parse(readFileSync(resolvedPath, "utf8")) as RemediationEvidenceMap;
}

export function renderRemediationEvidenceMapReport(report: RemediationEvidenceMapReport) {
  const lines = [
    `Remediation evidence map ${report.ok ? "passed" : "failed"}.`,
    `- Entries: ${report.summary.entries}`,
    `- Blocked entries: ${report.summary.blockedEntries}`,
    `- Entries with deployment proof: ${report.summary.entriesWithDeploymentProof}`,
    `- Residual risks: ${report.summary.residualRisks}`
  ];

  if (report.issues.length > 0) {
    lines.push("", "Issues:");
    for (const mapIssue of report.issues) {
      const issuePrefix = mapIssue.issue ? `#${mapIssue.issue} ` : "";
      lines.push(`- ${issuePrefix}${mapIssue.path}: ${mapIssue.message}`);
    }
  }

  return lines.join("\n");
}
