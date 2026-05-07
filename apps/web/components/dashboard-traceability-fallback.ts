import type { DashboardTraceability } from "@agentic/repository";

export function createEmptyTraceability(workspaceId: string | null): DashboardTraceability {
  return {
    generatedAt: new Date(0).toISOString(),
    workspaceId,
    workflowTraces: [],
    taskTraces: [],
    approvalTraces: [],
    memoryProvenance: [],
    eventCount: 0,
    artifactCount: 0,
    jobCount: 0,
    trustLane: {
      scopedMemoryCount: 0,
      autonomyEligibleMemoryCount: 0,
      advisoryInferredMemoryCount: 0,
      staleOrReviewRequiredMemoryCount: 0,
      blockedUnscopedMemoryCount: 0,
      policy: "No scoped memory records are linked to active workflow evidence yet."
    }
  };
}
