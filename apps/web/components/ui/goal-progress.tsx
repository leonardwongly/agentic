"use client";

import { useMemo, useState } from "react";
import type { Goal } from "@agentic/contracts";

// Inline goal progress: Show current step/status inline on goal cards

export type GoalStep = {
  id: string;
  name: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt?: string;
  completedAt?: string;
  message?: string;
};

export type GoalProgressData = {
  goalId: string;
  totalSteps: number;
  completedSteps: number;
  currentStep?: GoalStep;
  steps: GoalStep[];
  estimatedCompletion?: Date;
  percentComplete: number;
};

// Parse goal progress from action logs or task state
export function parseGoalProgress(goal: Goal, actionLogs: Array<{ kind: string; message: string; createdAt: string }>): GoalProgressData {
  const steps: GoalStep[] = [];
  
  // Extract steps from action logs
  const stepLogs = actionLogs.filter((log) => 
    log.kind.startsWith("task.") || 
    log.kind.startsWith("agent.") ||
    log.kind.startsWith("step.")
  );

  for (const log of stepLogs) {
    const stepMatch = log.message.match(/(?:step|task|agent)\s+["']?([^"']+)["']?/i);
    const stepName = stepMatch ? stepMatch[1] : log.kind.split(".").pop() || "Unknown step";
    
    let status: GoalStep["status"] = "completed";
    if (log.kind.includes("started") || log.kind.includes("running")) {
      status = "running";
    } else if (log.kind.includes("failed") || log.kind.includes("error")) {
      status = "failed";
    } else if (log.kind.includes("skipped")) {
      status = "skipped";
    }

    steps.push({
      id: `${goal.id}-${steps.length}`,
      name: stepName,
      status,
      message: log.message,
      startedAt: log.createdAt,
      completedAt: status === "completed" ? log.createdAt : undefined
    });
  }

  // Calculate progress
  const completedSteps = steps.filter((s) => s.status === "completed").length;
  const totalSteps = Math.max(steps.length, 1);
  const currentStep = steps.find((s) => s.status === "running");
  
  // Estimate completion based on average step duration
  let estimatedCompletion: Date | undefined;
  if (currentStep && steps.length > 1) {
    const completedWithTime = steps.filter((s) => s.completedAt && s.startedAt);
    if (completedWithTime.length > 0) {
      const avgDuration = completedWithTime.reduce((sum, s) => {
        const duration = new Date(s.completedAt!).getTime() - new Date(s.startedAt!).getTime();
        return sum + duration;
      }, 0) / completedWithTime.length;
      
      const remainingSteps = totalSteps - completedSteps;
      estimatedCompletion = new Date(Date.now() + remainingSteps * avgDuration);
    }
  }

  return {
    goalId: goal.id,
    totalSteps,
    completedSteps,
    currentStep,
    steps,
    estimatedCompletion,
    percentComplete: Math.round((completedSteps / totalSteps) * 100)
  };
}

// Progress bar component
type GoalProgressBarProps = {
  progress: GoalProgressData;
  showSteps?: boolean;
  compact?: boolean;
};

export function GoalProgressBar({ progress, showSteps = false, compact = false }: GoalProgressBarProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`goal-progress ${compact ? "compact" : ""}`}>
      <div className="goal-progress-bar">
        <div
          className="goal-progress-fill"
          style={{ width: `${progress.percentComplete}%` }}
          aria-valuenow={progress.percentComplete}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      
      <div className="goal-progress-info">
        <span className="goal-progress-percent">{progress.percentComplete}%</span>
        {progress.currentStep && (
          <span className="goal-progress-current">
            {progress.currentStep.name}
            {progress.currentStep.status === "running" && <span className="running-indicator">...</span>}
          </span>
        )}
        {!compact && (
          <span className="goal-progress-steps">
            {progress.completedSteps}/{progress.totalSteps} steps
          </span>
        )}
      </div>

      {showSteps && progress.steps.length > 0 && (
        <>
          <button
            type="button"
            className="goal-progress-expand"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Hide steps" : "Show steps"}
          </button>
          
          {expanded && (
            <div className="goal-progress-steps-list">
              {progress.steps.map((step) => (
                <div key={step.id} className={`goal-step goal-step-${step.status}`}>
                  <span className="goal-step-indicator">
                    {step.status === "completed" && "✓"}
                    {step.status === "running" && "●"}
                    {step.status === "failed" && "✗"}
                    {step.status === "pending" && "○"}
                    {step.status === "skipped" && "−"}
                  </span>
                  <span className="goal-step-name">{step.name}</span>
                  {step.message && <span className="goal-step-message">{step.message}</span>}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {progress.estimatedCompletion && (
        <div className="goal-progress-eta">
          Est. completion: {progress.estimatedCompletion.toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}

// Inline progress indicator (for goal cards)
type InlineGoalProgressProps = {
  progress: GoalProgressData;
};

export function InlineGoalProgress({ progress }: InlineGoalProgressProps) {
  if (progress.percentComplete === 100) {
    return <span className="inline-progress completed">✓ Completed</span>;
  }

  return (
    <span className="inline-progress">
      <span className="inline-progress-bar">
        <span
          className="inline-progress-fill"
          style={{ width: `${progress.percentComplete}%` }}
        />
      </span>
      <span className="inline-progress-text">
        {progress.currentStep ? (
          <>Step {progress.completedSteps + 1}: {progress.currentStep.name}</>
        ) : (
          <>{progress.percentComplete}%</>
        )}
      </span>
    </span>
  );
}

// Hook for goal progress
export function useGoalProgress(
  goal: Goal,
  actionLogs: Array<{ kind: string; message: string; createdAt: string }>
) {
  return useMemo(() => parseGoalProgress(goal, actionLogs), [goal, actionLogs]);
}
