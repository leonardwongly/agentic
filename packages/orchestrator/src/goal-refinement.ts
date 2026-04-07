import {
  GoalBundleSchema,
  TaskSchema,
  WorkflowStateSchema,
  nowIso,
  type GoalBundle,
  type MemoryRecord,
  type Task
} from "@agentic/contracts";
import { createTask } from "@agentic/execution";
import { runAgent } from "@agentic/agents";
import { createActionLog } from "@agentic/observability";
import { evaluateTaskPolicy } from "@agentic/policy";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

type RefinementChange = {
  updatedTasks: Array<{
    taskId: string;
    title?: string;
    summary?: string;
  }>;
  newTasks: Array<{
    title: string;
    summary: string;
    assignedAgent: Task["assignedAgent"];
    capabilities: Task["toolCapabilities"];
    confidence: number;
  }>;
  removedTaskIds: string[];
  goalTitleUpdate?: string;
  explanationUpdate?: string;
};

const REFINEMENT_PROMPT_PREFIX = `You are an AI orchestrator that refines goal bundles based on user follow-up messages.

Given the original goal request, its current task list, current artifacts, and a refinement message from the user, determine what changes to apply to the goal bundle.

Reply with ONLY valid JSON matching this schema (no markdown fences, no explanation):

{
  "updatedTasks": [{ "taskId": "<id>", "title": "<new title>", "summary": "<new summary>" }],
  "newTasks": [{ "title": "<title>", "summary": "<summary>", "assignedAgent": "<agent>", "capabilities": ["<cap>"], "confidence": <0-1> }],
  "removedTaskIds": ["<id>"],
  "goalTitleUpdate": "<new title or null>",
  "explanationUpdate": "<new explanation or null>"
}

Valid agents: communications, calendar, workflow, research, knowledge, travel, personal-admin, finance-support, orchestrator
Valid capabilities: read, search, create, update, draft, send, schedule, monitor, approve, delete

Rules:
- Only include fields that actually change
- updatedTasks array should only contain tasks that need modification
- newTasks should only be added when the refinement requires genuinely new work
- removedTaskIds should only include tasks that are no longer relevant
- Keep goalTitleUpdate and explanationUpdate null unless the refinement meaningfully changes the goal's scope
- Be conservative: prefer updating existing tasks over removing and re-adding them`;

function buildRefinementPrompt(bundle: GoalBundle, refinement: string, memories: MemoryRecord[]): string {
  const taskSummaries = bundle.tasks.map((t) => `  - [${t.id}] "${t.title}" (${t.state}): ${t.summary}`).join("\n");
  const artifactSummaries = bundle.artifacts
    .slice(0, 10)
    .map((a) => `  - "${a.title}" (${a.artifactType}): ${a.content.slice(0, 200)}`)
    .join("\n");
  const memoryContext = memories
    .slice(0, 5)
    .map((m) => `  - [${m.category}] ${m.content}`)
    .join("\n");

  return `${REFINEMENT_PROMPT_PREFIX}

--- Current Goal ---
Title: ${bundle.goal.title}
Original request: ${bundle.goal.request}
Intent: ${bundle.goal.intent}
Status: ${bundle.goal.status}

--- Current Tasks ---
${taskSummaries || "  (no tasks)"}

--- Current Artifacts ---
${artifactSummaries || "  (no artifacts)"}

--- Relevant Memories ---
${memoryContext || "  (no memories)"}

--- User Refinement ---
"${refinement.slice(0, 2000)}"

JSON response:`;
}

function parseRefinementResponse(text: string): RefinementChange {
  const cleaned = text.replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, "").trim();
  const parsed = JSON.parse(cleaned) as Record<string, unknown>;

  return {
    updatedTasks: Array.isArray(parsed.updatedTasks) ? parsed.updatedTasks as RefinementChange["updatedTasks"] : [],
    newTasks: Array.isArray(parsed.newTasks) ? parsed.newTasks as RefinementChange["newTasks"] : [],
    removedTaskIds: Array.isArray(parsed.removedTaskIds) ? parsed.removedTaskIds as string[] : [],
    goalTitleUpdate: typeof parsed.goalTitleUpdate === "string" ? parsed.goalTitleUpdate : undefined,
    explanationUpdate: typeof parsed.explanationUpdate === "string" ? parsed.explanationUpdate : undefined
  };
}

