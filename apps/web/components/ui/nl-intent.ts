export type NLIntent =
  | { type: "query"; target: string; filters?: Record<string, string>; timeRange?: string }
  | { type: "command"; action: string; params: Record<string, unknown>; requiresConfirm?: boolean }
  | { type: "summary"; timeRange: "today" | "week" | "since-last-login" | "custom" }
  | { type: "clarify"; question: string; options?: string[] }
  | { type: "unknown"; rawQuery: string };

// Keep parsing in a plain TS module so it can be tested without JSX transforms.
export function parseIntent(query: string): NLIntent {
  const normalizedQuery = query.trim();
  const lower = normalizedQuery.toLowerCase();

  if (lower.includes("what happened") || lower.includes("while i was away") || lower.includes("catch me up")) {
    return { type: "summary", timeRange: "since-last-login" };
  }

  if (lower.includes("today") && (lower.includes("summary") || lower.includes("brief"))) {
    return { type: "summary", timeRange: "today" };
  }

  if (lower.includes("this week") || lower.includes("weekly")) {
    return { type: "summary", timeRange: "week" };
  }

  if (lower.startsWith("show") || lower.startsWith("list") || lower.startsWith("find")) {
    if (lower.includes("approval")) {
      const filters: Record<string, string> = {};

      if (lower.includes("r2")) filters.riskClass = "R2";
      if (lower.includes("r3")) filters.riskClass = "R3";
      if (lower.includes("r4")) filters.riskClass = "R4";
      if (lower.includes("pending")) filters.status = "pending";

      return { type: "query", target: "approvals", filters };
    }

    if (lower.includes("goal")) {
      const filters: Record<string, string> = {};

      if (lower.includes("running") || lower.includes("active")) filters.status = "running";
      if (lower.includes("completed") || lower.includes("done")) filters.status = "completed";
      if (lower.includes("failed")) filters.status = "failed";

      return { type: "query", target: "goals", filters };
    }

    if (lower.includes("agent")) {
      return { type: "query", target: "agents" };
    }

    if (lower.includes("memory") || lower.includes("memories")) {
      return { type: "query", target: "memories" };
    }
  }

  if (lower.startsWith("approve")) {
    if (lower.includes("all r2")) {
      return {
        type: "command",
        action: "approve",
        params: {
          riskClass: "R2",
          all: true
        },
        requiresConfirm: true
      };
    }

    return {
      type: "clarify",
      question: "The NL bar only supports the bounded batch command 'approve all R2' right now.",
      options: ["approve all R2", "show approvals"]
    };
  }

  if (lower.startsWith("reject")) {
    return {
      type: "clarify",
      question: "Reject decisions stay in the approvals queue until the NL rejection flow is explicitly hardened.",
      options: ["show approvals"]
    };
  }

  if (lower.startsWith("create") && lower.includes("goal")) {
    const match = normalizedQuery.match(/^create (?:a )?goal (?:to )?(.+)$/i);
    const request = match ? match[1] : "";
    return { type: "command", action: "create-goal", params: { request } };
  }

  if (lower.includes("morning briefing") || lower.includes("daily brief")) {
    return { type: "command", action: "briefing", params: { type: "morning" } };
  }

  return { type: "unknown", rawQuery: query };
}
