"use client";

import type { Dispatch, SetStateAction } from "react";
import type { DashboardData } from "@agentic/repository";
import type { RequestState } from "./dashboard-types";
import {
  AgentOverride,
  ContextualSuggestion,
  CopyButton,
  CopyableText,
  NoGoalsEmpty,
  StatusBadge,
} from "./ui";

type DashboardGoalsCardProps = {
  goalBundles: DashboardData["goals"];
  totalGoalCount: number;
  request: string;
  setRequest: Dispatch<SetStateAction<string>>;
  selectedAgentId: string | undefined;
  setSelectedAgentId: Dispatch<SetStateAction<string | undefined>>;
  createGoal: () => void;
  generateStartupBriefing: () => Promise<void>;
  isPending: boolean;
  submitState: RequestState;
  shareState: RequestState;
  refinementState: RequestState;
  lastShareUrl: string | null;
  focusRequestComposer: () => void;
  shareGoal: (goalId: string, goalTitle: string) => void;
  saveAsTemplate: (name: string, request: string) => void;
  shareStatsByGoal: Map<
    string,
    { total: number; active: number; viewed: number }
  >;
  highlightedItemId: string | null;
  getItemAnchorId: (itemId: string) => string;
  refinementInputs: Record<string, string>;
  setRefinementInputs: Dispatch<SetStateAction<Record<string, string>>>;
  refineGoal: (goalId: string) => void;
};

export function DashboardGoalsCard({
  goalBundles,
  totalGoalCount,
  request,
  setRequest,
  selectedAgentId,
  setSelectedAgentId,
  createGoal,
  generateStartupBriefing,
  isPending,
  submitState,
  shareState,
  refinementState,
  lastShareUrl,
  focusRequestComposer,
  shareGoal,
  saveAsTemplate,
  shareStatsByGoal,
  highlightedItemId,
  getItemAnchorId,
  refinementInputs,
  setRefinementInputs,
  refineGoal,
}: DashboardGoalsCardProps) {
  return (
    <article className="card request-card" id="section-goals">
      <div className="card-header">
        <h2>Request work</h2>
        <span>{totalGoalCount} goals</span>
      </div>
      <ContextualSuggestion
        type="goal"
        currentValue={request}
        onApply={(suggestion) => setRequest(suggestion)}
      />
      <textarea
        value={request}
        onChange={(event) => setRequest(event.target.value)}
        placeholder="Example: Clear today’s approvals, surface blocked commitments, and draft replies for anything urgent."
        rows={6}
      />
      <AgentOverride
        value={selectedAgentId}
        onChange={setSelectedAgentId}
        disabled={isPending}
      />
      <div className="hero-button-row">
        <button
          type="button"
          className="primary-button"
          onClick={createGoal}
          disabled={isPending}
        >
          Submit request
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => void generateStartupBriefing()}
          disabled={isPending}
        >
          Startup Briefing
        </button>
      </div>
      <p className={`status-chip ${submitState.kind}`}>
        {submitState.message ||
          "Requests are validated, policy checked, and converted into bounded execution bundles before anything runs."}
      </p>
      {shareState.message ? (
        <div className="share-status-row">
          <p className={`status-chip ${shareState.kind}`}>
            {shareState.message}
          </p>
          {lastShareUrl ? (
            <>
              <CopyButton value={lastShareUrl} label="Copy" />
              <a className="inline-link" href={lastShareUrl}>
                Open public share page
              </a>
            </>
          ) : null}
        </div>
      ) : null}
      {refinementState.message ? (
        <p className={`status-chip ${refinementState.kind}`}>
          {refinementState.message}
        </p>
      ) : null}
      <div className="list-stack">
        {goalBundles.length === 0 ? (
          <NoGoalsEmpty onCreate={focusRequestComposer} />
        ) : null}
        {goalBundles.slice(0, 4).map((bundle) => {
          const refinementLogs = bundle.actionLogs.filter(
            (log) => log.kind === "goal.refined",
          );
          const isActive = bundle.goal.status !== "completed";

          return (
            <div
              className={`list-item vertical ${highlightedItemId === bundle.goal.id ? "selection-highlight" : ""}`}
              id={getItemAnchorId(bundle.goal.id)}
              key={bundle.goal.id}
            >
              <div>
                <strong>{bundle.goal.title}</strong>
                <p>{bundle.goal.explanation}</p>
              </div>
              <div className="goal-item-actions">
                <StatusBadge status={bundle.goal.status} />
                <CopyableText value={bundle.goal.id} />
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => shareGoal(bundle.goal.id, bundle.goal.title)}
                  disabled={isPending}
                >
                  Copy share link
                </button>
                {bundle.goal.status === "completed" ? (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      saveAsTemplate(bundle.goal.title, bundle.goal.request)
                    }
                    disabled={isPending}
                  >
                    Save as template
                  </button>
                ) : null}
                <small className="share-metric">
                  {shareStatsByGoal.get(bundle.goal.id)?.active ?? 0} active ·{" "}
                  {shareStatsByGoal.get(bundle.goal.id)?.viewed ?? 0} viewed
                </small>
              </div>
              {refinementLogs.length > 0 ? (
                <div className="refinement-history">
                  {refinementLogs.map((log) => (
                    <small key={log.id} className="refinement-log">
                      {log.message}
                    </small>
                  ))}
                </div>
              ) : null}
              {isActive ? (
                <div className="refinement-row">
                  <input
                    value={refinementInputs[bundle.goal.id] ?? ""}
                    onChange={(event) =>
                      setRefinementInputs((prev) => ({
                        ...prev,
                        [bundle.goal.id]: event.target.value,
                      }))
                    }
                    placeholder="Refine this goal..."
                    maxLength={2000}
                  />
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => refineGoal(bundle.goal.id)}
                    disabled={
                      isPending ||
                      !(refinementInputs[bundle.goal.id] ?? "").trim()
                    }
                  >
                    Refine
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </article>
  );
}
