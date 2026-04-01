import type { ApprovalRequest } from "@agentic/contracts";

export function formatApprovalSummary(approval: ApprovalRequest): string {
  return `${approval.title}: ${approval.rationale} (${approval.riskClass})`;
}

