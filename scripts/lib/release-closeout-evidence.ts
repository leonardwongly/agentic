import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const DEFAULT_RELEASE_CLOSEOUT_EVIDENCE_PATH = "config/release/production-runtime-closeout.json";

export type ReleaseCloseoutEvidenceKind =
  | "github_action"
  | "github_issue"
  | "github_pr"
  | "local_ci"
  | "repo_path"
  | "runtime_blocker";

export type ReleaseCloseoutEvidenceReference = {
  kind: ReleaseCloseoutEvidenceKind;
  ref: string;
  status: "passed" | "blocked" | "pending" | "ready";
  note: string;
};

export type ReleaseCloseoutStatus = "implemented" | "blocked" | "deferred";

export type ReleaseCloseoutTrackedIssue = {
  issue: number;
  parent?: number;
  title: string;
  status: ReleaseCloseoutStatus;
  blockers?: number[];
  evidence: ReleaseCloseoutEvidenceReference[];
};

export type ReleaseCloseoutPullRequest = {
  number: number;
  title: string;
  url: string;
  status: "open" | "merged" | "blocked";
  localValidation: string[];
  hostedStatus: string;
  blockerIssues?: number[];
};

export type ReleaseCloseoutValidationGate = {
  id: string;
  command: string;
  status: "passed" | "blocked" | "not_run";
  evidence: ReleaseCloseoutEvidenceReference[];
  blockerIssues?: number[];
  notes: string;
};

export type ReleaseCloseoutControl = {
  surface: string;
  action: string;
  evidence: ReleaseCloseoutEvidenceReference[];
};

export type ReleaseCloseoutResidualRisk = {
  id: string;
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "blocked" | "accepted" | "mitigated";
  owner: string;
  blockerIssues?: number[];
  mitigation: string;
};

export type ReleaseCloseoutEvidenceManifest = {
  version: 1;
  release: {
    name: string;
    environment: string;
    generatedForIssue: number;
    parentIssues: number[];
    status: "ready_with_blockers" | "ready" | "blocked";
  };
  pullRequests: ReleaseCloseoutPullRequest[];
  trackedIssues: ReleaseCloseoutTrackedIssue[];
  validationGates: ReleaseCloseoutValidationGate[];
  rollout: {
    targetStatus: "blocked" | "ready";
    targetSummary: string;
    rolloutSteps: string[];
    rollbackSteps: string[];
    disablement: ReleaseCloseoutControl[];
    secretRotation: ReleaseCloseoutControl[];
  };
  residualRisks: ReleaseCloseoutResidualRisk[];
  observability: {
    evidenceHooks: ReleaseCloseoutEvidenceReference[];
    retainedTelemetry: string;
    commands: string[];
  };
};

export type ReleaseCloseoutEvidenceIssue = {
  path: string;
  message: string;
};

export type ReleaseCloseoutEvidenceReport = {
  ok: boolean;
  summary: {
    pullRequests: number;
    trackedIssues: number;
    validationGates: number;
    blockedValidationGates: number;
    residualRisks: number;
  };
  issues: ReleaseCloseoutEvidenceIssue[];
};

const REQUIRED_CHILD_ISSUES = [286, 287, 288, 289, 290, 291, 292, 293, 294];
const REQUIRED_PARENT_ISSUES = [137, 146, 190];
const REQUIRED_VALIDATION_GATES = [
  "deploy-ingress-check",
  "db-status-require-ready",
  "deployment-smoke",
  "deployment-async-canary",
  "github-app-sync-preflight",
  "rollout-gate",
  "local-ci"
];
const GITHUB_AGENTIC_URL_PATTERN = /^https:\/\/github\.com\/leonardwongly\/agentic\/(?:issues|pull)\/\d+$/u;
const GITHUB_ACTION_URL_PATTERN = /^https:\/\/github\.com\/leonardwongly\/agentic\/actions\/runs\/\d+(?:\/job\/\d+)?$/u;
const ISSUE_REF_PATTERN = /^#\d+$/u;
const SAFE_REPO_PATH_PATTERN = /^(?:\.github|apps|config|deploy|docs|packages|scripts|tests|package\.json|package-lock\.json|tsconfig[^/]*\.json)(?:\/|$)/u;
const SECRET_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bghp_[A-Za-z0-9_]{20,}\b/u,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/u,
  /\bsk-[A-Za-z0-9]{20,}\b/u,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/u,
  /\bpostgres(?:ql)?:\/\/[^/\s:@]+:[^@\s]+@/iu,
  /\bhttps?:\/\/[^/\s:@]+:[^@\s]+@/iu,
  /[?&](?:access_)?(?:token|secret|key|password)=[^&\s<>"']{8,}/iu
];

