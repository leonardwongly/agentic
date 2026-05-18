"use client";

import { useEffect, useMemo, useState } from "react";
import type { GoalTemplate } from "@agentic/contracts";
import type { LocalNoteDocument } from "@agentic/integrations/client";
import type { DashboardData } from "@agentic/repository";

type ReadinessCheckSnapshot = {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
};

type ReadinessSnapshot = {
  ok: boolean;
  status: "ready" | "not_ready";
  storageBackend: "postgres" | "file";
  checks: ReadinessCheckSnapshot[];
};

type FirstRunMilestoneState = "complete" | "active" | "blocked" | "optional";

export type FirstRunMilestone = {
  id: string;
  title: string;
  description: string;
  state: FirstRunMilestoneState;
  blocking: boolean;
  actionLabel?: string;
  targetSection?: string;
};

type DashboardFirstRunChecklistProps = {
  data: DashboardData;
  notes: LocalNoteDocument[];
  templates: GoalTemplate[];
  isPending: boolean;
  onCreateGoal: () => void;
  onOpenSection: (section: string) => void;
};

type BuildFirstRunMilestonesParams = {
  data: Pick<DashboardData, "activeWorkspace" | "approvals" | "goals" | "integrations" | "watchers">;
  notes: Pick<LocalNoteDocument, "slug">[];
  templates: Pick<GoalTemplate, "id">[];
  readiness: ReadinessSnapshot | null;
};

function getReadinessCheck(readiness: ReadinessSnapshot | null, name: string): ReadinessCheckSnapshot | null {
  return readiness?.checks?.find((check) => check.name === name) ?? null;
}

function describeReadinessState(check: ReadinessCheckSnapshot | null): FirstRunMilestoneState {
  if (!check) {
    return "active";
  }

  if (check.status === "fail") {
    return "blocked";
  }

  return "complete";
}

function getCheckMessage(check: ReadinessCheckSnapshot | null, fallback: string): string {
  return check?.message ?? fallback;
}

export function buildFirstRunMilestones({
  data,
  notes,
  templates,
  readiness
}: BuildFirstRunMilestonesParams): FirstRunMilestone[] {
  const accessKeyCheck = getReadinessCheck(readiness, "access_key");
  const databaseCheck = getReadinessCheck(readiness, "database");
  const asyncExecutionCheck = getReadinessCheck(readiness, "async_execution");
  const pendingApprovalCount = data.approvals.filter((approval) => approval.decision === "pending").length;
  const hasGoal = data.goals.length > 0;
  const readyIntegrationCount = data.integrations.filter((integration) => integration.status === "ready").length;

  return [
    {
      id: "access-key",
      title: "Access key",
      description: getCheckMessage(accessKeyCheck, "Dashboard session accepted."),
      state: accessKeyCheck?.status === "fail" ? "blocked" : "complete",
      blocking: true
    },
    {
      id: "web-runtime",
      title: "Web runtime",
      description: "Dashboard is reachable in this browser session.",
      state: "complete",
      blocking: true
    },
    {
      id: "storage-readiness",
      title: readiness?.storageBackend === "postgres" ? "Postgres readiness" : "File-backed runtime",
      description: getCheckMessage(databaseCheck, "Runtime storage readiness is still loading."),
      state: describeReadinessState(databaseCheck),
      blocking: true
    },
    {
      id: "worker-readiness",
      title: "Worker and queue",
      description: getCheckMessage(asyncExecutionCheck, "Async execution readiness is still loading."),
      state: describeReadinessState(asyncExecutionCheck),
      blocking: true,
      actionLabel: "Open operations",
      targetSection: "operations"
    },
    {
      id: "first-goal",
      title: "First request",
      description: hasGoal ? "At least one governed goal exists." : "Create the first governed work request.",
      state: hasGoal ? "complete" : "active",
      blocking: true,
      actionLabel: "Create request",
      targetSection: "goals"
    },
    {
      id: "approval-review",
      title: "Approval path",
      description:
        pendingApprovalCount > 0
          ? `${pendingApprovalCount} approval ${pendingApprovalCount === 1 ? "is" : "are"} waiting for review.`
          : hasGoal
            ? "No approval is currently blocking the first workflow."
            : "Approvals appear after a workflow crosses a policy boundary.",
      state: hasGoal && pendingApprovalCount === 0 ? "complete" : "active",
      blocking: true,
      actionLabel: "Review approvals",
      targetSection: "approvals"
    },
    {
      id: "notes-path",
      title: "Local notes",
      description: notes.length > 0 ? `${notes.length} local note ${notes.length === 1 ? "is" : "are"} visible.` : "Optional notes path has no records yet.",
      state: notes.length > 0 ? "complete" : "optional",
      blocking: false,
      actionLabel: "Open notes",
      targetSection: "notes"
    },
    {
      id: "integration-review",
      title: "Integrations",
      description:
        readyIntegrationCount > 0
          ? `${readyIntegrationCount} provider ${readyIntegrationCount === 1 ? "is" : "are"} ready.`
          : "Optional providers are still manual or setup-required.",
      state: readyIntegrationCount > 0 ? "complete" : "optional",
      blocking: false,
      actionLabel: "Review integrations",
      targetSection: "integrations"
    },
    {
      id: "repeatable-workflows",
      title: "Repeatable workflows",
      description:
        templates.length > 0 || data.watchers.length > 0
          ? "Templates or watchers are available for repeat work."
          : "Templates and watchers can be added after the first workflow.",
      state: templates.length > 0 || data.watchers.length > 0 ? "complete" : "optional",
      blocking: false,
      actionLabel: "Open templates",
      targetSection: "templates"
    }
  ];
}

