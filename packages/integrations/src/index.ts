import { CapabilitySchema, IntegrationAccountSchema, nowIso, type Capability, type IntegrationAccount } from "@agentic/contracts";
import { defaultLocalNotesBasePath, ensureLocalNotesDirectory, seedLocalNotes } from "./local-notes";

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
    key: "mock-email",
    name: "Manual Email Adapter",
    system: "email",
    status: "manual",
    scopes: ["messages.read", "messages.draft"],
    capabilities: ["read", "search", "draft", "send"]
  },
  {
    key: "mock-calendar",
    name: "Manual Calendar Adapter",
    system: "calendar",
    status: "manual",
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