async function detectRefinementLlm(bundle: GoalBundle, refinement: string, memories: MemoryRecord[]): Promise<RefinementChange> {
  const prompt = buildRefinementPrompt(bundle, refinement, memories);

  try {
    if (process.env.ANTHROPIC_API_KEY) {
      const client = new Anthropic();
      const response = await client.messages.create({
        model: process.env.ANTHROPIC_MODEL ?? "claude-opus-4-6",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }]
      });
      const text = response.content.find((b) => b.type === "text")?.text?.trim() ?? "{}";
      return parseRefinementResponse(text);
    } else if (process.env.OPENAI_API_KEY) {
      const client = new OpenAI();
      const response = await client.chat.completions.create({
        model: process.env.OPENAI_MODEL ?? "gpt-5.4",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }]
      });
      const text = response.choices[0]?.message?.content?.trim() ?? "{}";
      return parseRefinementResponse(text);
    }
  } catch {
    // Fall through to heuristic
  }

  return detectRefinementHeuristic(bundle, refinement);
}

function detectRefinementHeuristic(bundle: GoalBundle, refinement: string): RefinementChange {
  const lower = refinement.toLowerCase();
  const changes: RefinementChange = {
    updatedTasks: [],
    newTasks: [],
    removedTaskIds: []
  };

  // Simple heuristic: if the refinement mentions adding something, create a new task
  if (/(add|include|also|plus)\b/u.test(lower)) {
    changes.newTasks.push({
      title: `Address refinement: ${refinement.slice(0, 60)}`,
      summary: refinement,
      assignedAgent: "workflow",
      capabilities: ["read", "draft", "create"],
      confidence: 0.7
    });
  }

  // If the refinement mentions removing or canceling, try to match a task
  if (/(remove|cancel|drop|skip|delete)\b/u.test(lower)) {
    const matchedTask = bundle.tasks.find((t) =>
      lower.includes(t.title.toLowerCase().split(" ").slice(0, 3).join(" "))
    );
    if (matchedTask) {
      changes.removedTaskIds.push(matchedTask.id);
    }
  }

  // If the refinement mentions changing or updating, modify the first non-completed task
  if (/(change|move|update|modify|adjust|reschedule)\b/u.test(lower)) {
    const target = bundle.tasks.find((t) => t.state !== "completed");
    if (target) {
      changes.updatedTasks.push({
        taskId: target.id,
        summary: `${target.summary} [Refined: ${refinement.slice(0, 100)}]`
      });
    }
  }

  // If no changes were detected, add a generic refinement task
  if (changes.updatedTasks.length === 0 && changes.newTasks.length === 0 && changes.removedTaskIds.length === 0) {
    changes.newTasks.push({
      title: `Handle refinement: ${refinement.slice(0, 60)}`,
      summary: refinement,
      assignedAgent: "workflow",
      capabilities: ["read", "draft"],
      confidence: 0.68
    });
  }

  return changes;
}