export function hasBlockingFirstRunWork(milestones: FirstRunMilestone[]): boolean {
  return milestones.some((milestone) => milestone.blocking && milestone.state !== "complete");
}

function getSessionStorageFlag(key: string): boolean {
  try {
    return window.sessionStorage.getItem(key) === "dismissed";
  } catch {
    return false;
  }
}

function setSessionStorageFlag(key: string) {
  try {
    window.sessionStorage.setItem(key, "dismissed");
  } catch {
    // Session storage can be unavailable in hardened browser contexts.
  }
}

function getChecklistStatusClass(state: FirstRunMilestoneState): string {
  switch (state) {
    case "complete":
      return "success";
    case "blocked":
      return "error";
    case "active":
      return "idle";
    case "optional":
      return "idle";
  }
}

function getChecklistStatusLabel(state: FirstRunMilestoneState): string {
  switch (state) {
    case "complete":
      return "Done";
    case "blocked":
      return "Blocked";
    case "active":
      return "Next";
    case "optional":
      return "Optional";
  }
}

export function DashboardFirstRunChecklist({
  data,
  notes,
  templates,
  isPending,
  onCreateGoal,
  onOpenSection
}: DashboardFirstRunChecklistProps) {
  const storageKey = `agentic:first-run:${data.activeWorkspace?.id ?? "default"}`;
  const [readiness, setReadiness] = useState<ReadinessSnapshot | null>(null);
  const [readinessMessage, setReadinessMessage] = useState("Checking runtime readiness.");
  const [dismissed, setDismissed] = useState(false);
  const milestones = useMemo(
    () => buildFirstRunMilestones({ data, notes, templates, readiness }),
    [data, notes, readiness, templates]
  );
  const hasBlockingWork = hasBlockingFirstRunWork(milestones);

  useEffect(() => {
    setDismissed(getSessionStorageFlag(storageKey));
  }, [storageKey]);

  useEffect(() => {
    let cancelled = false;

    async function loadReadiness() {
      try {
        const response = await fetch("/api/ready", {
          headers: { accept: "application/json" }
        });
        const payload = (await response.json()) as ReadinessSnapshot;

        if (cancelled) {
          return;
        }

        setReadiness(payload);
        setReadinessMessage(payload.ok ? "Runtime readiness is green." : "Runtime readiness needs attention.");
      } catch {
        if (!cancelled) {
          setReadinessMessage("Runtime readiness could not be loaded.");
        }
      }
    }

    void loadReadiness();

    return () => {
      cancelled = true;
    };
  }, []);

  if (dismissed || !hasBlockingWork) {
    return null;
  }

  return (
    <article className="card first-run-checklist" id="section-first-run" aria-labelledby="first-run-checklist-title">
      <div className="card-header">
        <div>
          <h2 id="first-run-checklist-title">First-run checklist</h2>
          <p>{hasOpenSetupSurface(data) ? "Finish the local path, then move into governed work." : "Create or select a workspace to start."}</p>
        </div>
        <div className="card-header-actions">
          <span className={`status-chip ${readiness?.ok ? "success" : "idle"}`} aria-live="polite">
            {readinessMessage}
          </span>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setSessionStorageFlag(storageKey);
              setDismissed(true);
            }}
          >
            Dismiss
          </button>
        </div>
      </div>
      <div className="list-stack compact">
        {milestones.map((milestone) => (
          <div className="list-item vertical" key={milestone.id}>
            <div className="operator-product-row-heading">
              <div>
                <strong>{milestone.title}</strong>
                <p>{milestone.description}</p>
              </div>
              <span className={`status-chip ${getChecklistStatusClass(milestone.state)}`}>
                {getChecklistStatusLabel(milestone.state)}
              </span>
            </div>
            {milestone.actionLabel && milestone.state !== "complete" ? (
              <div className="goal-item-actions">
                <button
                  type="button"
                  className={milestone.blocking ? "primary-button" : "secondary-button"}
                  disabled={isPending}
                  onClick={() => {
                    if (milestone.targetSection === "goals") {
                      onCreateGoal();
                    } else if (milestone.targetSection) {
                      onOpenSection(milestone.targetSection);
                    }
                  }}
                >
                  {milestone.actionLabel}
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </article>
  );
}

function hasOpenSetupSurface(data: Pick<DashboardData, "activeWorkspace">): boolean {
  return data.activeWorkspace !== null;
}
