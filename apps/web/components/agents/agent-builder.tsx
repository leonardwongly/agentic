"use client";

import { useState } from "react";
import type {
  AgentCategory,
  AgentDefinition,
  ArtifactType,
  Capability,
  RiskClass
} from "@agentic/contracts";

type AgentBuilderProps = {
  onSave: (agent: Partial<AgentDefinition>) => Promise<void>;
  onCancel: () => void;
  initialAgent?: AgentDefinition;
  isPending?: boolean;
};

type Step = "basics" | "prompt" | "behavior" | "capabilities" | "review";

const steps: { id: Step; label: string }[] = [
  { id: "basics", label: "Basics" },
  { id: "prompt", label: "Prompt" },
  { id: "behavior", label: "Behavior" },
  { id: "capabilities", label: "Capabilities" },
  { id: "review", label: "Review" }
];

const categories: AgentCategory[] = [
  "productivity",
  "communication",
  "research",
  "scheduling",
  "finance",
  "development",
  "creative",
  "administrative",
  "custom"
];

const artifactTypes: ArtifactType[] = [
  "summary",
  "brief",
  "checklist",
  "draft",
  "explanation"
];

const allCapabilities: Capability[] = [
  "read",
  "search",
  "create",
  "update",
  "draft",
  "send",
  "schedule",
  "monitor",
  "approve",
  "delete"
];

const riskClasses: RiskClass[] = ["R1", "R2", "R3", "R4"];

const commonEmojis = ["🤖", "🧠", "💡", "⚡", "📊", "📝", "🔍", "💬", "📅", "💻", "🎨", "📋", "🚀", "⭐", "🔧", "📈"];

