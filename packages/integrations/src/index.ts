import { CapabilitySchema, IntegrationAccountSchema, nowIso, type Capability, type IntegrationAccount } from "@agentic/contracts";
import { defaultLocalNotesBasePath, ensureLocalNotesDirectory, seedLocalNotes } from "./local-notes";
import { isGmailReady } from "./gmail";
import { isCalendarReady } from "./google-calendar";
import { isSlackReady } from "./slack";
import { isTelegramReady } from "./telegram";

export type IntegrationTemplate = {
  key: string;
  name: string;
  system: string;
  status: IntegrationAccount["status"];
  scopes: string[];
  capabilities: Capability[];
  metadata?: Record<string, unknown>;
};

export const integrationTemplates: IntegrationTemplate[] = [
  {
    key: "gmail",
    name: "Gmail Adapter",
    system: "email",
    status: isGmailReady() ? "ready" : "manual",
    scopes: ["messages.read", "messages.draft", "messages.send"],
    capabilities: ["read", "search", "draft", "send"]
  },
  {
    key: "google-calendar",
    name: "Google Calendar Adapter",
    system: "calendar",
    status: isCalendarReady() ? "ready" : "manual",
    scopes: ["calendar.read", "calendar.write"],
    capabilities: ["read", "search", "schedule", "update"]
  },
  {
    key: "mock-tasks",
    name: "Mock Tasks Adapter",
    system: "tasks",
    status: "mock",
    scopes: ["tasks.read", "tasks.write"],
    capabilities: ["read", "create", "update", "monitor"]
  },
  {
    key: "local-notes",
    name: "Local Notes Adapter",
    system: "notes",
    status: "ready",
    scopes: ["notes.read", "notes.write"],
    capabilities: ["read", "search", "create", "update"],
    metadata: {
      provider: "local-filesystem",
      basePath: defaultLocalNotesBasePath()
    }
  },
  {
    key: "slack",
    name: "Slack Adapter",
    system: "messaging",
    status: isSlackReady() ? "ready" : "disabled",
    scopes: ["chat.write", "chat.update"],
    capabilities: ["read", "send"]
  },
  {
    key: "telegram",
    name: "Telegram Adapter",
    system: "messaging",
    status: isTelegramReady() ? "ready" : "disabled",
    scopes: ["messages.send", "callbacks.read"],
    capabilities: ["read", "send"]
  }
];

export function buildDefaultIntegrationAccounts(userId: string): IntegrationAccount[] {
  return integrationTemplates.map((template) =>
    IntegrationAccountSchema.parse({
      id: template.key,
      userId,
      name: template.name,
      system: template.system,
      status: template.status,
      scopes: template.scopes,
      capabilities: template.capabilities.map((capability) => CapabilitySchema.parse(capability)),
      metadata: template.metadata ?? {},
      createdAt: nowIso(),
      updatedAt: nowIso()
    })
  );
}

export async function prepareDefaultIntegrations(): Promise<void> {
  const basePath = await ensureLocalNotesDirectory(defaultLocalNotesBasePath());
  await seedLocalNotes(basePath);
}

export function inferCapabilitiesFromRequest(request: string): Capability[] {
  const normalized = request.toLowerCase();
  const capabilities = new Set<Capability>(["read", "search"]);

  if (/(draft|prepare|summarize|triage|plan)/.test(normalized)) {
    capabilities.add("draft");
  }

  if (/(send|reply|email|message)/.test(normalized)) {
    capabilities.add("send");
  }

  if (/(schedule|calendar|meeting|week)/.test(normalized)) {
    capabilities.add("schedule");
  }

  if (/(monitor|watch|remind|trip|travel)/.test(normalized)) {
    capabilities.add("monitor");
  }

  return [...capabilities];
}

export * from "./local-notes";

// ---------------------------------------------------------------------------
// Capability enforcement at integration call sites
// ---------------------------------------------------------------------------

/**
 * The maximum capability set each agent type is permitted to hold.
 * Any capability granted to an agent outside this set is a misconfiguration.
 */
const AGENT_CAPABILITY_ALLOWLIST: Record<string, Capability[]> = {
  communications: ["read", "search", "draft", "send"],
  calendar: ["read", "search", "schedule", "update"],
  workflow: ["read", "search", "draft", "create", "update", "monitor"],
  research: ["read", "search", "draft"],
  knowledge: ["read", "search", "create", "monitor"],
  travel: ["read", "search", "draft", "monitor"],
  "personal-admin": ["read", "search", "draft", "create", "update", "monitor"],
  "finance-support": ["read", "search", "draft"],
  orchestrator: ["read", "search", "draft", "create", "update", "monitor", "schedule", "send", "approve", "delete"]
};

export class CapabilityViolationError extends Error {
  constructor(
    public readonly agent: string,
    public readonly requiredCapability: Capability,
    public readonly grantedCapabilities: Capability[]
  ) {
    super(
      `Agent "${agent}" attempted to invoke a "${requiredCapability}" operation but only has: [${grantedCapabilities.join(", ")}].`
    );
    this.name = "CapabilityViolationError";
  }
}

export class CapabilityAllowlistViolationError extends Error {
  constructor(
    public readonly agent: string,
    public readonly disallowedCapability: Capability,
    public readonly allowedCapabilities: Capability[]
  ) {
    super(
      `Agent "${agent}" was granted capability "${disallowedCapability}" which is outside its allowlist: [${allowedCapabilities.join(", ")}].`
    );
    this.name = "CapabilityAllowlistViolationError";
  }
}

/**
 * Assert that a specific capability was granted to the agent for this task.
 * Use at integration call sites before executing any operation.
 */
export function assertAgentCapability(
  agent: string,
  requiredCapability: Capability,
  grantedCapabilities: Capability[]
): void {
  if (!grantedCapabilities.includes(requiredCapability)) {
    throw new CapabilityViolationError(agent, requiredCapability, grantedCapabilities);
  }
}

/**
 * Verify that every capability granted to an agent is within its type-level allowlist.
 * Call this at task execution time to catch orchestrator misconfigurations early.
 */
export function assertCapabilitiesWithinAllowlist(agent: string, grantedCapabilities: Capability[]): void {
  const allowed = AGENT_CAPABILITY_ALLOWLIST[agent] ?? [];
  for (const capability of grantedCapabilities) {
    if (!allowed.includes(capability)) {
      throw new CapabilityAllowlistViolationError(agent, capability, allowed);
    }
  }
}

/**
 * Wrap any integration method call with a capability check.
 * The call only executes if the agent holds the required capability for this task.
 */
export function callWithCapabilityCheck<T>(
  agent: string,
  requiredCapability: Capability,
  grantedCapabilities: Capability[],
  fn: () => T
): T {
  assertAgentCapability(agent, requiredCapability, grantedCapabilities);
  return fn();
}

export * from "./gmail";
export * from "./google-calendar";
export * from "./readiness";
export * from "./slack";
export * from "./telegram";
