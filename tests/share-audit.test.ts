import { DEFAULT_OWNER_USER_ID } from "@agentic/contracts";
import { buildDefaultIntegrationAccounts } from "@agentic/integrations";
import { createMemoryRecord } from "@agentic/memory";
import { processUserRequest } from "@agentic/orchestrator";
import type { AgenticRepository } from "@agentic/repository";
import { vi } from "vitest";
import { auditBlockedShareAccess } from "../apps/web/lib/share-audit";

async function buildBundle() {
  return processUserRequest({
    userId: DEFAULT_OWNER_USER_ID,
    request: "Triage my inbox and prepare replies for important clients.",
    memories: [
      createMemoryRecord({
        userId: DEFAULT_OWNER_USER_ID,
        category: "style",
        memoryType: "confirmed",
        content: "Use concise approval summaries.",
        confidence: 0.95,
        source: "test"
      })
    ],
    integrations: buildDefaultIntegrationAccounts(DEFAULT_OWNER_USER_ID)
  });
}

describe("blocked public share audit", () => {
  it("records blocked access audit logs when the repository accepts the write", async () => {
    const bundle = await buildBundle();
    const appendGoalActionLogs: AgenticRepository["appendGoalActionLogs"] = vi.fn(async (_goalId, logs) => logs);

    await auditBlockedShareAccess({
      repository: {
        getGoalBundle: async () => bundle,
        appendGoalActionLogs
      },
      goalId: bundle.goal.id,
      shareId: "share-123",
      tokenFingerprint: "fingerprint-123",
      reason: "expired"
    });

    expect(appendGoalActionLogs).toHaveBeenCalledWith(
      bundle.goal.id,
      expect.arrayContaining([
        expect.objectContaining({ kind: "share.link_expired" }),
        expect.objectContaining({ kind: "share.access_failed" })
      ])
    );
  });

  it("keeps blocked share rejection non-fatal when the audit write fails", async () => {
    const bundle = await buildBundle();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      auditBlockedShareAccess({
        repository: {
          getGoalBundle: async () => bundle,
          appendGoalActionLogs: async () => {
            throw new Error("repository temporarily unavailable");
          }
        },
        goalId: bundle.goal.id,
        shareId: "share-123",
        tokenFingerprint: "fingerprint-123",
        reason: "revoked"
      })
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      "[agentic] Failed to audit blocked public share access: repository temporarily unavailable"
    );
    warnSpy.mockRestore();
  });
});
