import type { GoalBundle } from "@agentic/contracts";

export const GOAL_SHARE_DEFAULT_EXPIRY_DAYS = 7;
export const GOAL_SHARE_MIN_EXPIRY_DAYS = 1;
export const GOAL_SHARE_MAX_EXPIRY_DAYS = 30;

export type GoalShareDataClassDisposition = "included" | "redacted" | "requires_confirmation";

export type GoalShareDataClass = {
  id: string;
  label: string;
  disposition: GoalShareDataClassDisposition;
  fields: string[];
  reason: string;
};

export type GoalShareSensitiveFinding = {
  fieldPath: string;
  label: string;
  detector: "email_address" | "phone_number" | "secret_keyword";
  severity: "medium" | "high";
};

export type GoalShareDisclosureReview = {
  expiresAt: string;
  expiryDays: number;
  dataClasses: GoalShareDataClass[];
  sensitiveFindings: GoalShareSensitiveFinding[];
  redactedFields: string[];
  confirmationRequired: true;
  summary: string;
};

const SENSITIVE_FIELD_DETECTORS: Array<{
  detector: GoalShareSensitiveFinding["detector"];
  label: string;
  severity: GoalShareSensitiveFinding["severity"];
  pattern: RegExp;
}> = [
  {
    detector: "email_address",
    label: "Email address",
    severity: "medium",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
  },
  {
    detector: "phone_number",
    label: "Phone number",
    severity: "medium",
    pattern: /(?:\+?\d[\d\s().-]{7,}\d)/
  },
  {
    detector: "secret_keyword",
    label: "Secret-like keyword",
    severity: "high",
    pattern: /\b(?:api[_ -]?key|secret|token|password|credential|private[_ -]?key)\b/i
  }
];

function clampExpiryDays(expiryDays: number): number {
  if (!Number.isFinite(expiryDays)) {
    return GOAL_SHARE_DEFAULT_EXPIRY_DAYS;
  }

  return Math.min(GOAL_SHARE_MAX_EXPIRY_DAYS, Math.max(GOAL_SHARE_MIN_EXPIRY_DAYS, Math.trunc(expiryDays)));
}

export function getGoalShareExpiryFromDays(expiryDays = GOAL_SHARE_DEFAULT_EXPIRY_DAYS, now = Date.now()): string {
  const boundedDays = clampExpiryDays(expiryDays);
  return new Date(now + boundedDays * 24 * 60 * 60 * 1000).toISOString();
}

function detectSensitiveText(fieldPath: string, value: string): GoalShareSensitiveFinding[] {
  return SENSITIVE_FIELD_DETECTORS.flatMap((detector) =>
    detector.pattern.test(value)
      ? [
          {
            fieldPath,
            label: detector.label,
            detector: detector.detector,
            severity: detector.severity
          }
        ]
      : []
  );
}

function collectSensitiveFindings(bundle: GoalBundle): GoalShareSensitiveFinding[] {
  const publicFields: Array<[string, string]> = [
    ["goal.title", bundle.goal.title],
    ["goal.explanation", bundle.goal.explanation],
    ["goal.intent", bundle.goal.intent],
    ...bundle.tasks.flatMap((task, index) => [
      [`tasks.${index}.title`, task.title] as [string, string],
      [`tasks.${index}.summary`, task.summary] as [string, string]
    ]),
    ...bundle.artifacts.map((artifact, index) => [`artifacts.${index}.title`, artifact.title] as [string, string])
  ];

  return publicFields.flatMap(([fieldPath, value]) => detectSensitiveText(fieldPath, value));
}

export function buildGoalShareDisclosureReview(
  bundle: GoalBundle,
  params: {
    expiresAt: string;
    expiryDays?: number;
  }
): GoalShareDisclosureReview {
  const expiryDays = clampExpiryDays(params.expiryDays ?? GOAL_SHARE_DEFAULT_EXPIRY_DAYS);
  const sensitiveFindings = collectSensitiveFindings(bundle);
  const redactedFields = [
    "goal.request",
    "approvals",
    "approval.preview",
    "actionLogs",
    "watchers.details",
    "artifacts.content",
    "artifacts.metadata",
    "memory.context",
    "workflow.checkpoint"
  ];

  return {
    expiresAt: params.expiresAt,
    expiryDays,
    dataClasses: [
      {
        id: "goal_summary",
        label: "Goal summary",
        disposition: sensitiveFindings.length > 0 ? "requires_confirmation" : "included",
        fields: ["goal.title", "goal.explanation", "goal.intent", "goal.status", "goal.createdAt", "goal.updatedAt"],
        reason: "Only the public summary projection is shared."
      },
      {
        id: "task_summaries",
        label: "Task summaries",
        disposition: sensitiveFindings.length > 0 ? "requires_confirmation" : "included",
        fields: ["tasks.title", "tasks.summary", "tasks.state", "tasks.riskClass"],
        reason: "Task IDs, dependencies, assigned agents, and approval payloads stay internal."
      },
      {
        id: "artifact_metadata",
        label: "Artifact metadata",
        disposition: "redacted",
        fields: ["artifacts.title", "artifacts.artifactType", "artifacts.createdAt"],
        reason: "Artifact bodies and metadata are replaced with a fixed public placeholder."
      },
      {
        id: "operator_context",
        label: "Operator context",
        disposition: "redacted",
        fields: ["goal.request", "approvals", "actionLogs", "watchers", "memory.context", "workflow.checkpoint"],
        reason: "Internal request text, approvals, execution history, watchers, memory context, and workflow checkpoint data are never projected."
      }
    ],
    sensitiveFindings,
    redactedFields,
    confirmationRequired: true,
    summary:
      sensitiveFindings.length > 0
        ? "Potentially sensitive public fields were detected. Confirm the reviewed projection before creating a link."
        : "The share uses an allowlisted public projection and still requires operator confirmation."
  };
}
