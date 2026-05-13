import {
  AgentDefinitionSchema,
  GoalTemplateSchema,
  OperatorProductSchema,
  createSystemActorContext,
  nowIso,
  type Capability,
  type AgentDefinition,
  type GoalTemplate,
  type OperatorProduct,
  type RiskClass
} from "@agentic/contracts";

type BuiltInAgentTemplate = {
  name: string;
  displayName: string;
  description: string;
  systemPrompt: string;
  artifactType: "summary" | "brief" | "checklist" | "draft" | "explanation";
  allowedCapabilities: Capability[];
  maxRiskClass: RiskClass;
  category:
    | "productivity"
    | "communication"
    | "research"
    | "scheduling"
    | "finance"
    | "development"
    | "creative"
    | "administrative"
    | "custom";
};

function getAgentIcon(category: string): string {
  const icons: Record<string, string> = {
    communication: "📨",
    scheduling: "📅",
    research: "🔍",
    productivity: "✅",
    finance: "💰",
    administrative: "🏠",
    development: "💻",
    creative: "🎨",
    custom: "🤖"
  };
  return icons[category] || "🤖";
}

export function defaultAgents(userId: string): AgentDefinition[] {
  const timestamp = nowIso();
  const builtInAgents: BuiltInAgentTemplate[] = [
    {
      name: "communications",
      displayName: "Communications Agent",
      description: "Triage communications, draft replies, and prepare escalation notes",
      systemPrompt:
        "You are a communications triage specialist. You analyze inbound messages, identify urgency and sender context, draft replies, and prepare escalation notes. Be concise and actionable. Output sender-aware guidance with clear priority rankings.",
      artifactType: "summary",
      allowedCapabilities: ["read", "search", "draft", "send"],
      maxRiskClass: "R3",
      category: "communication"
    },
    {
      name: "calendar",
      displayName: "Calendar Agent",
      description: "Review schedules, detect conflicts, and recommend reschedules",
      systemPrompt:
        "You are a calendar and scheduling analyst. You review existing commitments, detect conflicts, identify overload windows, and recommend reschedule candidates. Output a structured brief with time-block analysis.",
      artifactType: "brief",
      allowedCapabilities: ["read", "search", "schedule", "update"],
      maxRiskClass: "R3",
      category: "scheduling"
    },
    {
      name: "workflow",
      displayName: "Workflow Agent",
      description: "Decompose requests into action items with checkpoints",
      systemPrompt:
        "You are a workflow planner. You decompose requests into concrete, ordered action items with checkpoints and reminders. Output a structured checklist with dependencies and resumable checkpoints.",
      artifactType: "checklist",
      allowedCapabilities: ["read", "search"],
      maxRiskClass: "R2",
      category: "productivity"
    },
    {
      name: "research",
      displayName: "Research Agent",
      description: "Gather evidence, compare options, and surface risks",
      systemPrompt:
        "You are a research analyst. You gather evidence, compare options, surface risks and assumptions, and separate confirmed facts from inferences. Output a structured brief with sourced findings.",
      artifactType: "brief",
      allowedCapabilities: ["read", "search"],
      maxRiskClass: "R2",
      category: "research"
    },
    {
      name: "knowledge",
      displayName: "Knowledge Agent",
      description: "Surface relevant preferences and contextual background",
      systemPrompt:
        "You are a knowledge retrieval specialist. You surface relevant preferences, standing instructions, and contextual background. Prioritize confirmed information over inferred. Output a structured explanation.",
      artifactType: "explanation",
      allowedCapabilities: ["read", "search"],
      maxRiskClass: "R2",
      category: "research"
    },
    {
      name: "travel",
      displayName: "Travel Agent",
      description: "Assemble itineraries, checklists, and travel assessments",
      systemPrompt:
        "You are a travel preparation specialist. You assemble itineraries, checklists, booking confirmations, and travel risk assessments. Output a comprehensive travel brief.",
      artifactType: "brief",
      allowedCapabilities: ["read", "search"],
      maxRiskClass: "R2",
      category: "administrative"
    },
    {
      name: "personal-admin",
      displayName: "Personal Admin Agent",
      description: "Handle routine personal tasks and life logistics",
      systemPrompt:
        "You are a personal administration specialist. You handle routine personal tasks, document organization, and life logistics. Output an actionable summary.",
      artifactType: "summary",
      allowedCapabilities: ["read", "search"],
      maxRiskClass: "R2",
      category: "administrative"
    },
    {
      name: "finance-support",
      displayName: "Finance Agent",
      description: "Track expenses and prepare budget summaries",
      systemPrompt:
        "You are a finance operations specialist. You track expenses, prepare budget summaries, and flag financial action items. Output a structured financial brief.",
      artifactType: "brief",
      allowedCapabilities: ["read", "search"],
      maxRiskClass: "R2",
      category: "finance"
    },
    {
      name: "orchestrator",
      displayName: "Orchestrator Agent",
      description: "Coordinate between agents and ensure workflow coherence",
      systemPrompt:
        "You are a meta-orchestrator. You coordinate between specialized agents, resolve conflicts, and ensure workflow coherence. Output a coordination summary.",
      artifactType: "summary",
      allowedCapabilities: ["read", "search"],
      maxRiskClass: "R2",
      category: "productivity"
    }
  ];

  return builtInAgents.map((agent) =>
    AgentDefinitionSchema.parse({
      id: `agent-builtin-${agent.name}`,
      userId,
      name: agent.name,
      displayName: agent.displayName,
      description: agent.description,
      icon: getAgentIcon(agent.category),
      category: agent.category,
      tags: ["built-in"],
      systemPrompt: agent.systemPrompt,
      promptVariables: [],
      artifactType: agent.artifactType,
      behaviorConfig: {
        temperature: 0.7,
        maxTokens: 1500,
        topP: 1,
        frequencyPenalty: 0,
        presencePenalty: 0,
        responseStyle: "balanced",
        formality: "professional"
      },
      allowedCapabilities: agent.allowedCapabilities,
      blockedCapabilities: [],
      maxRiskClass: agent.maxRiskClass,
      integrationPermissions: [],
      memoryPermissions: [],
      isBuiltIn: true,
      parentAgentId: null,
      version: 1,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp
    })
  );
}

