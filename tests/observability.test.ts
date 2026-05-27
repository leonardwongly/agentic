import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_OWNER_USER_ID, createSystemActorContext } from "@agentic/contracts";
import { sendNotification } from "@agentic/integrations";
import {
  createActionLog,
  getTelemetrySnapshot,
  resetTelemetrySnapshot,
  sanitizeForTelemetry,
  withTelemetryContext
} from "@agentic/observability";
import { createRepository } from "@agentic/repository";
import { createSelfImprovementRepository } from "@agentic/self-improvement-memory";
import { enqueueGoalCreateJob, runWorkerRuntime } from "@agentic/worker-runtime";
import { POST as goalsCreateRoute } from "../apps/web/app/api/goals/route";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";

describe("observability", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;
  const originalSlackBotToken = process.env.SLACK_BOT_TOKEN;
  const originalSlackSigningSecret = process.env.SLACK_SIGNING_SECRET;
  const originalFetch = global.fetch;

  beforeEach(async () => {
    resetTelemetrySnapshot();
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-observability-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
    Reflect.set(globalThis, "__agenticSelfImprovementRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    process.env.SLACK_BOT_TOKEN = originalSlackBotToken;
    process.env.SLACK_SIGNING_SECRET = originalSlackSigningSecret;
    global.fetch = originalFetch;
    Reflect.set(globalThis, "__agenticRepository", undefined);
    Reflect.set(globalThis, "__agenticSelfImprovementRepository", undefined);
    resetTelemetrySnapshot();
  });

  it("adds correlation headers and request metrics to goal creation routes", async () => {
    const response = await goalsCreateRoute(
      new Request("http://localhost/api/goals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key",
          "x-request-id": "req-observability-1",
          "x-trace-id": "trace-observability-1"
        },
        body: JSON.stringify({
          request: "Plan my operating week with approval-safe follow-ups."
        })
      })
    );
    const snapshot = getTelemetrySnapshot();
    const startedLog = snapshot.logs.find((entry) => entry.message === "api.request.started");
    const completedLog = snapshot.logs.find((entry) => entry.message === "api.request.completed");
    const requestCountMetric = snapshot.metrics.find((entry) => entry.name === "http.request.total");
    const requestDurationMetric = snapshot.metrics.find((entry) => entry.name === "http.request.duration_ms");

    expect(response.status).toBe(202);
    expect(response.headers.get("x-request-id")).toBe("req-observability-1");
    expect(response.headers.get("x-trace-id")).toBe("trace-observability-1");
    expect(startedLog).toMatchObject({
      message: "api.request.started",
      context: {
        requestId: "req-observability-1",
        traceId: "trace-observability-1",
        route: "api.goals.create",
        method: "POST",
        path: "/api/goals"
      }
    });
    expect(completedLog).toMatchObject({
      message: "api.request.completed",
      context: {
        requestId: "req-observability-1",
        route: "api.goals.create"
      }
    });
    expect(requestCountMetric).toMatchObject({
      kind: "counter",
      name: "http.request.total",
      value: 1,
      attributes: {
        route: "api.goals.create",
        method: "POST",
        path: "/api/goals",
        statusCode: 202,
        statusClass: "2xx",
        outcome: "ok"
      },
      context: {
        requestId: "req-observability-1",
        traceId: "trace-observability-1"
      }
    });
    expect(requestDurationMetric?.value).toBeGreaterThanOrEqual(0);
  });

  it("captures correlated worker and durable queue telemetry for processed jobs", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-worker-observability-"));
    const repository = createRepository({
      storePath: path.join(tempDir, "runtime-store.json")
    });
    const selfImprovementRepository = createSelfImprovementRepository({
      baseDir: path.join(tempDir, "self-improvement")
    });

    await Promise.all([
      repository.seedDefaults(DEFAULT_OWNER_USER_ID),
      selfImprovementRepository.seed()
    ]);

    const job = await enqueueGoalCreateJob({
      repository,
      userId: DEFAULT_OWNER_USER_ID,
      request: "Prepare a durable weekly planning workflow with observability.",
      workspaceId: null,
      agentId: null,
      actorContext: createSystemActorContext(DEFAULT_OWNER_USER_ID),
      idempotencyKey: "observability-worker-job"
    });

    const result = await runWorkerRuntime({
      repository,
      selfImprovementRepository,
      runnerId: "worker-observability-test",
      maxJobs: 1,
      pollIntervalMs: 50
    });
    const snapshot = getTelemetrySnapshot();
    const workerStartedLog = snapshot.logs.find(
      (entry) => entry.message === "worker.job.started" && entry.context.jobId === job.id
    );
    const workerCompletedLog = snapshot.logs.find(
      (entry) => entry.message === "worker.job.completed" && entry.context.jobId === job.id
    );
    const processSpan = snapshot.spans.find(
      (entry) => entry.name === "durable_job.process" && entry.context.jobId === job.id
    );
    const executeSpan = snapshot.spans.find(
      (entry) => entry.name === "worker.job.execute" && entry.context.jobId === job.id
    );
    const processedMetric = snapshot.metrics.find(
      (entry) =>
        entry.name === "worker.loop.processed.total" &&
        entry.attributes.jobKind === "goal_create" &&
        entry.context.runnerId === "worker-observability-test"
    );
    const completedMetric = snapshot.metrics.find(
      (entry) =>
        entry.name === "durable_job.completed.total" &&
        entry.attributes.jobKind === "goal_create" &&
        entry.context.runnerId === "worker-observability-test"
    );

    expect(result).toEqual({
      processedCount: 1,
      stopReason: "max_jobs"
    });
    expect(workerStartedLog).toMatchObject({
      context: {
        jobId: job.id,
        jobKind: "goal_create",
        runnerId: "worker-observability-test",
        userId: DEFAULT_OWNER_USER_ID
      }
    });
    expect(workerCompletedLog).toMatchObject({
      context: {
        jobId: job.id,
        runnerId: "worker-observability-test"
      }
    });
    expect(processSpan).toMatchObject({
      status: "ok",
      context: {
        jobId: job.id,
        runnerId: "worker-observability-test"
      }
    });
    expect(executeSpan).toMatchObject({
      status: "ok",
      context: {
        jobId: job.id,
        runnerId: "worker-observability-test"
      }
    });
    expect(processedMetric?.value).toBe(1);
    expect(completedMetric?.value).toBe(1);
  });

  it("redacts secret-bearing provider failures while still counting the error", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
    process.env.SLACK_SIGNING_SECRET = "slack-signing-secret";
    global.fetch = async () => {
      throw new Error("Slack upstream rejected token=super-secret-value");
    };

    await expect(
      sendNotification({
        channel: "C123",
        text: "Investigate the latest alert."
      })
    ).rejects.toThrow("token=super-secret-value");

    const snapshot = getTelemetrySnapshot();
    const errorMetric = snapshot.metrics.find(
      (entry) =>
        entry.name === "integration.call.total" &&
        entry.attributes.provider === "slack" &&
        entry.attributes.outcome === "error"
    );
    const errorLog = snapshot.logs.find((entry) => entry.message === "integration.slack.call_failed");
    const serializedLog = JSON.stringify(errorLog);

    expect(errorMetric?.value).toBe(1);
    expect(errorLog).toMatchObject({
      context: {
        provider: "slack"
      },
      attributes: {
        operation: "chat.postMessage",
        errorName: "ConnectorFailureError",
        errorMessage: "[REDACTED]"
      }
    });
    expect(serializedLog).not.toContain("super-secret-value");
    expect(sanitizeForTelemetry({
      token: "abc",
      nested: {
        message: "token=super-secret-value"
      }
    })).toEqual({
      token: "[REDACTED]",
      nested: {
        message: "[REDACTED]"
      }
    });
  });

  it("threads workflow and artifact identifiers through action-log telemetry", async () => {
    await withTelemetryContext(
      {
        requestId: "req-action-log",
        traceId: "trace-action-log"
      },
      async () => {
        createActionLog({
          goalId: "goal-telemetry",
          taskId: "task-telemetry",
          workflowId: "workflow-telemetry",
          actor: DEFAULT_OWNER_USER_ID,
          kind: "artifact.created",
          message: "Created deployment evidence artifact.",
          details: {
            artifactId: "artifact-telemetry",
            token: "super-secret-value"
          }
        });
      }
    );

    const snapshot = getTelemetrySnapshot();
    const log = snapshot.logs.find((entry) => entry.message === "action_log.created");
    const counter = snapshot.metrics.find((entry) => entry.name === "action_log.created.total");

    expect(log).toMatchObject({
      context: {
        requestId: "req-action-log",
        traceId: "trace-action-log",
        workflowId: "workflow-telemetry",
        artifactId: "artifact-telemetry"
      },
      attributes: {
        actionKind: "artifact.created",
        goalId: "goal-telemetry",
        taskId: "task-telemetry",
        workflowId: "workflow-telemetry",
        artifactId: "artifact-telemetry"
      }
    });
    expect(JSON.stringify(log)).not.toContain("super-secret-value");
    expect(counter).toMatchObject({
      attributes: {
        actionKind: "artifact.created",
        hasWorkflow: true,
        hasArtifact: true
      }
    });
  });
});
