"use client";

import type { GoalBundle } from "@agentic/contracts";
import { StatusBadge, RiskBadge, RelativeTime, CopyableText, CopyButton } from "../ui";

type GoalDetailPanelProps = {
  bundle: GoalBundle;
  onClose: () => void;
  onRefine?: (message: string) => void;
  onShare?: () => void;
  onSaveAsTemplate?: () => void;
  isPending?: boolean;
};

export function GoalDetailPanel({ bundle, onClose, onRefine, onShare, onSaveAsTemplate, isPending }: GoalDetailPanelProps) {
  const { goal, workflow, tasks, artifacts, approvals, watchers, actionLogs } = bundle;

  return (
    <div className="detail-panel">
      <div className="detail-section">
        <div className="detail-header">
          <h3>Goal Details</h3>
          <CopyableText value={goal.id} />
        </div>
        <div className="detail-meta">
          <StatusBadge status={goal.status} />
          <span className="detail-meta-item">
            <strong>Confidence:</strong> {Math.round(goal.confidence * 100)}%
          </span>
          <span className="detail-meta-item">
            <strong>Created:</strong> <RelativeTime date={goal.createdAt} />
          </span>
        </div>
        <div className="detail-field">
          <label>Request</label>
          <div className="detail-value">{goal.request}</div>
        </div>
        <div className="detail-field">
          <label>Intent</label>
          <div className="detail-value">{goal.intent}</div>
        </div>
        <div className="detail-field">
          <label>Explanation</label>
          <div className="detail-value">{goal.explanation}</div>
        </div>
      </div>

      <div className="detail-section">
        <h4>Workflow</h4>
        <div className="detail-meta">
          <StatusBadge status={workflow.status} />
          <span className="detail-meta-item">
            <strong>Step:</strong> {workflow.currentStep}
          </span>
        </div>
      </div>

      {goal.wedge && goal.completionContract ? (
        <div className="detail-section">
          <h4>Goal Contract</h4>
          <div className="detail-list">
            <div className="detail-list-item">
              <div className="detail-list-header">
                <strong>{goal.wedge.label}</strong>
                <div className="detail-list-badges">
                  <span className="pill">{goal.wedge.selection.replaceAll("_", " ")}</span>
                  <span className="pill">{goal.completionContract.id}</span>
                </div>
              </div>
              <p className="detail-list-summary">{goal.wedge.rationale}</p>
              <div className="detail-list-meta">
                <span>
                  Summary: <strong>{goal.completionContract.summary}</strong>
                </span>
              </div>
              <div className="detail-field">
                <label>Done when</label>
                <div className="detail-value">{goal.completionContract.doneWhen}</div>
              </div>
              <div className="detail-field">
                <label>Success criteria</label>
                <div className="detail-list">
                  {goal.completionContract.successCriteria.map((criterion) => (
                    <div key={criterion} className="detail-list-item">
                      <p className="detail-list-summary">{criterion}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="detail-field">
                <label>Evidence signals</label>
                <div className="detail-list">
                  {goal.completionContract.evidenceSignals.map((signal) => (
                    <div key={signal} className="detail-list-item">
                      <p className="detail-list-summary">{signal}</p>
                    </div>
                  ))}
                </div>
              </div>
              {goal.completionContract.approvalExpectations.length > 0 ? (
                <div className="detail-field">
                  <label>Approval expectations</label>
                  <div className="detail-list">
                    {goal.completionContract.approvalExpectations.map((expectation) => (
                      <div key={expectation} className="detail-list-item">
                        <p className="detail-list-summary">{expectation}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="detail-section">
        <h4>Tasks ({tasks.length})</h4>
        <div className="detail-list">
          {tasks.map((task) => (
            <div key={task.id} className="detail-list-item">
              <div className="detail-list-header">
                <strong>{task.title}</strong>
                <div className="detail-list-badges">
                  <StatusBadge status={task.state} />
                  <RiskBadge riskClass={task.riskClass} />
                </div>
              </div>
              <p className="detail-list-summary">{task.summary}</p>
              <div className="detail-list-meta">
                <span>Agent: {task.assignedAgent}</span>
                <span>Capabilities: {task.toolCapabilities.join(", ") || "none"}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {artifacts.length > 0 && (
        <div className="detail-section">
          <h4>Artifacts ({artifacts.length})</h4>
          <div className="detail-list">
            {artifacts.map((artifact) => (
              <div key={artifact.id} className="detail-list-item">
                <div className="detail-list-header">
                  <strong>{artifact.title}</strong>
                  <StatusBadge status={artifact.artifactType} />
                </div>
                <pre className="detail-artifact-content">{artifact.content}</pre>
                <CopyButton value={artifact.content} label="Copy" />
              </div>
            ))}
          </div>
        </div>
      )}

      {approvals.length > 0 && (
        <div className="detail-section">
          <h4>Approvals ({approvals.length})</h4>
          <div className="detail-list">
            {approvals.map((approval) => (
              <div key={approval.id} className="detail-list-item">
                <div className="detail-list-header">
                  <strong>{approval.title}</strong>
                  <div className="detail-list-badges">
                    <StatusBadge status={approval.decision} />
                    <RiskBadge riskClass={approval.riskClass} />
                  </div>
                </div>
                <p className="detail-list-summary">{approval.rationale}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {watchers.length > 0 && (
        <div className="detail-section">
          <h4>Watchers ({watchers.length})</h4>
          <div className="detail-list">
            {watchers.map((watcher) => (
              <div key={watcher.id} className="detail-list-item">
                <div className="detail-list-header">
                  <strong>{watcher.targetEntity}</strong>
                  <StatusBadge status={watcher.status} />
                </div>
                <p className="detail-list-summary">{watcher.condition}</p>
                <span className="pill">{watcher.frequency}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="detail-section">
        <h4>Activity Log ({actionLogs.length})</h4>
        <div className="detail-timeline">
          {actionLogs.map((log) => (
            <div key={log.id} className="detail-timeline-item">
              <div className="detail-timeline-dot" />
              <div className="detail-timeline-content">
                <strong>{log.kind}</strong>
                <p>{log.message}</p>
                <RelativeTime date={log.createdAt} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="detail-actions">
        {onShare && (
          <button type="button" className="secondary-button" onClick={onShare} disabled={isPending}>
            Share
          </button>
        )}
        {goal.status === "completed" && onSaveAsTemplate && (
          <button type="button" className="secondary-button" onClick={onSaveAsTemplate} disabled={isPending}>
            Save as Template
          </button>
        )}
      </div>
    </div>
  );
}
