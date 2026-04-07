"use client";

import { useState } from "react";

type HelpTooltipProps = {
  term: string;
  explanation: string;
  learnMoreUrl?: string;
  children: React.ReactNode;
};

export function HelpTooltip({ term, explanation, learnMoreUrl, children }: HelpTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <span
      className="help-tooltip-wrapper"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
      onFocus={() => setIsVisible(true)}
      onBlur={() => setIsVisible(false)}
    >
      <span className="help-tooltip-trigger" tabIndex={0}>
        {children}
        <span className="help-tooltip-icon" aria-hidden="true">?</span>
      </span>
      {isVisible && (
        <div className="help-tooltip-content" role="tooltip">
          <strong>{term}</strong>
          <p>{explanation}</p>
          {learnMoreUrl && (
            <a href={learnMoreUrl} target="_blank" rel="noopener noreferrer" className="help-tooltip-link">
              Learn more →
            </a>
          )}
        </div>
      )}
    </span>
  );
}

// Pre-defined help content for common terms
const helpContent: Record<string, { explanation: string; learnMoreUrl?: string }> = {
  R1: {
    explanation: "Auto-approved. Low-risk actions that don't require explicit user consent.",
  },
  R2: {
    explanation: "Requires approval. Standard actions that the user should review before execution.",
  },
  R3: {
    explanation: "High-risk action requiring explicit approval and justification.",
  },
  R4: {
    explanation: "Critical action. Requires approval, may have significant consequences.",
  },
  observed: {
    explanation: "Memory learned from observing user behavior or patterns.",
  },
  inferred: {
    explanation: "Memory deduced from context but not explicitly confirmed by user.",
  },
  confirmed: {
    explanation: "Memory explicitly confirmed or added by the user.",
  },
  active: {
    explanation: "Agent is enabled and will be assigned tasks matching its capabilities.",
  },
  paused: {
    explanation: "Agent is temporarily disabled. Won't receive new tasks until resumed.",
  },
  archived: {
    explanation: "Agent is archived. Can be restored but won't receive tasks.",
  },
  draft: {
    explanation: "Agent is in draft mode. Not yet activated for task assignment.",
  }
};

type RiskClassHelpProps = {
  riskClass: string;
  children: React.ReactNode;
};

export function RiskClassHelp({ riskClass, children }: RiskClassHelpProps) {
  const content = helpContent[riskClass];
  if (!content) return <>{children}</>;

  return (
    <HelpTooltip term={`Risk Class ${riskClass}`} explanation={content.explanation}>
      {children}
    </HelpTooltip>
  );
}

type MemoryTypeHelpProps = {
  memoryType: string;
  children: React.ReactNode;
};

export function MemoryTypeHelp({ memoryType, children }: MemoryTypeHelpProps) {
  const content = helpContent[memoryType];
  if (!content) return <>{children}</>;

  return (
    <HelpTooltip term={`${memoryType.charAt(0).toUpperCase() + memoryType.slice(1)} Memory`} explanation={content.explanation}>
      {children}
    </HelpTooltip>
  );
}

type AgentStatusHelpProps = {
  status: string;
  children: React.ReactNode;
};

export function AgentStatusHelp({ status, children }: AgentStatusHelpProps) {
  const content = helpContent[status];
  if (!content) return <>{children}</>;

  return (
    <HelpTooltip term={`Agent Status: ${status}`} explanation={content.explanation}>
      {children}
    </HelpTooltip>
  );
}

type FeatureHelpProps = {
  feature: "templates" | "watchers" | "briefing" | "artifacts";
  children: React.ReactNode;
};

const featureHelp: Record<FeatureHelpProps["feature"], { term: string; explanation: string }> = {
  templates: {
    term: "Goal Templates",
    explanation: "Reusable goal configurations. Save completed goals as templates and optionally schedule them to run automatically."
  },
  watchers: {
    term: "Watchers",
    explanation: "Automated monitors that check conditions and trigger actions. Set up rules to watch for specific events."
  },
  briefing: {
    term: "Morning Briefing",
    explanation: "AI-generated summary of your day including emails, calendar events, tasks, and important updates."
  },
  artifacts: {
    term: "Artifacts",
    explanation: "Generated content from agent work: summaries, briefs, checklists, drafts, and explanations."
  }
};

export function FeatureHelp({ feature, children }: FeatureHelpProps) {
  const content = featureHelp[feature];
  return (
    <HelpTooltip term={content.term} explanation={content.explanation}>
      {children}
    </HelpTooltip>
  );
}
