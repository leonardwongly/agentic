import { describe, expect, it } from "vitest";
import { nowIso } from "@agentic/contracts";
import { createJobRecord } from "@agentic/execution";

describe("adversarial job concurrency key derivation", () => {
  it("derives distinct keys for different privacy operations", () => {
    const op1 = createJobRecord({
      userId: "user-1",
      kind: "privacy_operation",
      payload: {
        type: "privacy_operation",
        operationId: "op-alpha",
        workspaceId: "ws-1",
        kind: "workspace_delete",
        metadata: {}
      }
    });
    const op2 = createJobRecord({
      userId: "user-1",
      kind: "privacy_operation",
      payload: {
        type: "privacy_operation",
        operationId: "op-beta",
        workspaceId: "ws-1",
        kind: "workspace_delete",
        metadata: {}
      }
    });
    expect(op1.concurrencyKey).not.toBe(op2.concurrencyKey);
    expect(op1.concurrencyKey).toContain("privacy:op-alpha");
    expect(op2.concurrencyKey).toContain("privacy:op-beta");
  });

  it("derives distinct keys for different deployment canaries", () => {
    const now = nowIso();
    const c1 = createJobRecord({
      userId: "user-1",
      kind: "deployment_canary",
      payload: {
        type: "deployment_canary",
        requestId: "canary-alpha",
        traceId: "trace-1",
        enqueuedAt: now,
        metadata: {}
      }
    });
    const c2 = createJobRecord({
      userId: "user-1",
      kind: "deployment_canary",
      payload: {
        type: "deployment_canary",
        requestId: "canary-beta",
        traceId: "trace-2",
        enqueuedAt: now,
        metadata: {}
      }
    });
    expect(c1.concurrencyKey).not.toBe(c2.concurrencyKey);
    expect(c1.concurrencyKey).toContain("deployment-canary:canary-alpha");
  });

  it("falls back to userId:kind when no side effect target is derivable", () => {
    const job = createJobRecord({
      userId: "user-1",
      kind: "docs_render",
      payload: { type: "docs_render", metadata: {} }
    });
    expect(job.concurrencyKey).toBe("user-1:docs_render");
  });

  it("uses explicit concurrencyKey when provided", () => {
    const job = createJobRecord({
      userId: "user-1",
      kind: "docs_render",
      concurrencyKey: "custom-key",
      payload: { type: "docs_render", metadata: {} }
    });
    expect(job.concurrencyKey).toBe("custom-key");
  });

  it("derives concurrency key from goalId for generic payloads with goalId", () => {
    const job = createJobRecord({
      userId: "user-1",
      kind: "goal_create",
      payload: {
        type: "goal_create",
        goalId: "goal-abc",
        workflowId: "wf-1",
        request: "Test",
        workspaceId: null,
        agentId: null,
        metadata: {}
      }
    });
    expect(job.concurrencyKey).toBe("user-1:goal:goal-abc");
  });

  it("trims whitespace from explicit concurrencyKey", () => {
    const job = createJobRecord({
      userId: "user-1",
      kind: "docs_render",
      concurrencyKey: "  custom-key  ",
      payload: { type: "docs_render", metadata: {} }
    });
    expect(job.concurrencyKey).toBe("custom-key");
  });

  it("falls back to derived key when explicit concurrencyKey is empty string", () => {
    const job = createJobRecord({
      userId: "user-1",
      kind: "docs_render",
      concurrencyKey: "",
      payload: { type: "docs_render", metadata: {} }
    });
    expect(job.concurrencyKey).toBe("user-1:docs_render");
  });

  it("sets concurrencyKey to null when explicitly passed as null", () => {
    const job = createJobRecord({
      userId: "user-1",
      kind: "docs_render",
      concurrencyKey: null,
      payload: { type: "docs_render", metadata: {} }
    });
    expect(job.concurrencyKey).toBeNull();
  });
});