export function defaultTemplates(userId: string): GoalTemplate[] {
  const timestamp = nowIso();

  return [
    GoalTemplateSchema.parse({
      id: "template-builtin-inbox-triage",
      userId,
      name: "Inbox triage and follow-up prep",
      description: "Review inbound messages, prepare approval-safe replies, and surface follow-up commitments.",
      request: "Triage my inbox, prepare sender-aware draft replies for important clients, and surface follow-up commitments that need approval.",
      parameters: {},
      actorContext: createSystemActorContext(userId),
      schedule: {
        enabled: false,
        cron: "",
        timezone: "UTC",
        lastRunAt: null,
        nextRunAt: null
      },
      createdAt: timestamp,
      updatedAt: timestamp
    })
  ];
}

export function defaultOperatorProducts(userId: string): OperatorProduct[] {
  const timestamp = nowIso();

  return [
    OperatorProductSchema.parse({
      id: "operator-product-communications",
      userId,
      slug: "communications-operator",
      name: "Communications Operator",
      tagline: "Run inbox, follow-up, and escalation workflows from one control surface.",
      description:
        "Packages the communications, workflow, knowledge, and calendar agents into one operator product focused on triage, response drafting, escalation handling, and timing-sensitive follow-ups.",
      icon: "✉️",
      recommendedAgentIds: [
        "agent-builtin-communications",
        "agent-builtin-workflow",
        "agent-builtin-knowledge",
        "agent-builtin-calendar"
      ],
      recommendedTemplateIds: ["template-builtin-inbox-triage"],
      recommendedIntegrations: [
        {
          system: "local-notes",
          label: "Local notes",
          readiness: "ready",
          description: "Capture standing instructions, relationship context, and reusable reply patterns."
        },
        {
          system: "gmail",
          label: "Email connector",
          readiness: "recommended",
          description: "Pull recent threads and push drafted responses into a real communications queue."
        },
        {
          system: "google-calendar",
          label: "Calendar connector",
          readiness: "recommended",
          description: "Use meeting load and deadlines to prioritize outbound communication work."
        }
      ],
      kpis: [
        {
          id: "inbox-latency",
          label: "Inbox response latency",
          description: "Measure time from inbound message to approved outbound draft.",
          metric: "Median approval-to-draft turnaround"
        },
        {
          id: "escalation-coverage",
          label: "Escalation coverage",
          description: "Track whether high-risk threads get summarized with clear next steps.",
          metric: "Escalation briefs per critical thread"
        },
        {
          id: "follow-up-closure",
          label: "Follow-up closure",
          description: "Keep open threads and promised replies visible until resolved.",
          metric: "Commitments closed within SLA"
        }
      ],
      onboardingSteps: [
        {
          id: "notes-context",
          title: "Capture communication preferences",
          description: "Store tone, escalation style, and sender-specific guidance in memory.",
          actionLabel: "Review memory"
        },
        {
          id: "template-seeding",
          title: "Seed repeatable communication workflows",
          description: "Create reusable triage and follow-up templates before high-volume usage.",
          actionLabel: "Load templates"
        },
        {
          id: "connector-readiness",
          title: "Connect real communication systems",
          description: "Move from mock integrations to live inbox and calendar sources.",
          actionLabel: "Review integrations"
        }
      ],
      isBuiltIn: true,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp
    })
  ];
}
