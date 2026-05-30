import {
  type ApprovalDecisionScope,
  ApprovalDecisionScopeSchema,
  ApprovalDecisionRecordSchema,
  type ApprovalRequest
} from "@agentic/contracts";
import {
  buildFallbackApprovalActionIntent,
  buildFallbackApprovalPreview
} from "./approval-fallbacks";

export { buildFallbackApprovalActionIntent, buildFallbackApprovalPreview };

export function normalizeApprovalDecisionScope(value: unknown): ApprovalDecisionScope | null {
  const parsed = ApprovalDecisionScopeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function normalizeApprovalHistory(value: unknown): ApprovalRequest["history"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => ApprovalDecisionRecordSchema.safeParse(item))
    .filter((result): result is { success: true; data: ApprovalRequest["history"][number] } => result.success)
    .map((result) => result.data);
}
