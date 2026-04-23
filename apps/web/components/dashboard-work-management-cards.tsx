"use client";

import type { Dispatch, SetStateAction } from "react";
import {
  briefingFocusValues,
  briefingTypeValues,
  type BriefingPreferences,
  type BriefingType,
  type CommitmentInboxBucket,
  type CommitmentInboxPage,
} from "@agentic/contracts";
import type {
  DashboardDiagnosticTarget,
  DashboardData,
} from "@agentic/repository";
import type { RequestState } from "./dashboard-types";
import { RelativeTime, StatusBadge } from "./ui";

type DashboardWorkManagementCardsProps = {
  commitmentInbox: CommitmentInboxPage;
  commitmentInboxSections: Array<{
    bucket: CommitmentInboxBucket;
    label: string;
  }>;
  commitmentBucket: CommitmentInboxBucket;
  setCommitmentBucket: Dispatch<SetStateAction<CommitmentInboxBucket>>;
  commitmentInboxState: RequestState;
  highlightedItemId: string | null;
  getItemAnchorId: (itemId: string) => string;
  isPending: boolean;
  updateCommitment: (
    commitmentId: string,
    updatedAt: string,
    action: "complete" | "dismiss" | "reopen",
  ) => Promise<void>;
  loadMoreCommitments: () => Promise<void>;
  openDiagnosticTarget: (target: DashboardDiagnosticTarget) => void;
  briefingHistory: DashboardData["briefingHistory"];
  briefingPreferences: BriefingPreferences;
  briefingPreferencesDraft: BriefingPreferences;
  setBriefingPreferencesDraft: Dispatch<SetStateAction<BriefingPreferences>>;
  updateBriefingScheduleDraft: (
    type: BriefingType,
    updates: Partial<BriefingPreferences["schedules"][number]>,
  ) => void;
  briefingTypeLabels: Record<BriefingType, string>;
  briefingFocusLabels: Record<BriefingPreferences["focus"], string>;
  generateBriefing: (type: BriefingType) => Promise<void>;
  briefingState: RequestState;
  saveBriefingPreferences: () => Promise<void>;
};

