import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DashboardData } from "@agentic/repository";
import {
  DashboardFirstRunChecklist,
  buildFirstRunMilestones,
  hasBlockingFirstRunWork
} from "../apps/web/components/dashboard-first-run-checklist";

function createDashboardData(overrides?: Partial<DashboardData>): DashboardData {
  return {
    activeWorkspace: {
      id: "workspace-1",
      ownerUserId: "user-1",
      slug: "personal",
      name: "Personal",
      description: "Personal workspace.",
      isPersonal: true,
      createdAt: "2026-05-15T00:00:00.000Z",
      updatedAt: "2026-05-15T00:00:00.000Z"
    },
    approvals: [],
    goals: [],
    integrations: [],
    watchers: [],
    ...overrides
  } as DashboardData;
}

const readyFileBackedRuntime = {
  ok: true,
  status: "ready" as const,
  storageBackend: "file" as const,
  checks: [
    {
      name: "access_key",
      status: "pass" as const,
      message: "Access-key signing secret is configured."
    },
    {
      name: "database",
      status: "warn" as const,
      message: "Running with the file-backed repository because DATABASE_URL is not configured."
    },
    {
      name: "async_execution",
      status: "pass" as const,
      message: "Async execution backlog checks passed."
    }
  ]
};

describe("DashboardFirstRunChecklist", () => {
  it("keeps the checklist active until the first governed request exists", () => {
    const milestones = buildFirstRunMilestones({
      data: createDashboardData(),
      notes: [],
      templates: [],
      readiness: readyFileBackedRuntime
    });

    expect(hasBlockingFirstRunWork(milestones)).toBe(true);
    expect(milestones.find((milestone) => milestone.id === "first-goal")).toMatchObject({
      state: "active",
      actionLabel: "Create request"
    });
    expect(milestones.find((milestone) => milestone.id === "storage-readiness")).toMatchObject({
      state: "complete",
      title: "File-backed runtime"
    });
  });

  it("treats the first workflow as complete when no approval is blocking it", () => {
    const milestones = buildFirstRunMilestones({
      data: createDashboardData({
        goals: [
          {
            goal: {
              id: "goal-1",
              userId: "user-1",
              workspaceId: "workspace-1",
              title: "Prepare daily operating plan",
              status: "completed",
              successCriteria: "Plan is ready.",
              summary: "Daily plan.",
              sourceRequest: "Prepare daily operating plan.",
              explanation: "Completed by test fixture.",
              createdAt: "2026-05-15T00:00:00.000Z",
              updatedAt: "2026-05-15T00:00:00.000Z"
            },
            workflow: {
              id: "workflow-1",
              goalId: "goal-1",
              status: "completed",
              checkpoint: "done",
              updatedAt: "2026-05-15T00:00:00.000Z"
            },
            tasks: [],
            artifacts: [],
            approvals: [],
            watchers: [],
            actionLogs: []
          }
        ] as DashboardData["goals"]
      }),
      notes: [],
      templates: [],
      readiness: readyFileBackedRuntime
    });

    expect(hasBlockingFirstRunWork(milestones)).toBe(false);
    expect(milestones.find((milestone) => milestone.id === "approval-review")).toMatchObject({
      state: "complete"
    });
  });

  it("renders actionable worker recovery when readiness is blocked", () => {
    const markup = renderToStaticMarkup(
      <DashboardFirstRunChecklist
        data={createDashboardData()}
        notes={[]}
        templates={[]}
        isPending={false}
        onCreateGoal={() => {}}
        onOpenSection={() => {}}
      />
    );

    expect(markup).toContain("First-run checklist");
    expect(markup).toContain("Worker and queue");
    expect(markup).toContain("Open operations");
  });

  it("keeps rendering when readiness is missing the optional checks array", () => {
    const milestones = buildFirstRunMilestones({
      data: createDashboardData(),
      notes: [],
      templates: [],
      readiness: {
        ok: true,
        status: "ready",
        storageBackend: "file"
      } as Parameters<typeof buildFirstRunMilestones>[0]["readiness"]
    });

    expect(milestones.find((milestone) => milestone.id === "storage-readiness")).toMatchObject({
      state: "active",
      title: "File-backed runtime"
    });
    expect(milestones.find((milestone) => milestone.id === "worker-readiness")).toMatchObject({
      state: "active",
      actionLabel: "Open operations"
    });
  });
});