function issue(pathValue: string, message: string): ReleaseCloseoutEvidenceIssue {
  return { path: pathValue, message };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeRepoPath(value: string) {
  return path.posix.normalize(value.replaceAll("\\", "/").replace(/^\.\/+/u, "").trim());
}

function isSafeReference(ref: string, kind: ReleaseCloseoutEvidenceKind, cwd: string) {
  if (kind === "github_issue" || kind === "github_pr") {
    return ISSUE_REF_PATTERN.test(ref) || GITHUB_AGENTIC_URL_PATTERN.test(ref);
  }

  if (kind === "github_action") {
    return GITHUB_ACTION_URL_PATTERN.test(ref);
  }

  if (kind === "local_ci" || kind === "runtime_blocker") {
    return isNonEmptyString(ref);
  }

  const repoPath = normalizeRepoPath(ref);
  return SAFE_REPO_PATH_PATTERN.test(repoPath) && existsSync(path.join(cwd, repoPath));
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

function validateEvidenceReference(
  evidence: ReleaseCloseoutEvidenceReference,
  evidencePath: string,
  cwd: string,
  issues: ReleaseCloseoutEvidenceIssue[]
) {
  if (!isNonEmptyString(evidence.note)) {
    issues.push(issue(`${evidencePath}.note`, "Evidence references must explain what they prove."));
  }

  if (!isNonEmptyString(evidence.ref)) {
    issues.push(issue(`${evidencePath}.ref`, "Evidence references must include a non-empty ref."));
    return;
  }

  if (!isSafeReference(evidence.ref, evidence.kind, cwd)) {
    issues.push(
      issue(
        `${evidencePath}.ref`,
        `Evidence reference '${evidence.ref}' is not a safe ${evidence.kind} reference or does not resolve.`
      )
    );
  }
}

function validateEvidenceList(
  evidence: ReleaseCloseoutEvidenceReference[] | undefined,
  evidencePath: string,
  cwd: string,
  issues: ReleaseCloseoutEvidenceIssue[]
) {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    issues.push(issue(evidencePath, "At least one evidence reference is required."));
    return;
  }

  evidence.forEach((entry, index) => validateEvidenceReference(entry, `${evidencePath}[${index}]`, cwd, issues));
}

export function validateReleaseCloseoutEvidenceManifest(
  manifest: ReleaseCloseoutEvidenceManifest,
  options: { cwd: string }
): ReleaseCloseoutEvidenceReport {
  const issues: ReleaseCloseoutEvidenceIssue[] = [];

  if (!isObject(manifest)) {
    return {
      ok: false,
      summary: {
        pullRequests: 0,
        trackedIssues: 0,
        validationGates: 0,
        blockedValidationGates: 0,
        residualRisks: 0
      },
      issues: [issue("manifest", "Release closeout evidence must be a JSON object.")]
    };
  }

  if (manifest.version !== 1) {
    issues.push(issue("version", "Release closeout evidence version must be 1."));
  }

  if (manifest.release?.generatedForIssue !== 204) {
    issues.push(issue("release.generatedForIssue", "Release closeout evidence must stay attached to issue #204."));
  }

  for (const parentIssue of REQUIRED_PARENT_ISSUES) {
    if (!manifest.release?.parentIssues?.includes(parentIssue)) {
      issues.push(issue("release.parentIssues", `Release closeout evidence must link parent issue #${parentIssue}.`));
    }
  }

  if (!Array.isArray(manifest.pullRequests) || manifest.pullRequests.length === 0) {
    issues.push(issue("pullRequests", "At least one pull request must be captured."));
  } else {
    manifest.pullRequests.forEach((pullRequest, index) => {
      if (!GITHUB_AGENTIC_URL_PATTERN.test(pullRequest.url)) {
        issues.push(issue(`pullRequests[${index}].url`, "Pull request URL must point to this repository."));
      }

      if (pullRequest.localValidation.length === 0) {
        issues.push(issue(`pullRequests[${index}].localValidation`, "Pull requests must include local validation evidence."));
      }

      if (pullRequest.status === "blocked" && (pullRequest.blockerIssues ?? []).length === 0) {
        issues.push(issue(`pullRequests[${index}].blockerIssues`, "Blocked pull requests must link blocker issues."));
      }
    });
  }

  const trackedIssueNumbers = new Set<number>();
  if (!Array.isArray(manifest.trackedIssues)) {
    issues.push(issue("trackedIssues", "Tracked issues must be an array."));
  } else {
    manifest.trackedIssues.forEach((trackedIssue, index) => {
      trackedIssueNumbers.add(trackedIssue.issue);

      if (trackedIssue.status !== "implemented" && (trackedIssue.blockers ?? []).length === 0) {
        issues.push(issue(`trackedIssues[${index}].blockers`, "Blocked or deferred issues must link blockers."));
      }

      validateEvidenceList(trackedIssue.evidence, `trackedIssues[${index}].evidence`, options.cwd, issues);
    });

    for (const requiredIssue of REQUIRED_CHILD_ISSUES) {
      if (!trackedIssueNumbers.has(requiredIssue)) {
        issues.push(issue("trackedIssues", `Child issue #${requiredIssue} is missing from the release closeout map.`));
      }
    }
  }

  const validationGateIds = new Set<string>();
  if (!Array.isArray(manifest.validationGates)) {
    issues.push(issue("validationGates", "Validation gates must be an array."));
  } else {
    manifest.validationGates.forEach((gate, index) => {
      validationGateIds.add(gate.id);

      if (!isNonEmptyString(gate.command)) {
        issues.push(issue(`validationGates[${index}].command`, "Validation gates must include the exact command."));
      }

      if (gate.status !== "passed" && (gate.blockerIssues ?? []).length === 0) {
        issues.push(
          issue(`validationGates[${index}].blockerIssues`, "Blocked or not-run validation gates must link blockers.")
        );
      }

      validateEvidenceList(gate.evidence, `validationGates[${index}].evidence`, options.cwd, issues);
    });

    for (const requiredGate of REQUIRED_VALIDATION_GATES) {
      if (!validationGateIds.has(requiredGate)) {
        issues.push(issue("validationGates", `Required validation gate '${requiredGate}' is missing.`));
      }
    }
  }

  if ((manifest.rollout?.rollbackSteps ?? []).length < 4) {
    issues.push(issue("rollout.rollbackSteps", "Rollback must include explicit executable steps."));
  }

  if ((manifest.rollout?.disablement ?? []).length < 2) {
    issues.push(issue("rollout.disablement", "Release closeout must include disablement controls."));
  } else {
    manifest.rollout.disablement.forEach((control, index) =>
      validateEvidenceList(control.evidence, `rollout.disablement[${index}].evidence`, options.cwd, issues)
    );
  }

  if ((manifest.rollout?.secretRotation ?? []).length < 2) {
    issues.push(issue("rollout.secretRotation", "Release closeout must include secret rotation or revocation controls."));
  } else {
    manifest.rollout.secretRotation.forEach((control, index) =>
      validateEvidenceList(control.evidence, `rollout.secretRotation[${index}].evidence`, options.cwd, issues)
    );
  }

  if (!Array.isArray(manifest.residualRisks) || manifest.residualRisks.length === 0) {
    issues.push(issue("residualRisks", "Residual risks must be recorded or explicitly confirmed absent."));
  } else {
    manifest.residualRisks.forEach((risk, index) => {
      if (risk.status !== "mitigated" && (risk.blockerIssues ?? []).length === 0) {
        issues.push(issue(`residualRisks[${index}].blockerIssues`, "Unmitigated risks must link blocker issues."));
      }

      if (!isNonEmptyString(risk.mitigation)) {
        issues.push(issue(`residualRisks[${index}].mitigation`, "Residual risks must include mitigation guidance."));
      }
    });
  }

  validateEvidenceList(manifest.observability?.evidenceHooks, "observability.evidenceHooks", options.cwd, issues);

  for (const entry of collectStrings(manifest, "manifest")) {
    for (const pattern of SECRET_VALUE_PATTERNS) {
      if (pattern.test(entry.value)) {
        issues.push(issue(entry.path, "Release closeout evidence must not contain raw secrets, tokens, credentials, or URL credentials."));
        break;
      }
    }
  }

  const blockedValidationGates = Array.isArray(manifest.validationGates)
    ? manifest.validationGates.filter(gate => gate.status !== "passed").length
    : 0;

  return {
    ok: issues.length === 0,
    summary: {
      pullRequests: Array.isArray(manifest.pullRequests) ? manifest.pullRequests.length : 0,
      trackedIssues: Array.isArray(manifest.trackedIssues) ? manifest.trackedIssues.length : 0,
      validationGates: Array.isArray(manifest.validationGates) ? manifest.validationGates.length : 0,
      blockedValidationGates,
      residualRisks: Array.isArray(manifest.residualRisks) ? manifest.residualRisks.length : 0
    },
    issues
  };
}

export function readReleaseCloseoutEvidenceManifest(
  manifestPath = DEFAULT_RELEASE_CLOSEOUT_EVIDENCE_PATH,
  options: { cwd?: string } = {}
) {
  const cwd = options.cwd ?? process.cwd();
  const resolvedPath = path.isAbsolute(manifestPath) ? manifestPath : path.join(cwd, manifestPath);
  return JSON.parse(readFileSync(resolvedPath, "utf8")) as ReleaseCloseoutEvidenceManifest;
}

export function renderReleaseCloseoutEvidenceReport(report: ReleaseCloseoutEvidenceReport) {
  const lines = [
    `Release closeout evidence ${report.ok ? "passed" : "failed"}.`,
    `- Pull requests: ${report.summary.pullRequests}`,
    `- Tracked issues: ${report.summary.trackedIssues}`,
    `- Validation gates: ${report.summary.validationGates}`,
    `- Blocked validation gates: ${report.summary.blockedValidationGates}`,
    `- Residual risks: ${report.summary.residualRisks}`
  ];

  if (report.issues.length > 0) {
    lines.push("", "Issues:");
    for (const validationIssue of report.issues) {
      lines.push(`- ${validationIssue.path}: ${validationIssue.message}`);
    }
  }

  return lines.join("\n");
}