export function DashboardWorkManagementCards({
  commitmentInbox,
  commitmentInboxSections,
  commitmentBucket,
  setCommitmentBucket,
  commitmentInboxState,
  highlightedItemId,
  getItemAnchorId,
  isPending,
  updateCommitment,
  loadMoreCommitments,
  openDiagnosticTarget,
  briefingHistory,
  briefingPreferences,
  briefingPreferencesDraft,
  setBriefingPreferencesDraft,
  updateBriefingScheduleDraft,
  briefingTypeLabels,
  briefingFocusLabels,
  generateBriefing,
  briefingState,
  saveBriefingPreferences,
}: DashboardWorkManagementCardsProps) {
  return (
    <>
      <article className="card" id="section-commitments">
        <div className="card-header">
          <h2>Commitments inbox</h2>
          <div className="card-header-actions">
            <span>
              {commitmentInbox.items.length} of {commitmentInbox.totalCount}
            </span>
          </div>
        </div>
        <p className="empty-state">
          Server-derived buckets turn pending approvals and active goal
          obligations into a bounded operating queue with durable complete and
          dismiss overrides.
        </p>
        <div className="filter-options">
          {commitmentInboxSections.map((section) => (
            <button
              key={section.bucket}
              type="button"
              className={`filter-chip ${commitmentBucket === section.bucket ? "active" : ""}`}
              onClick={() => setCommitmentBucket(section.bucket)}
            >
              {section.label} ({commitmentInbox.counts[section.bucket]})
            </button>
          ))}
        </div>
        <div className="list-stack">
          {commitmentInboxState.kind === "error" ? (
            <p className="empty-state">{commitmentInboxState.message}</p>
          ) : null}
          {commitmentInbox.items.length === 0 ? (
            <p className="empty-state">
              No commitments are currently waiting on you.
            </p>
          ) : null}
          {commitmentInbox.items.map((commitment) => (
            <div
              className={`list-item vertical ${highlightedItemId === commitment.id ? "selection-highlight" : ""}`}
              id={getItemAnchorId(commitment.id)}
              key={commitment.id}
            >
              <div>
                <strong>{commitment.title}</strong>
                <p>{commitment.summary}</p>
              </div>
              <div className="approval-actions">
                <StatusBadge status={commitment.status} />
                <span className="pill">
                  {Math.round(commitment.confidence * 100)}%
                </span>
                {commitment.dueAt ? (
                  <RelativeTime date={commitment.dueAt} />
                ) : null}
                {commitment.status === "completed" ||
                commitment.status === "dismissed" ? (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      void updateCommitment(
                        commitment.id,
                        commitment.updatedAt,
                        "reopen",
                      )
                    }
                    disabled={isPending}
                  >
                    Reopen
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        void updateCommitment(
                          commitment.id,
                          commitment.updatedAt,
                          "complete",
                        )
                      }
                      disabled={isPending}
                    >
                      Complete
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        void updateCommitment(
                          commitment.id,
                          commitment.updatedAt,
                          "dismiss",
                        )
                      }
                      disabled={isPending}
                    >
                      Dismiss
                    </button>
                  </>
                )}
              </div>
              {commitment.evidence.length > 0 ? (
                <div className="diagnostic-targets">
                  {commitment.evidence.map((evidence) => (
                    <button
                      key={`${commitment.id}-${evidence.section}-${evidence.itemId ?? evidence.label}`}
                      type="button"
                      className="secondary-button diagnostic-target-button"
                      onClick={() => openDiagnosticTarget(evidence)}
                    >
                      {evidence.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          {commitmentInbox.nextCursor ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => void loadMoreCommitments()}
              disabled={isPending}
            >
              Load more
            </button>
          ) : null}
        </div>
      </article>

      <article className="card" id="section-briefings">
        <div className="card-header">
          <h2>Briefing cadence</h2>
          <span>{briefingHistory.length} recent</span>
        </div>
        <div className="hero-button-row">
          {briefingTypeValues.map((type) => (
            <button
              key={type}
              type="button"
              className={
                type === "startup" ? "primary-button" : "secondary-button"
              }
              onClick={() => void generateBriefing(type)}
              disabled={isPending}
            >
              {briefingTypeLabels[type]}
            </button>
          ))}
        </div>
        <p className={`status-chip ${briefingState.kind}`}>
          {briefingState.message ||
            "Generate startup, midday, pre-meeting, end-of-day, or next-day briefings from the same workflow contract."}
        </p>
        <div className="list-stack">
          <label className="field">
            <span>Timezone</span>
            <input
              value={briefingPreferencesDraft.timezone}
              onChange={(event) =>
                setBriefingPreferencesDraft((current) => ({
                  ...current,
                  timezone: event.target.value,
                }))
              }
              placeholder="Asia/Singapore"
            />
          </label>
          <label className="field">
            <span>Focus mode</span>
            <select
              value={briefingPreferencesDraft.focus}
              onChange={(event) =>
                setBriefingPreferencesDraft((current) => ({
                  ...current,
                  focus: event.target.value as BriefingPreferences["focus"],
                }))
              }
            >
              {briefingFocusValues.map((focus) => (
                <option key={focus} value={focus}>
                  {briefingFocusLabels[focus]}
                </option>
              ))}
            </select>
          </label>
          {briefingTypeValues.map((type) => {
            const schedule = briefingPreferencesDraft.schedules.find(
              (entry) => entry.type === type,
            );

            if (!schedule) {
              return null;
            }

            return (
              <div className="list-item vertical" key={type}>
                <div>
                  <strong>{briefingTypeLabels[type]}</strong>
                  <p>
                    {schedule.enabled ? `Runs at ${schedule.time}` : "Disabled"}
                  </p>
                </div>
                <div className="approval-actions">
                  <label className="pill">
                    <input
                      type="checkbox"
                      checked={schedule.enabled}
                      onChange={(event) =>
                        updateBriefingScheduleDraft(type, {
                          enabled: event.target.checked,
                        })
                      }
                    />{" "}
                    enabled
                  </label>
                  <input
                    type="time"
                    value={schedule.time}
                    onChange={(event) =>
                      updateBriefingScheduleDraft(type, {
                        time: event.target.value,
                      })
                    }
                    disabled={!schedule.enabled}
                  />
                </div>
              </div>
            );
          })}
          <div className="hero-button-row">
            <button
              type="button"
              className="secondary-button"
              onClick={() => void saveBriefingPreferences()}
              disabled={isPending}
            >
              Save briefing preferences
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setBriefingPreferencesDraft(briefingPreferences)}
              disabled={isPending}
            >
              Reset
            </button>
          </div>
        </div>
        <div className="list-stack">
          {briefingHistory.length === 0 ? (
            <div className="list-item vertical">
              <div>
                <strong>No briefings yet</strong>
                <p>
                  Generate a startup or scheduled briefing to create a reusable
                  operating record.
                </p>
              </div>
            </div>
          ) : (
            briefingHistory.slice(0, 5).map((briefing) => (
              <div className="list-item vertical" key={briefing.goalId}>
                <div>
                  <strong>{briefing.title}</strong>
                  <p>{briefing.summary}</p>
                </div>
                <div className="goal-item-actions">
                  <StatusBadge status={briefing.status} />
                  <span className="pill">
                    {briefingTypeLabels[briefing.type]}
                  </span>
                  <RelativeTime date={briefing.generatedAt} />
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      openDiagnosticTarget({
                        section: "goals",
                        itemId: briefing.goalId,
                        label: briefing.title,
                      })
                    }
                  >
                    Open goal
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </article>
    </>
  );
}
