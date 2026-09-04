import { describe, expect, it } from "vitest";
import { DEFAULT_OWNER_USER_ID } from "@agentic/contracts";
import { processUserRequest } from "@agentic/orchestrator";
import { buildDefaultIntegrationAccounts } from "@agentic/integrations";

const baseParams = {
  userId: DEFAULT_OWNER_USER_ID,
  memories: [],
  integrations: buildDefaultIntegrationAccounts(DEFAULT_OWNER_USER_ID)
};

describe("adversarial processUserRequest boundaries", () => {
  it("rejects an empty request after trimming", async () => {
    await expect(processUserRequest({ ...baseParams, request: "" })).rejects.toThrow(/non-empty request/i);
    await expect(processUserRequest({ ...baseParams, request: "   " })).rejects.toThrow(/non-empty request/i);
    await expect(processUserRequest({ ...baseParams, request: "\n\t  \n" })).rejects.toThrow(/non-empty request/i);
  });

  it("rejects a request exceeding the 2000 character safety limit", async () => {
    const overLimit = "a".repeat(2_001);
    await expect(processUserRequest({ ...baseParams, request: overLimit })).rejects.toThrow(/2000 character safety limit/i);
  });

  it("accepts a request at exactly the 2000 character limit", async () => {
    const atLimit = "a".repeat(2_000);
    const bundle = await processUserRequest({ ...baseParams, request: atLimit });
    expect(bundle.goal.request).toBe(atLimit);
  });

  it("normalizes whitespace in requests (collapses runs, trims edges)", async () => {
    const bundle = await processUserRequest({ ...baseParams, request: "  Plan   my   week  " });
    expect(bundle.goal.request).toBe("Plan my week");
  });
});