export async function refineGoal(params: {
  bundle: GoalBundle;
  refinement: string;
  memories: MemoryRecord[];
}): Promise<GoalBundle> {
  const bundle = GoalBundleSchema.parse(params.bundle);
  const refinement = params.refinement.trim();

  if (!refinement) {
    throw new Error("A non-empty refinement message is required.");
  }

  if (refinement.length > 2_000) {
    throw new Error("The refinement message exceeds the 2000 character safety limit.");
  }

  const changes = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY
    ? await detectRefinementLlm(bundle, refinement, params.memories)
    : detectRefinementHeuristic(bundle, refinement);

  const logs = [...bundle.actionLogs];
  let tasks = [...bundle.tasks];
  let artifacts = [...bundle.artifacts];
  const now = nowIso();

  // Log the refinement request
  logs.push(
    createActionLog({
      goalId: bundle.goal.id,
      workflowId: bundle.workflow.id,
      actor: "user",
      kind: "goal.refined",
      message: `User refinement: "${refinement.slice(0, 200)}"`,
      details: {
        refinement,
        changesDetected: {
          updatedCount: changes.updatedTasks.length,
          newCount: changes.newTasks.length,
          removedCount: changes.removedTaskIds.length,
          titleChanged: !!changes.goalTitleUpdate,
          explanationChanged: !!changes.explanationUpdate
        }
      }
    })
  );

  // Apply task updates
  for (const update of changes.updatedTasks) {
    tasks = tasks.map((task) => {
      if (task.id !== update.taskId) return task;
      return TaskSchema.parse({
        ...task,
        title: update.title ?? task.title,
        summary: update.summary ?? task.summary,
        updatedAt: now
      });
    });

    logs.push(
      createActionLog({
        goalId: bundle.goal.id,
        taskId: update.taskId,
        workflowId: bundle.workflow.id,
        actor: "orchestrator",
        kind: "task.updated",
        message: `Updated task "${update.title ?? tasks.find((t) => t.id === update.taskId)?.title ?? update.taskId}" per refinement.`,
        details: { update }
      })
    );
  }

  // Remove tasks
  if (changes.removedTaskIds.length > 0) {
    const removedSet = new Set(changes.removedTaskIds);
    const removedTasks = tasks.filter((t) => removedSet.has(t.id));
    tasks = tasks.filter((t) => !removedSet.has(t.id));
    artifacts = artifacts.filter((a) => !a.taskId || !removedSet.has(a.taskId));

    for (const removed of removedTasks) {
      logs.push(
        createActionLog({
          goalId: bundle.goal.id,
          taskId: removed.id,
          workflowId: bundle.workflow.id,
          actor: "orchestrator",
          kind: "task.removed",
          message: `Removed task "${removed.title}" per refinement.`,
          details: { taskId: removed.id }
        })
      );
    }
  }

  // Add new tasks
  for (const planned of changes.newTasks) {
    const capabilities = planned.capabilities ?? ["read", "draft"];
    const decision = evaluateTaskPolicy({
      capabilities,
      confidence: planned.confidence,
      title: planned.title,
      memories: params.memories
    });
    const state = decision.outcome === "blocked" ? "blocked" : decision.requiresApproval ? "waiting" : "completed";
    const task = createTask({
      goalId: bundle.goal.id,
      workflowId: bundle.workflow.id,
      title: planned.title,
      summary: planned.summary,
      assignedAgent: planned.assignedAgent,
      riskClass: decision.riskClass,
      requiresApproval: decision.requiresApproval,
      toolCapabilities: capabilities,
      state
    });

    const agentResult = await runAgent(task, bundle.goal.title);
    const nextTask = TaskSchema.parse({
      ...task,
      artifactIds: agentResult.artifacts.map((a) => a.id)
    });

    tasks.push(nextTask);
    artifacts.push(...agentResult.artifacts);

    logs.push(
      createActionLog({
        goalId: bundle.goal.id,
        taskId: nextTask.id,
        workflowId: bundle.workflow.id,
        actor: "policy",
        kind: "policy.evaluated",
        message: `Evaluated policy for new task "${nextTask.title}".`,
        details: decision
      })
    );
    logs.push(
      createActionLog({
        goalId: bundle.goal.id,
        taskId: nextTask.id,
        workflowId: bundle.workflow.id,
        actor: nextTask.assignedAgent,
        kind: "agent.completed",
        message: agentResult.summary,
        details: {
          confidence: agentResult.confidence,
          nextSteps: agentResult.nextSteps
        }
      })
    );
  }

  // Log the completed refinement
  logs.push(
    createActionLog({
      goalId: bundle.goal.id,
      workflowId: bundle.workflow.id,
      actor: "orchestrator",
      kind: "goal.refined",
      message: `Applied refinement to goal "${changes.goalTitleUpdate ?? bundle.goal.title}".`,
      details: {
        updatedTaskIds: changes.updatedTasks.map((u) => u.taskId),
        newTaskCount: changes.newTasks.length,
        removedTaskIds: changes.removedTaskIds
      }
    })
  );

  // Recompute statuses
  const hasPendingApprovals = bundle.approvals.some((a) => a.decision === "pending");
  const hasBlockedTask = tasks.some((t) => t.state === "blocked");
  const hasOpenWatchers = bundle.watchers.some((w) => w.status === "active");
  const allTasksCompleted = tasks.every((t) => t.state === "completed");

  let goalStatus: "planned" | "running" | "waiting" | "completed";
  let workflowStatus: string;

  if (hasPendingApprovals) {
    goalStatus = "waiting";
    workflowStatus = "waiting";
  } else if (hasBlockedTask) {
    goalStatus = "running";
    workflowStatus = "running";
  } else if (allTasksCompleted && !hasOpenWatchers) {
    goalStatus = "completed";
    workflowStatus = "completed";
  } else {
    goalStatus = "running";
    workflowStatus = "running";
  }

  return GoalBundleSchema.parse({
    ...bundle,
    goal: {
      ...bundle.goal,
      title: changes.goalTitleUpdate ?? bundle.goal.title,
      explanation: changes.explanationUpdate ?? bundle.goal.explanation,
      status: goalStatus,
      updatedAt: now
    },
    workflow: WorkflowStateSchema.parse({
      ...bundle.workflow,
      status: workflowStatus,
      checkpoint: "refined",
      updatedAt: now
    }),
    tasks,
    artifacts,
    actionLogs: logs
  });
}
