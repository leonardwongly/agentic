import { nowIso, type GoalBundle, type MemoryRecord, type Task } from "@agentic/contracts";
import { createMemoryRecord } from "@agentic/memory";
import { type EpisodeRecord, EpisodeRecordSchema } from "@agentic/self-improvement-memory";

export type CapturedMemories = {
  memories: MemoryRecord[];
  episodes: EpisodeRecord[];
};

function taskOutcome(task: Task): "success" | "partial" | "failure" {
  if (task.state === "completed") return "success";
  if (task.state === "blocked" || task.state === "failed") return "failure";
  return "partial";
}

function extractCapabilityMemory(bundle: GoalBundle, userId: string): MemoryRecord | null {
  const capabilities = new Set(bundle.tasks.flatMap((t) => t.toolCapabilities));
  if (capabilities.size === 0) return null;

  const agents = [...new Set(bundle.tasks.map((t) => t.assignedAgent))];
  const content = `Goal "${bundle.goal.title}" used capabilities [${[...capabilities].join(", ")}] via agents [${agents.join(", ")}]. Scenario intent: ${bundle.goal.intent}.`;

  return createMemoryRecord({
    userId,
    category: "working-style",
    memoryType: "observed",
    content,
    confidence: 0.72,
    source: "auto-capture",
    permissions: ["orchestrator", "workflow", "knowledge"]
  });
}

function extractOutcomeMemory(bundle: GoalBundle, userId: string): MemoryRecord | null {
  const completedTasks = bundle.tasks.filter((t) => t.state === "completed");
  const blockedTasks = bundle.tasks.filter((t) => t.state === "blocked");
  const approvedCount = bundle.approvals.filter((a) => a.decision === "approved").length;
  const rejectedCount = bundle.approvals.filter((a) => a.decision === "rejected").length;

  if (completedTasks.length === 0 && blockedTasks.length === 0) return null;

  const parts: string[] = [];
  parts.push(`Goal "${bundle.goal.title}" resolved with ${completedTasks.length} completed and ${blockedTasks.length} blocked tasks.`);
  if (approvedCount > 0) parts.push(`${approvedCount} approval(s) granted.`);
  if (rejectedCount > 0) parts.push(`${rejectedCount} approval(s) rejected.`);

  const riskClasses = [...new Set(bundle.tasks.map((t) => t.riskClass))];
  if (riskClasses.length > 0) parts.push(`Risk classes involved: ${riskClasses.join(", ")}.`);

  return createMemoryRecord({
    userId,
    category: "projects",
    memoryType: "observed",
    content: parts.join(" "),
    confidence: 0.78,
    source: "auto-capture",
    permissions: ["orchestrator", "workflow", "knowledge"]
  });
}

function extractPreferenceSignals(bundle: GoalBundle, userId: string): MemoryRecord[] {
  const memories: MemoryRecord[] = [];

  for (const approval of bundle.approvals) {
    if (approval.decision === "pending") continue;

    const task = bundle.tasks.find((t) => t.id === approval.taskId);
    if (!task) continue;

    const content = approval.decision === "approved"
      ? `User approved "${task.title}" (${task.riskClass}) — indicates comfort with this action type in similar contexts.`
      : `User rejected "${task.title}" (${task.riskClass}) — indicates this action type needs different handling or shouldn't be proposed.`;

    memories.push(createMemoryRecord({
      userId,
      category: "preferences",
      memoryType: "observed",
      content,
      confidence: approval.decision === "approved" ? 0.75 : 0.82,
      source: "auto-capture",
      permissions: ["orchestrator", "workflow", "knowledge", "communications"]
    }));
  }

  return memories;
}

function buildEpisodes(bundle: GoalBundle): EpisodeRecord[] {
  return bundle.tasks.map((task) => {
    const artifacts = bundle.artifacts.filter((a) => a.taskId === task.id);
    const approval = bundle.approvals.find((a) => a.taskId === task.id);
    const outcome = taskOutcome(task);

    const situationParts = [
      `Goal: "${bundle.goal.title}"`,
      `Request: "${bundle.goal.request.slice(0, 200)}"`,
      `Scenario: ${bundle.goal.intent}`
    ];

    const solutionParts = [
      `Agent ${task.assignedAgent} processed "${task.title}".`,
      artifacts.length > 0 ? `Produced ${artifacts.length} artifact(s).` : "No artifacts produced."
    ];

    let lesson: string;
    if (outcome === "success") {
      lesson = `Task "${task.title}" completed successfully with risk class ${task.riskClass}.`;
    } else if (outcome === "failure" && approval?.decision === "rejected") {
      lesson = `Task "${task.title}" was rejected by user — reconsider proposing ${task.riskClass} actions of this type.`;
    } else {
      lesson = `Task "${task.title}" ended in state "${task.state}" — may need different approach.`;
    }

    return EpisodeRecordSchema.parse({
      id: crypto.randomUUID(),
      timestamp: nowIso(),
      skill: task.assignedAgent,
      task: task.title,
      outcome,
      situation: situationParts.join(". "),
      rootCause: outcome === "failure" ? (approval?.decision === "rejected" ? "User rejected the proposed action." : "Task blocked or failed during execution.") : null,
      solution: solutionParts.join(" "),
      lesson,
      relatedPatternId: null,
      userFeedback: null,
      metadata: {
        goalId: bundle.goal.id,
        taskId: task.id,
        riskClass: task.riskClass,
        capabilities: task.toolCapabilities.join(",")
      }
    });
  });
}

export function captureMemoriesFromBundle(bundle: GoalBundle, userId: string): CapturedMemories {
  const memories: MemoryRecord[] = [];

  const capabilityMemory = extractCapabilityMemory(bundle, userId);
  if (capabilityMemory) memories.push(capabilityMemory);

  const outcomeMemory = extractOutcomeMemory(bundle, userId);
  if (outcomeMemory) memories.push(outcomeMemory);

  memories.push(...extractPreferenceSignals(bundle, userId));

  const episodes = buildEpisodes(bundle);

  return { memories, episodes };
}
