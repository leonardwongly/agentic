"use client";

import { useMemo, useState, useCallback } from "react";
import type { GoalTemplate } from "@agentic/contracts";

// Goal templates quick-fill: One-click template run with pre-filled params

type TemplateParameter = {
  name: string;
  type: "text" | "select" | "number" | "date";
  label: string;
  placeholder?: string;
  options?: string[];
  default?: string | number;
  required?: boolean;
};

// Parse template for parameters (e.g., {{email_count}}, {{date}})
export function parseTemplateParameters(template: GoalTemplate): TemplateParameter[] {
  const params: TemplateParameter[] = [];
  const regex = /\{\{(\w+)(?::(\w+))?\}\}/g;
  let match;

  while ((match = regex.exec(template.request)) !== null) {
    const name = match[1];
    const typeHint = match[2] || "text";

    // Skip if already added
    if (params.some((p) => p.name === name)) continue;

    let type: TemplateParameter["type"] = "text";
    if (typeHint === "number" || typeHint === "count") type = "number";
    if (typeHint === "date") type = "date";
    if (typeHint === "select") type = "select";

    params.push({
      name,
      type,
      label: name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      placeholder: `Enter ${name.replace(/_/g, " ")}`,
      required: true
    });
  }

  return params;
}

// Fill template with parameters
export function fillTemplate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)(?::\w+)?\}\}/g, (_, name) => {
    return String(params[name] ?? "");
  });
}

// Time-based template suggestions
export function getContextualTemplates(
  templates: GoalTemplate[],
  context: { hour: number; dayOfWeek: number; recentGoals?: string[] }
): GoalTemplate[] {
  const scored = templates.map((template) => {
    let score = 0;
    const name = template.name.toLowerCase();
    const request = template.request.toLowerCase();

    // Morning templates (6-10am)
    if (context.hour >= 6 && context.hour <= 10) {
      if (name.includes("morning") || name.includes("briefing") || name.includes("daily")) {
        score += 50;
      }
      if (request.includes("email") || request.includes("inbox") || request.includes("triage")) {
        score += 30;
      }
    }

    // Afternoon templates (12-2pm)
    if (context.hour >= 12 && context.hour <= 14) {
      if (name.includes("lunch") || name.includes("break")) {
        score += 30;
      }
    }

    // End of day templates (4-6pm)
    if (context.hour >= 16 && context.hour <= 18) {
      if (name.includes("summary") || name.includes("wrap") || name.includes("end of day")) {
        score += 50;
      }
      if (request.includes("summarize") || request.includes("report")) {
        score += 30;
      }
    }

    // Friday afternoon
    if (context.dayOfWeek === 5 && context.hour >= 14) {
      if (name.includes("weekly") || name.includes("week")) {
        score += 50;
      }
    }

    // Monday morning
    if (context.dayOfWeek === 1 && context.hour >= 6 && context.hour <= 11) {
      if (name.includes("week") || name.includes("planning")) {
        score += 40;
      }
    }

    // Boost recently used templates
    if (context.recentGoals?.some((g) => g.includes(template.name))) {
      score += 20;
    }

    return { template, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.template);
}

// Quick-fill template component
type TemplateQuickFillProps = {
  template: GoalTemplate;
  onRun: (request: string) => void;
  onCancel: () => void;
};

export function TemplateQuickFill({ template, onRun, onCancel }: TemplateQuickFillProps) {
  const parameters = useMemo(() => parseTemplateParameters(template), [template]);
  const [values, setValues] = useState<Record<string, string | number>>(() => {
    const initial: Record<string, string | number> = {};
    for (const param of parameters) {
      if (param.default !== undefined) {
        initial[param.name] = param.default;
      }
    }
    return initial;
  });

  const filledRequest = useMemo(
    () => fillTemplate(template.request, values),
    [template.request, values]
  );

  const isComplete = parameters.every(
    (p) => !p.required || (values[p.name] !== undefined && values[p.name] !== "")
  );

  const handleRun = () => {
    if (isComplete) {
      onRun(filledRequest);
    }
  };

  // If no parameters, run immediately
  if (parameters.length === 0) {
    return (
      <div className="template-quick-fill instant">
        <p>Run "{template.name}"?</p>
        <div className="template-actions">
          <button type="button" className="primary-button" onClick={() => onRun(template.request)}>
            Run now
          </button>
          <button type="button" className="secondary-button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="template-quick-fill">
      <h3>{template.name}</h3>
      <p className="template-description">{template.request.slice(0, 100)}...</p>

      <div className="template-params">
        {parameters.map((param) => (
          <div key={param.name} className="template-param">
            <label htmlFor={`param-${param.name}`}>
              {param.label}
              {param.required && <span className="required">*</span>}
            </label>
            {param.type === "select" && param.options ? (
              <select
                id={`param-${param.name}`}
                value={String(values[param.name] || "")}
                onChange={(e) => setValues((v) => ({ ...v, [param.name]: e.target.value }))}
              >
                <option value="">Select...</option>
                {param.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : param.type === "number" ? (
              <input
                id={`param-${param.name}`}
                type="number"
                value={values[param.name] || ""}
                onChange={(e) => setValues((v) => ({ ...v, [param.name]: Number(e.target.value) }))}
                placeholder={param.placeholder}
              />
            ) : param.type === "date" ? (
              <input
                id={`param-${param.name}`}
                type="date"
                value={String(values[param.name] || "")}
                onChange={(e) => setValues((v) => ({ ...v, [param.name]: e.target.value }))}
              />
            ) : (
              <input
                id={`param-${param.name}`}
                type="text"
                value={String(values[param.name] || "")}
                onChange={(e) => setValues((v) => ({ ...v, [param.name]: e.target.value }))}
                placeholder={param.placeholder}
              />
            )}
          </div>
        ))}
      </div>

      <div className="template-preview">
        <label>Preview:</label>
        <p>{filledRequest}</p>
      </div>

      <div className="template-actions">
        <button type="button" className="primary-button" onClick={handleRun} disabled={!isComplete}>
          Run now
        </button>
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// Suggested templates bar
type SuggestedTemplatesProps = {
  templates: GoalTemplate[];
  onSelect: (template: GoalTemplate) => void;
  maxSuggestions?: number;
};

export function SuggestedTemplates({ templates, onSelect, maxSuggestions = 3 }: SuggestedTemplatesProps) {
  const suggestions = useMemo(() => {
    const now = new Date();
    return getContextualTemplates(templates, {
      hour: now.getHours(),
      dayOfWeek: now.getDay()
    }).slice(0, maxSuggestions);
  }, [templates, maxSuggestions]);

  if (suggestions.length === 0) return null;

  return (
    <div className="suggested-templates">
      <span className="suggested-label">Suggested:</span>
      {suggestions.map((template) => (
        <button
          key={template.id}
          type="button"
          className="suggested-template"
          onClick={() => onSelect(template)}
        >
          {template.name}
        </button>
      ))}
    </div>
  );
}

// Hook for template management
export function useTemplateQuickFill(templates: GoalTemplate[], onRun: (request: string) => Promise<void>) {
  const [selectedTemplate, setSelectedTemplate] = useState<GoalTemplate | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const runTemplate = useCallback(
    async (request: string) => {
      setIsRunning(true);
      try {
        await onRun(request);
        setSelectedTemplate(null);
      } finally {
        setIsRunning(false);
      }
    },
    [onRun]
  );

  const cancelTemplate = useCallback(() => {
    setSelectedTemplate(null);
  }, []);

  return {
    selectedTemplate,
    setSelectedTemplate,
    runTemplate,
    cancelTemplate,
    isRunning
  };
}
