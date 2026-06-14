import { z } from "zod";
import { isModelConfigured, runTextModel } from "@agentic/agents";
import {
  AgentNameSchema,
  CapabilitySchema,
  RiskClassSchema,
  WorkflowDagSchema,
  nowIso,
  type AgentName,
  type Capability
} from "@agentic/contracts";
import { validateWorkflowDag } from "@agentic/execution";
import { CapabilityAllowlistViolationError, assertCapabilitiesWithinAllowlist } from "@agentic/integrations";

/**
 * AOS-22: model-backed planner.
 *
 * Replaces (for the `general-coordination` lane, behind a flag) the static
 * `scenarioCatalog` task list with a model-produced task graph. Model output is
 * untrusted: it is JSON-parsed, schema-validated, gated through the per-agent
 * capability allowlist (policy), and validated as a workflow DAG before use. Any
 * failure — unconfigured, disabled, malformed, oversized, capability escalation,
 * or invalid DAG — yields `null` so the orchestrator falls back to the
 * deterministic catalog. The default model client is `runTextModel`; tests inject
 * a fake so the model path is exercised without a live provider.
 */

export type PlannerTask = {
  title: string;
  summary: string;
  assignedAgent: AgentName;
  capabilities: Capability[];
  confidence: number;
};

export type PlannerInput = { request: string };

export interface Planner {
  plan(input: PlannerInput): Promise<PlannerTask[] | null>;
}

export type PlannerModelClient = (request: { prompt: string; maxTokens: number }) => Promise<string | null>;

const ModelPlanTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(500),
    assignedAgent: AgentNameSchema,
    capabilities: z.array(CapabilitySchema).min(1).max(10),
    riskClass: RiskClassSchema.default("R2"),
    confidence: z.number().min(0).max(1).default(0.7)
  })
  .strict();

const ModelPlanSchema = z.object({ tasks: z.array(ModelPlanTaskSchema).min(1).max(12) }).strict();

const MAX_MODEL_OUTPUT_CHARS = 8_000;

function buildPlannerPrompt(request: string): string {
  return [
    "You are the planner for a governed execution system. Decompose the user request into",
    "a small bounded set of tasks. Do NOT perform or promise any external action — every",
    "side effect stays behind explicit human approval downstream.",
    "",
    "Return ONLY minified JSON of the form:",
    '{"tasks":[{"title":string,"summary":string,"assignedAgent":string,"capabilities":string[],"riskClass":"R1"|"R2"|"R3"|"R4","confidence":number}]}',
    "",
    "Allowed agents: communications, calendar, workflow, research, knowledge, travel, personal-admin, finance-support, orchestrator.",
    "Allowed capabilities: read, search, create, update, draft, send, schedule, monitor, approve, delete.",
    "Grant each task only the minimum capabilities its agent needs.",
    "",
    `User request: ${request.slice(0, 1_000)}`
  ].join("\n");
}

function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    return null;
  }
  return raw.slice(start, end + 1);
}

function planValidatesAsDag(tasks: z.infer<typeof ModelPlanSchema>["tasks"]): boolean {
  try {
    validateWorkflowDag(
      WorkflowDagSchema.parse({
        id: "planner-dag",
        workflowId: "planner-workflow",
        nodes: tasks.map((task, index) => ({
          id: `node-${index}`,
          label: task.title.slice(0, 240),
          actionIntent: {
            type: "manual_review",
            riskClass: task.riskClass,
            actionType: "artifact-only",
            summary: `Plan: ${task.title}`.slice(0, 500),
            reason: `Planned task: ${task.summary}`.slice(0, 1_000)
          },
          permissionGrant: { capabilities: task.capabilities, maxRiskClass: task.riskClass }
        })),
        edges: [],
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
    );
    return true;
  } catch {
    return false;
  }
}

export function createModelPlanner(
  options: {
    modelClient?: PlannerModelClient;
    isConfigured?: () => boolean;
    enabled?: boolean;
  } = {}
): Planner {
  const modelClient = options.modelClient ?? ((request) => runTextModel(request));
  const isConfigured = options.isConfigured ?? isModelConfigured;
  const enabled = options.enabled ?? (process.env.AGENTIC_MODEL_PLANNER === "true" && process.env.NODE_ENV !== "test");

  return {
    async plan(input) {
      if (!enabled || !isConfigured()) {
        return null;
      }

      let raw: string | null;
      try {
        raw = await modelClient({ prompt: buildPlannerPrompt(input.request), maxTokens: 900 });
      } catch {
        return null;
      }

      if (!raw || raw.length > MAX_MODEL_OUTPUT_CHARS) {
        return null;
      }

      const jsonText = extractJsonObject(raw);
      if (!jsonText) {
        return null;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonText);
      } catch {
        return null;
      }

      const result = ModelPlanSchema.safeParse(parsed);
      if (!result.success) {
        return null;
      }

      // Policy gate: capability allowlist per agent (model output is untrusted).
      try {
        for (const task of result.data.tasks) {
          assertCapabilitiesWithinAllowlist(task.assignedAgent, task.capabilities);
        }
      } catch (error) {
        if (error instanceof CapabilityAllowlistViolationError) {
          return null;
        }
        throw error;
      }

      // DAG gate: the plan must form a valid workflow DAG.
      if (!planValidatesAsDag(result.data.tasks)) {
        return null;
      }

      return result.data.tasks.map((task) => ({
        title: task.title,
        summary: task.summary,
        assignedAgent: task.assignedAgent,
        capabilities: task.capabilities,
        confidence: task.confidence
      }));
    }
  };
}
