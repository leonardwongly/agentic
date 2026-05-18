"use client";

import { useState } from "react";
import type {
  AgentDefinition,
  Capability,
  RiskClass
} from "@agentic/contracts";

type AgentPermissionsEditorProps = {
  agent: AgentDefinition;
  onSave: (permissions: {
    allowedCapabilities: Capability[];
    blockedCapabilities: Capability[];
    maxRiskClass: RiskClass;
  }) => Promise<void>;
  onCancel: () => void;
  isPending?: boolean;
};

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

const capabilityDescriptions: Record<Capability, string> = {
  read: "Read data from integrations and memory",
  search: "Search across data sources",
  create: "Create new records and entities",
  update: "Modify existing data",
  draft: "Create draft content for review",
  send: "Send messages and notifications",
  schedule: "Schedule future actions",
  monitor: "Set up monitoring and watchers",
  approve: "Make approval decisions",
  delete: "Delete data permanently"
};

const riskClasses: RiskClass[] = ["R1", "R2", "R3", "R4"];

const riskDescriptions: Record<RiskClass, string> = {
  R1: "No approval needed - fully autonomous",
  R2: "User confirmation required for actions",
  R3: "Multi-step approval workflow",
  R4: "Admin-only with audit trail"
};

export function AgentPermissionsEditor({
  agent,
  onSave,
  onCancel,
  isPending
}: AgentPermissionsEditorProps) {
  const [allowedCaps, setAllowedCaps] = useState<Capability[]>(agent.allowedCapabilities);
  const [blockedCaps, setBlockedCaps] = useState<Capability[]>(agent.blockedCapabilities);
  const [maxRisk, setMaxRisk] = useState<RiskClass>(agent.maxRiskClass);
  const [error, setError] = useState<string | null>(null);

  const toggleCapability = (cap: Capability, list: "allowed" | "blocked") => {
    if (list === "allowed") {
      if (allowedCaps.includes(cap)) {
        setAllowedCaps(allowedCaps.filter((c) => c !== cap));
      } else {
        setAllowedCaps([...allowedCaps, cap]);
        setBlockedCaps(blockedCaps.filter((c) => c !== cap));
      }
    } else {
      if (blockedCaps.includes(cap)) {
        setBlockedCaps(blockedCaps.filter((c) => c !== cap));
      } else {
        setBlockedCaps([...blockedCaps, cap]);
        setAllowedCaps(allowedCaps.filter((c) => c !== cap));
      }
    }
  };

  const handleSave = async () => {
    try {
      setError(null);
      await onSave({
        allowedCapabilities: allowedCaps,
        blockedCapabilities: blockedCaps,
        maxRiskClass: maxRisk
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save permissions");
    }
  };

  return (
    <div className="permissions-editor">
      <div className="editor-header">
        <h2>Edit Permissions: {agent.displayName}</h2>
        <button type="button" className="close-btn" onClick={onCancel}>×</button>
      </div>

      {error && <div className="editor-error">{error}</div>}

      <div className="editor-content">
        <section className="editor-section">
          <h3>Capabilities</h3>
          <p className="section-description">
            Control what actions this agent can perform. Unspecified capabilities follow the system default.
          </p>

          <div className="capabilities-matrix">
            <div className="matrix-header">
              <span>Capability</span>
              <span>Description</span>
              <span>Allowed</span>
              <span>Blocked</span>
            </div>
            {allCapabilities.map((cap) => (
              <div key={cap} className="matrix-row">
                <span className="cap-name">{cap}</span>
                <span className="cap-desc">{capabilityDescriptions[cap]}</span>
                <button
                  type="button"
                  className={`toggle-btn ${allowedCaps.includes(cap) ? "active allowed" : ""}`}
                  onClick={() => toggleCapability(cap, "allowed")}
                >
                  ✓
                </button>
                <button
                  type="button"
                  className={`toggle-btn ${blockedCaps.includes(cap) ? "active blocked" : ""}`}
                  onClick={() => toggleCapability(cap, "blocked")}
                >
                  ✗
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="editor-section">
          <h3>Risk Level</h3>
          <p className="section-description">
            Set the maximum risk class for actions this agent can take.
          </p>

          <div className="risk-options">
            {riskClasses.map((risk) => (
              <label key={risk} className={`risk-option ${maxRisk === risk ? "selected" : ""}`}>
                <input
                  type="radio"
                  name="risk"
                  checked={maxRisk === risk}
                  onChange={() => setMaxRisk(risk)}
                />
                <div className="risk-content">
                  <span className="risk-label">{risk}</span>
                  <span className="risk-desc">{riskDescriptions[risk]}</span>
                </div>
              </label>
            ))}
          </div>
        </section>

      </div>

      <div className="editor-footer">
        <button type="button" className="cancel-btn" onClick={onCancel} disabled={isPending}>
          Cancel
        </button>
        <button type="button" className="save-btn" onClick={handleSave} disabled={isPending}>
          {isPending ? "Saving..." : "Save Permissions"}
        </button>
      </div>

      <style jsx>{`
        .permissions-editor {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: var(--color-background, #121212);
        }

        .editor-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 24px;
          border-bottom: 1px solid var(--color-border, #333);
        }

        .editor-header h2 {
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
        }

        .editor-error {
          margin: 16px 24px 0;
          padding: 12px 16px;
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid var(--color-error, #ef4444);
          border-radius: 8px;
          color: var(--color-error, #ef4444);
          font-size: 13px;
        }

        .editor-content {
          flex: 1;
          overflow-y: auto;
          padding: 24px;
        }

        .editor-section {
          margin-bottom: 32px;
        }

        .editor-section h3 {
          margin: 0 0 8px;
          font-size: 16px;
          color: var(--color-text, #fff);
        }

        .section-description {
          margin: 0 0 16px;
          font-size: 13px;
          color: var(--color-text-muted, #888);
        }

        .capabilities-matrix {
          background: var(--color-surface, #1e1e1e);
          border: 1px solid var(--color-border, #333);
          border-radius: 8px;
          overflow: hidden;
        }

        .matrix-header,
        .matrix-row {
          display: grid;
          grid-template-columns: 100px 1fr 70px 70px;
          padding: 12px 16px;
          align-items: center;
        }

        .matrix-header {
          background: var(--color-surface-secondary, #2a2a2a);
          font-size: 11px;
          font-weight: 600;
          color: var(--color-text-muted, #888);
          text-transform: uppercase;
        }

        .matrix-row {
          border-top: 1px solid var(--color-border, #333);
        }

        .cap-name {
          font-size: 13px;
          font-weight: 500;
          color: var(--color-text, #fff);
        }

        .cap-desc {
          font-size: 12px;
          color: var(--color-text-muted, #888);
        }

        .toggle-btn {
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

        .toggle-btn:hover {
          border-color: var(--color-text-muted, #888);
        }

        .toggle-btn.active.allowed {
          background: rgba(34, 197, 94, 0.2);
          border-color: var(--color-success, #22c55e);
          color: var(--color-success, #22c55e);
        }

        .toggle-btn.active.blocked {
          background: rgba(239, 68, 68, 0.2);
          border-color: var(--color-error, #ef4444);
          color: var(--color-error, #ef4444);
        }

        .risk-options {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .risk-option {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          background: var(--color-surface, #1e1e1e);
          border: 1px solid var(--color-border, #333);
          border-radius: 8px;
          cursor: pointer;
          transition: border-color 0.2s;
        }

        .risk-option:hover {
          border-color: var(--color-text-muted, #888);
        }

        .risk-option.selected {
          border-color: var(--color-primary, #0ea5e9);
          background: rgba(14, 165, 233, 0.1);
        }

        .risk-option input {
          display: none;
        }

        .risk-content {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .risk-label {
          font-size: 14px;
          font-weight: 500;
          color: var(--color-text, #fff);
        }

        .risk-desc {
          font-size: 12px;
          color: var(--color-text-muted, #888);
        }

        .editor-footer {
          display: flex;
          justify-content: flex-end;
          gap: 12px;
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
        .cancel-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