export function AgentBuilder({ onSave, onCancel, initialAgent, isPending }: AgentBuilderProps) {
  const [currentStep, setCurrentStep] = useState<Step>("basics");
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState(initialAgent?.name ?? "");
  const [displayName, setDisplayName] = useState(initialAgent?.displayName ?? "");
  const [description, setDescription] = useState(initialAgent?.description ?? "");
  const [icon, setIcon] = useState(initialAgent?.icon ?? "🤖");
  const [category, setCategory] = useState<AgentCategory>(initialAgent?.category ?? "custom");
  const [tags, setTags] = useState(initialAgent?.tags?.join(", ") ?? "");

  const [systemPrompt, setSystemPrompt] = useState(initialAgent?.systemPrompt ?? "");

  const [temperature, setTemperature] = useState(initialAgent?.behaviorConfig?.temperature ?? 0.7);
  const [maxTokens, setMaxTokens] = useState(initialAgent?.behaviorConfig?.maxTokens ?? 1500);
  const [responseStyle, setResponseStyle] = useState<"concise" | "detailed" | "balanced">(
    initialAgent?.behaviorConfig?.responseStyle ?? "balanced"
  );
  const [formality, setFormality] = useState<"casual" | "professional" | "formal">(
    initialAgent?.behaviorConfig?.formality ?? "professional"
  );
  const [artifactType, setArtifactType] = useState<ArtifactType>(initialAgent?.artifactType ?? "summary");

  const [allowedCapabilities, setAllowedCapabilities] = useState<Capability[]>(
    initialAgent?.allowedCapabilities ?? ["read", "search"]
  );
  const [blockedCapabilities, setBlockedCapabilities] = useState<Capability[]>(
    initialAgent?.blockedCapabilities ?? []
  );
  const [maxRiskClass, setMaxRiskClass] = useState<RiskClass>(initialAgent?.maxRiskClass ?? "R2");

  const stepIndex = steps.findIndex((s) => s.id === currentStep);
  const canGoBack = stepIndex > 0;
  const canGoForward = stepIndex < steps.length - 1;
  const isLastStep = currentStep === "review";

  const validateStep = (): string | null => {
    switch (currentStep) {
      case "basics":
        if (!name.trim()) return "Name is required";
        if (!/^[a-z][a-z0-9-]*$/.test(name)) return "Name must be lowercase alphanumeric with hyphens";
        if (!displayName.trim()) return "Display name is required";
        return null;
      case "prompt":
        if (!systemPrompt.trim()) return "System prompt is required";
        if (systemPrompt.length < 10) return "System prompt must be at least 10 characters";
        return null;
      default:
        return null;
    }
  };

  const goNext = () => {
    const validationError = validateStep();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    const nextIndex = stepIndex + 1;
    if (nextIndex < steps.length) {
      setCurrentStep(steps[nextIndex].id);
    }
  };

  const goBack = () => {
    setError(null);
    const prevIndex = stepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(steps[prevIndex].id);
    }
  };

  const handleSave = async () => {
    const validationError = validateStep();
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setError(null);
      await onSave({
        name: name.trim(),
        displayName: displayName.trim(),
        description: description.trim(),
        icon,
        category,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        systemPrompt: systemPrompt.trim(),
        artifactType,
        behaviorConfig: {
          temperature,
          maxTokens,
          topP: 1,
          frequencyPenalty: 0,
          presencePenalty: 0,
          responseStyle,
          formality
        },
        allowedCapabilities,
        blockedCapabilities,
        maxRiskClass
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save agent");
    }
  };

  const toggleCapability = (cap: Capability, list: "allowed" | "blocked") => {
    if (list === "allowed") {
      if (allowedCapabilities.includes(cap)) {
        setAllowedCapabilities(allowedCapabilities.filter((c) => c !== cap));
      } else {
        setAllowedCapabilities([...allowedCapabilities, cap]);
        setBlockedCapabilities(blockedCapabilities.filter((c) => c !== cap));
      }
    } else {
      if (blockedCapabilities.includes(cap)) {
        setBlockedCapabilities(blockedCapabilities.filter((c) => c !== cap));
      } else {
        setBlockedCapabilities([...blockedCapabilities, cap]);
        setAllowedCapabilities(allowedCapabilities.filter((c) => c !== cap));
      }
    }
  };

  return (
    <div className="agent-builder">
      <div className="builder-header">
        <h2>{initialAgent ? "Edit Agent" : "Create New Agent"}</h2>
        <button type="button" className="close-btn" onClick={onCancel}>
          ×
        </button>
      </div>

      <div className="builder-steps">
        {steps.map((step, index) => (
          <button
            key={step.id}
            type="button"
            className={`step ${currentStep === step.id ? "active" : ""} ${index < stepIndex ? "completed" : ""}`}
            onClick={() => {
              if (index <= stepIndex) setCurrentStep(step.id);
            }}
          >
            <span className="step-number">{index + 1}</span>
            <span className="step-label">{step.label}</span>
          </button>
        ))}
      </div>

      {error && <div className="builder-error">{error}</div>}

      <div className="builder-content">
        {currentStep === "basics" && (
          <div className="step-content">
            <div className="form-group">
              <label htmlFor="agent-name">Agent Name *</label>
              <input
                id="agent-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="my-custom-agent"
                maxLength={64}
              />
              <span className="help-text">Lowercase letters, numbers, and hyphens only</span>
            </div>

            <div className="form-group">
              <label htmlFor="display-name">Display Name *</label>
              <input
                id="display-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="My Custom Agent"
                maxLength={100}
              />
            </div>

            <div className="form-group">
              <label htmlFor="description">Description</label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this agent do?"
                rows={3}
                maxLength={500}
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Icon</label>
                <div className="emoji-picker">
                  {commonEmojis.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      className={`emoji-btn ${icon === emoji ? "selected" : ""}`}
                      onClick={() => setIcon(emoji)}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="category">Category</label>
                <select
                  id="category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as AgentCategory)}
                >
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="tags">Tags</label>
              <input
                id="tags"
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="tag1, tag2, tag3"
              />
              <span className="help-text">Comma-separated list</span>
            </div>
          </div>
        )}

        {currentStep === "prompt" && (
          <div className="step-content">
            <div className="form-group full-height">
              <label htmlFor="system-prompt">System Prompt *</label>
              <textarea
                id="system-prompt"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="You are a helpful assistant that..."
                rows={15}
                maxLength={8000}
                className="prompt-textarea"
              />
              <span className="help-text">{systemPrompt.length}/8000 characters</span>
            </div>
          </div>
        )}

        {currentStep === "behavior" && (
          <div className="step-content">
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="temperature">Temperature: {temperature}</label>
                <input
                  id="temperature"
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                />
                <span className="help-text">Lower = more focused, Higher = more creative</span>
              </div>

              <div className="form-group">
                <label htmlFor="max-tokens">Max Tokens: {maxTokens}</label>
                <input
                  id="max-tokens"
                  type="range"
                  min="100"
                  max="8000"
                  step="100"
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(parseInt(e.target.value, 10))}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="response-style">Response Style</label>
                <select
                  id="response-style"
                  value={responseStyle}
                  onChange={(e) => setResponseStyle(e.target.value as typeof responseStyle)}
                >
                  <option value="concise">Concise</option>
                  <option value="balanced">Balanced</option>
                  <option value="detailed">Detailed</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="formality">Formality</label>
                <select
                  id="formality"
                  value={formality}
                  onChange={(e) => setFormality(e.target.value as typeof formality)}
                >
                  <option value="casual">Casual</option>
                  <option value="professional">Professional</option>
                  <option value="formal">Formal</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="artifact-type">Default Artifact Type</label>
              <select
                id="artifact-type"
                value={artifactType}
                onChange={(e) => setArtifactType(e.target.value as ArtifactType)}
              >
                {artifactTypes.map((type) => (
                  <option key={type} value={type}>
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {currentStep === "capabilities" && (
          <div className="step-content">
            <div className="form-group">
              <label>Capabilities</label>
              <p className="help-text">Configure what actions this agent can and cannot perform</p>

              <div className="capabilities-matrix">
                <div className="cap-header">
                  <span>Capability</span>
                  <span>Allowed</span>
                  <span>Blocked</span>
                </div>
                {allCapabilities.map((cap) => (
                  <div key={cap} className="cap-row">
                    <span className="cap-name">{cap}</span>
                    <button
                      type="button"
                      className={`cap-btn ${allowedCapabilities.includes(cap) ? "active allowed" : ""}`}
                      onClick={() => toggleCapability(cap, "allowed")}
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      className={`cap-btn ${blockedCapabilities.includes(cap) ? "active blocked" : ""}`}
                      onClick={() => toggleCapability(cap, "blocked")}
                    >
                      ✗
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="max-risk">Maximum Risk Class</label>
              <select
                id="max-risk"
                value={maxRiskClass}
                onChange={(e) => setMaxRiskClass(e.target.value as RiskClass)}
              >
                {riskClasses.map((risk) => (
                  <option key={risk} value={risk}>
                    {risk} - {risk === "R1" ? "No approval needed" : risk === "R2" ? "User confirmation" : risk === "R3" ? "Multi-step approval" : "Admin only"}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {currentStep === "review" && (
          <div className="step-content review">
            <div className="review-section">
              <h3>Basic Information</h3>
              <div className="review-grid">
                <div><strong>Name:</strong> @{name}</div>
                <div><strong>Display:</strong> {icon} {displayName}</div>
                <div><strong>Category:</strong> {category}</div>
                <div><strong>Tags:</strong> {tags || "None"}</div>
              </div>
              {description && <p className="review-description">{description}</p>}
            </div>

            <div className="review-section">
              <h3>System Prompt</h3>
              <pre className="review-prompt">{systemPrompt.slice(0, 300)}{systemPrompt.length > 300 ? "..." : ""}</pre>
            </div>

            <div className="review-section">
              <h3>Behavior</h3>
              <div className="review-grid">
                <div><strong>Temperature:</strong> {temperature}</div>
                <div><strong>Max Tokens:</strong> {maxTokens}</div>
                <div><strong>Style:</strong> {responseStyle}</div>
                <div><strong>Formality:</strong> {formality}</div>
                <div><strong>Artifact:</strong> {artifactType}</div>
                <div><strong>Max Risk:</strong> {maxRiskClass}</div>
              </div>
            </div>

            <div className="review-section">
              <h3>Capabilities</h3>
              <div className="review-caps">
                <div>
                  <strong>Allowed:</strong>{" "}
                  {allowedCapabilities.length > 0 ? allowedCapabilities.join(", ") : "None"}
                </div>
                <div>
                  <strong>Blocked:</strong>{" "}
                  {blockedCapabilities.length > 0 ? blockedCapabilities.join(", ") : "None"}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="builder-footer">
        <button type="button" className="cancel-btn" onClick={onCancel} disabled={isPending}>
          Cancel
        </button>
        <div className="nav-buttons">
          {canGoBack && (
            <button type="button" className="back-btn" onClick={goBack} disabled={isPending}>
              ← Back
            </button>
          )}
          {canGoForward && (
            <button type="button" className="next-btn" onClick={goNext} disabled={isPending}>
              Next →
            </button>
          )}
          {isLastStep && (
            <button type="button" className="save-btn" onClick={handleSave} disabled={isPending}>
              {isPending ? "Saving..." : initialAgent ? "Save Changes" : "Create Agent"}
            </button>
          )}
        </div>
      </div>

      <style jsx>{`
        .agent-builder {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: var(--color-background, #121212);
        }

        .builder-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 24px;
          border-bottom: 1px solid var(--color-border, #333);
        }

        .builder-header h2 {
          margin: 0;
          font-size: 18px;
          color: var(--color-text, #fff);
        }

        .close-btn {
          background: none;
          border: none;
          font-size: 24px;
          color: var(--color-text-muted, #888);
          cursor: pointer;
          padding: 4px;
        }

        .close-btn:hover {
          color: var(--color-text, #fff);
        }

        .builder-steps {
          display: flex;
          padding: 16px 24px;
          gap: 8px;
          border-bottom: 1px solid var(--color-border, #333);
        }

        .step {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 16px;
          background: var(--color-surface, #1e1e1e);
          border: 1px solid var(--color-border, #333);
          border-radius: 20px;
          color: var(--color-text-muted, #888);
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .step:hover {
          border-color: var(--color-text-muted, #888);
        }

        .step.active {
          background: var(--color-primary, #0ea5e9);
          border-color: var(--color-primary, #0ea5e9);
          color: white;
        }

        .step.completed {
          border-color: var(--color-success, #22c55e);
          color: var(--color-success, #22c55e);
        }

        .step-number {
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          background: var(--color-surface-secondary, #2a2a2a);
          font-size: 11px;
          font-weight: 600;
        }

        .step.active .step-number {
          background: rgba(255, 255, 255, 0.2);
        }

        .step.completed .step-number {
          background: var(--color-success, #22c55e);
          color: white;
        }

        .builder-error {
          margin: 16px 24px 0;
          padding: 12px 16px;
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid var(--color-error, #ef4444);
          border-radius: 8px;
          color: var(--color-error, #ef4444);
          font-size: 13px;
        }

        .builder-content {
          flex: 1;
          overflow-y: auto;
          padding: 24px;
        }

        .step-content {
          max-width: 600px;
        }

        .step-content.review {
          max-width: 700px;
        }

        .form-group {
          margin-bottom: 20px;
        }

        .form-group.full-height {
          display: flex;
          flex-direction: column;
          height: calc(100% - 20px);
        }

        .form-group label {
          display: block;
          font-size: 13px;
          font-weight: 500;
          color: var(--color-text, #fff);
          margin-bottom: 8px;
        }

        .form-group input[type="text"],
        .form-group textarea,
        .form-group select {
          width: 100%;
          padding: 10px 12px;
          background: var(--color-surface, #1e1e1e);
          border: 1px solid var(--color-border, #333);
          border-radius: 6px;
          color: var(--color-text, #fff);
          font-size: 14px;
        }

        .form-group textarea {
          resize: vertical;
        }

        .prompt-textarea {
          flex: 1;
          min-height: 200px;
          font-family: monospace;
        }

        .form-group input:focus,
        .form-group textarea:focus,
        .form-group select:focus {
          outline: none;
          border-color: var(--color-primary, #0ea5e9);
        }

        .help-text {
          display: block;
          font-size: 11px;
          color: var(--color-text-muted, #888);
          margin-top: 4px;
        }

        .form-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }

        .emoji-picker {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
        }

        .emoji-btn {
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--color-surface, #1e1e1e);
          border: 1px solid var(--color-border, #333);
          border-radius: 6px;
          font-size: 18px;
          cursor: pointer;
        }

        .emoji-btn:hover {
          border-color: var(--color-text-muted, #888);
        }

        .emoji-btn.selected {
          border-color: var(--color-primary, #0ea5e9);
          background: rgba(14, 165, 233, 0.1);
        }

        .capabilities-matrix {
          background: var(--color-surface, #1e1e1e);
          border: 1px solid var(--color-border, #333);
          border-radius: 8px;
          overflow: hidden;
        }

        .cap-header,
        .cap-row {
          display: grid;
          grid-template-columns: 1fr 80px 80px;
          padding: 10px 16px;
        }

        .cap-header {
          background: var(--color-surface-secondary, #2a2a2a);
          font-size: 12px;
          font-weight: 600;
          color: var(--color-text-muted, #888);
          text-align: center;
        }

        .cap-header span:first-child {
          text-align: left;
        }

        .cap-row {
          border-top: 1px solid var(--color-border, #333);
          align-items: center;
        }

        .cap-name {
          font-size: 13px;
          color: var(--color-text, #fff);
        }

        .cap-btn {
          width: 32px;
          height: 32px;
          margin: 0 auto;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--color-surface-secondary, #2a2a2a);
          border: 1px solid var(--color-border, #333);
          border-radius: 6px;
          color: var(--color-text-muted, #888);
          font-size: 14px;
          cursor: pointer;
        }

        .cap-btn:hover {
          border-color: var(--color-text-muted, #888);
        }

        .cap-btn.active.allowed {
          background: rgba(34, 197, 94, 0.2);
          border-color: var(--color-success, #22c55e);
          color: var(--color-success, #22c55e);
        }

        .cap-btn.active.blocked {
          background: rgba(239, 68, 68, 0.2);
          border-color: var(--color-error, #ef4444);
          color: var(--color-error, #ef4444);
        }

        .review-section {
          margin-bottom: 24px;
          padding-bottom: 24px;
          border-bottom: 1px solid var(--color-border, #333);
        }

        .review-section:last-child {
          border-bottom: none;
        }

        .review-section h3 {
          margin: 0 0 12px;
          font-size: 14px;
          color: var(--color-text-secondary, #aaa);
        }

        .review-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          font-size: 13px;
          color: var(--color-text, #fff);
        }

        .review-grid strong {
          color: var(--color-text-muted, #888);
        }

        .review-description {
          margin: 12px 0 0;
          font-size: 13px;
          color: var(--color-text-secondary, #aaa);
        }

        .review-prompt {
          margin: 0;
          padding: 12px;
          background: var(--color-surface, #1e1e1e);
          border-radius: 6px;
          font-size: 12px;
          color: var(--color-text, #fff);
          white-space: pre-wrap;
        }

        .review-caps {
          font-size: 13px;
          color: var(--color-text, #fff);
        }

        .review-caps div {
          margin-bottom: 8px;
        }

        .review-caps strong {
          color: var(--color-text-muted, #888);
        }

        .builder-footer {
          display: flex;
          justify-content: space-between;
          padding: 16px 24px;
          border-top: 1px solid var(--color-border, #333);
        }

        .cancel-btn {
          padding: 10px 20px;
          background: none;
          border: 1px solid var(--color-border, #333);
          border-radius: 6px;
          color: var(--color-text-secondary, #aaa);
          font-size: 14px;
          cursor: pointer;
        }

        .cancel-btn:hover {
          border-color: var(--color-text-muted, #888);
        }

        .nav-buttons {
          display: flex;
          gap: 8px;
        }

        .back-btn,
        .next-btn {
          padding: 10px 20px;
          background: var(--color-surface, #1e1e1e);
          border: 1px solid var(--color-border, #333);
          border-radius: 6px;
          color: var(--color-text, #fff);
          font-size: 14px;
          cursor: pointer;
        }

        .back-btn:hover,
        .next-btn:hover {
          background: var(--color-surface-secondary, #2a2a2a);
        }

        .save-btn {
          padding: 10px 24px;
          background: var(--color-primary, #0ea5e9);
          border: none;
          border-radius: 6px;
          color: white;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
        }

        .save-btn:hover {
          background: var(--color-primary-hover, #0284c7);
        }

        .save-btn:disabled,
        .cancel-btn:disabled,
        .back-btn:disabled,
        .next-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
