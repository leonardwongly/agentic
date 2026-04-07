"use client";

import { useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import type { RiskClass, Capability, AgentDefinition } from "@agentic/contracts";

// Policy Playground: Test and simulate agent policies in a sandbox

export type PolicyRule = {
  id: string;
  name: string;
  description: string;
  type: "allow" | "deny" | "require-approval" | "limit" | "monitor";
  target: {
    agents?: string[];
    capabilities?: Capability[];
    riskClasses?: RiskClass[];
    tools?: string[];
  };
  conditions?: PolicyCondition[];
  action: PolicyAction;
  enabled: boolean;
  priority: number;
};

export type PolicyCondition = {
  field: string;
  operator: "equals" | "contains" | "greater" | "less" | "matches" | "in";
  value: string | number | string[];
};

export type PolicyAction = {
  type: "allow" | "deny" | "require-approval" | "rate-limit" | "notify" | "escalate";
  params?: Record<string, unknown>;
  message?: string;
};

export type SimulationScenario = {
  id: string;
  name: string;
  description: string;
  agentId: string;
  action: string;
  capability: Capability;
  riskClass: RiskClass;
  context: Record<string, unknown>;
};

export type SimulationResult = {
  scenarioId: string;
  outcome: "allowed" | "denied" | "requires-approval" | "rate-limited" | "error";
  matchedRules: PolicyRule[];
  executionPath: Array<{ ruleId: string; result: string; reason: string }>;
  recommendations?: string[];
};

export type PolicySet = {
  id: string;
  name: string;
  description: string;
  rules: PolicyRule[];
  version: number;
  createdAt: string;
  updatedAt: string;
};

// Policy rule builder
type PolicyRuleBuilderProps = {
  rule?: Partial<PolicyRule>;
  onChange: (rule: PolicyRule) => void;
  onCancel: () => void;
  agents: Array<{ id: string; name: string }>;
};

export function PolicyRuleBuilder({ rule, onChange, onCancel, agents }: PolicyRuleBuilderProps) {
  const [formData, setFormData] = useState<Partial<PolicyRule>>({
    id: rule?.id || `rule-${Date.now()}`,
    name: rule?.name || "",
    description: rule?.description || "",
    type: rule?.type || "allow",
    target: rule?.target || {},
    conditions: rule?.conditions || [],
    action: rule?.action || { type: "allow" },
    enabled: rule?.enabled ?? true,
    priority: rule?.priority ?? 50
  });

  const capabilities: Capability[] = ["read", "search", "create", "update", "draft", "send", "schedule", "monitor", "approve", "delete"];
  const riskClasses: RiskClass[] = ["R1", "R2", "R3", "R4"];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name?.trim()) return;

    onChange({
      id: formData.id!,
      name: formData.name!,
      description: formData.description || "",
      type: formData.type!,
      target: formData.target || {},
      conditions: formData.conditions || [],
      action: formData.action || { type: "allow" },
      enabled: formData.enabled ?? true,
      priority: formData.priority ?? 50
    });
  };

  const toggleCapability = (cap: Capability) => {
    const current = formData.target?.capabilities || [];
    const updated = current.includes(cap)
      ? current.filter(c => c !== cap)
      : [...current, cap];
    setFormData(prev => ({
      ...prev,
      target: { ...prev.target, capabilities: updated }
    }));
  };

  const toggleRiskClass = (risk: RiskClass) => {
    const current = formData.target?.riskClasses || [];
    const updated = current.includes(risk)
      ? current.filter(r => r !== risk)
      : [...current, risk];
    setFormData(prev => ({
      ...prev,
      target: { ...prev.target, riskClasses: updated }
    }));
  };

  return (
    <form onSubmit={handleSubmit} className="policy-rule-builder">
      <div className="policy-rule-builder-header">
        <h3>{rule?.id ? "Edit Rule" : "New Rule"}</h3>
        <button type="button" onClick={onCancel} className="policy-cancel-btn">
          ✕
        </button>
      </div>

      <div className="policy-rule-form">
        <div className="form-group">
          <label htmlFor="rule-name">Rule Name</label>
          <input
            id="rule-name"
            type="text"
            value={formData.name}
            onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
            placeholder="e.g., Require approval for R4 actions"
          />
        </div>

        <div className="form-group">
          <label htmlFor="rule-description">Description</label>
          <textarea
            id="rule-description"
            value={formData.description}
            onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
            placeholder="Describe what this rule does..."
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="rule-type">Rule Type</label>
            <select
              id="rule-type"
              value={formData.type}
              onChange={e => setFormData(prev => ({ ...prev, type: e.target.value as PolicyRule["type"] }))}
            >
              <option value="allow">Allow</option>
              <option value="deny">Deny</option>
              <option value="require-approval">Require Approval</option>
              <option value="limit">Rate Limit</option>
              <option value="monitor">Monitor Only</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="rule-priority">Priority (1-100)</label>
            <input
              id="rule-priority"
              type="number"
              min={1}
              max={100}
              value={formData.priority}
              onChange={e => setFormData(prev => ({ ...prev, priority: parseInt(e.target.value) || 50 }))}
            />
          </div>
        </div>

        <div className="form-group">
          <label>Target Capabilities</label>
          <div className="policy-chip-group">
            {capabilities.map(cap => (
              <button
                key={cap}
                type="button"
                className={`policy-chip ${formData.target?.capabilities?.includes(cap) ? "selected" : ""}`}
                onClick={() => toggleCapability(cap)}
              >
                {cap}
              </button>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label>Target Risk Classes</label>
          <div className="policy-chip-group">
            {riskClasses.map(risk => (
              <button
                key={risk}
                type="button"
                className={`policy-chip risk-${risk.toLowerCase()} ${formData.target?.riskClasses?.includes(risk) ? "selected" : ""}`}
                onClick={() => toggleRiskClass(risk)}
              >
                {risk}
              </button>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="rule-action-type">Action Type</label>
          <select
            id="rule-action-type"
            value={formData.action?.type}
            onChange={e => setFormData(prev => ({
              ...prev,
              action: { ...prev.action, type: e.target.value as PolicyAction["type"] }
            }))}
          >
            <option value="allow">Allow</option>
            <option value="deny">Deny</option>
            <option value="require-approval">Require Approval</option>
            <option value="rate-limit">Rate Limit</option>
            <option value="notify">Notify</option>
            <option value="escalate">Escalate</option>
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="rule-message">Action Message (optional)</label>
          <input
            id="rule-message"
            type="text"
            value={formData.action?.message || ""}
            onChange={e => setFormData(prev => ({
              ...prev,
              action: { type: prev.action?.type || "allow", ...prev.action, message: e.target.value }
            }))}
            placeholder="Message to show when rule triggers"
          />
        </div>

        <div className="form-group checkbox-group">
          <label>
            <input
              type="checkbox"
              checked={formData.enabled}
              onChange={e => setFormData(prev => ({ ...prev, enabled: e.target.checked }))}
            />
            Rule Enabled
          </label>
        </div>
      </div>

      <div className="policy-rule-builder-footer">
        <button type="button" onClick={onCancel} className="btn-secondary">
          Cancel
        </button>
        <button type="submit" className="btn-primary">
          {rule?.id ? "Update Rule" : "Create Rule"}
        </button>
      </div>
    </form>
  );
}

// Policy rule card
type PolicyRuleCardProps = {
  rule: PolicyRule;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
};

export function PolicyRuleCard({ rule, onEdit, onDelete, onToggle }: PolicyRuleCardProps) {
  const typeColors: Record<PolicyRule["type"], string> = {
    allow: "green",
    deny: "red",
    "require-approval": "yellow",
    limit: "blue",
    monitor: "gray"
  };

  return (
    <div className={`policy-rule-card ${rule.enabled ? "" : "disabled"}`}>
      <div className="policy-rule-card-header">
        <span className={`policy-rule-type policy-rule-type-${typeColors[rule.type]}`}>
          {rule.type}
        </span>
        <span className="policy-rule-priority">P{rule.priority}</span>
      </div>
      <h4 className="policy-rule-name">{rule.name}</h4>
      {rule.description && (
        <p className="policy-rule-description">{rule.description}</p>
      )}
      <div className="policy-rule-targets">
        {rule.target.capabilities?.map(cap => (
          <span key={cap} className="policy-target-chip">{cap}</span>
        ))}
        {rule.target.riskClasses?.map(risk => (
          <span key={risk} className={`policy-target-chip risk-${risk.toLowerCase()}`}>{risk}</span>
        ))}
      </div>
      <div className="policy-rule-actions">
        <button type="button" onClick={onToggle} className="btn-icon" title={rule.enabled ? "Disable" : "Enable"}>
          {rule.enabled ? "⏸️" : "▶️"}
        </button>
        <button type="button" onClick={onEdit} className="btn-icon" title="Edit">
          ✏️
        </button>
        <button type="button" onClick={onDelete} className="btn-icon btn-danger" title="Delete">
          🗑️
        </button>
      </div>
    </div>
  );
}

// Simulation scenario builder
type ScenarioBuilderProps = {
  agents: Array<{ id: string; name: string }>;
  onRun: (scenario: SimulationScenario) => void;
};

export function ScenarioBuilder({ agents, onRun }: ScenarioBuilderProps) {
  const [scenario, setScenario] = useState<Partial<SimulationScenario>>({
    id: `scenario-${Date.now()}`,
    name: "",
    agentId: agents[0]?.id || "",
    action: "",
    capability: "read",
    riskClass: "R2",
    context: {}
  });

  const capabilities: Capability[] = ["read", "search", "create", "update", "draft", "send", "schedule", "monitor", "approve", "delete"];
  const riskClasses: RiskClass[] = ["R1", "R2", "R3", "R4"];

  const handleRun = () => {
    if (!scenario.name || !scenario.agentId) return;
    onRun({
      id: scenario.id!,
      name: scenario.name!,
      description: scenario.description || "",
      agentId: scenario.agentId!,
      action: scenario.action || "execute",
      capability: scenario.capability!,
      riskClass: scenario.riskClass!,
      context: scenario.context || {}
    });
  };

  return (
    <div className="scenario-builder">
      <h4>Test Scenario</h4>
      
      <div className="form-group">
        <label htmlFor="scenario-name">Scenario Name</label>
        <input
          id="scenario-name"
          type="text"
          value={scenario.name}
          onChange={e => setScenario(prev => ({ ...prev, name: e.target.value }))}
          placeholder="e.g., Agent sends high-risk email"
        />
      </div>

      <div className="form-row">
        <div className="form-group">
          <label htmlFor="scenario-agent">Agent</label>
          <select
            id="scenario-agent"
            value={scenario.agentId}
            onChange={e => setScenario(prev => ({ ...prev, agentId: e.target.value }))}
          >
            {agents.map(agent => (
              <option key={agent.id} value={agent.id}>{agent.name}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="scenario-capability">Capability</label>
          <select
            id="scenario-capability"
            value={scenario.capability}
            onChange={e => setScenario(prev => ({ ...prev, capability: e.target.value as Capability }))}
          >
            {capabilities.map(cap => (
              <option key={cap} value={cap}>{cap}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="scenario-risk">Risk Class</label>
          <select
            id="scenario-risk"
            value={scenario.riskClass}
            onChange={e => setScenario(prev => ({ ...prev, riskClass: e.target.value as RiskClass }))}
          >
            {riskClasses.map(risk => (
              <option key={risk} value={risk}>{risk}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="scenario-action">Action Description</label>
        <input
          id="scenario-action"
          type="text"
          value={scenario.action}
          onChange={e => setScenario(prev => ({ ...prev, action: e.target.value }))}
          placeholder="e.g., Send email to external domain"
        />
      </div>

      <button type="button" onClick={handleRun} className="btn-primary" disabled={!scenario.name}>
        ▶️ Run Simulation
      </button>
    </div>
  );
}

// Simulation result display
type SimulationResultDisplayProps = {
  result: SimulationResult;
  onClose: () => void;
};

export function SimulationResultDisplay({ result, onClose }: SimulationResultDisplayProps) {
  const outcomeColors: Record<SimulationResult["outcome"], string> = {
    allowed: "green",
    denied: "red",
    "requires-approval": "yellow",
    "rate-limited": "blue",
    error: "red"
  };

  return (
    <div className="simulation-result">
      <div className="simulation-result-header">
        <h4>Simulation Result</h4>
        <button type="button" onClick={onClose} className="btn-icon">✕</button>
      </div>

      <div className={`simulation-outcome simulation-outcome-${outcomeColors[result.outcome]}`}>
        <span className="outcome-icon">
          {result.outcome === "allowed" && "✓"}
          {result.outcome === "denied" && "✗"}
          {result.outcome === "requires-approval" && "⏳"}
          {result.outcome === "rate-limited" && "⚡"}
          {result.outcome === "error" && "⚠️"}
        </span>
        <span className="outcome-text">{result.outcome.replace("-", " ")}</span>
      </div>

      {result.executionPath.length > 0 && (
        <div className="execution-path">
          <h5>Execution Path</h5>
          <div className="execution-steps">
            {result.executionPath.map((step, i) => (
              <div key={i} className={`execution-step execution-step-${step.result}`}>
                <span className="step-number">{i + 1}</span>
                <span className="step-rule">{step.ruleId}</span>
                <span className="step-result">{step.result}</span>
                <span className="step-reason">{step.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.matchedRules.length > 0 && (
        <div className="matched-rules">
          <h5>Matched Rules</h5>
          <ul>
            {result.matchedRules.map(rule => (
              <li key={rule.id}>{rule.name} ({rule.type})</li>
            ))}
          </ul>
        </div>
      )}

      {result.recommendations && result.recommendations.length > 0 && (
        <div className="simulation-recommendations">
          <h5>Recommendations</h5>
          <ul>
            {result.recommendations.map((rec, i) => (
              <li key={i}>{rec}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Main policy playground component
type PolicyPlaygroundProps = {
  initialPolicies?: PolicyRule[];
  agents: Array<{ id: string; name: string }>;
  onSave?: (policies: PolicyRule[]) => void;
  className?: string;
};

export function PolicyPlayground({ initialPolicies = [], agents, onSave, className = "" }: PolicyPlaygroundProps) {
  const [policies, setPolicies] = useState<PolicyRule[]>(initialPolicies);
  const [editingRule, setEditingRule] = useState<PolicyRule | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  const [activeTab, setActiveTab] = useState<"rules" | "simulate" | "history">("rules");

  const handleCreateRule = (rule: PolicyRule) => {
    setPolicies(prev => [...prev, rule]);
    setIsCreating(false);
  };

  const handleUpdateRule = (rule: PolicyRule) => {
    setPolicies(prev => prev.map(p => p.id === rule.id ? rule : p));
    setEditingRule(null);
  };

  const handleDeleteRule = (id: string) => {
    setPolicies(prev => prev.filter(p => p.id !== id));
  };

  const handleToggleRule = (id: string) => {
    setPolicies(prev => prev.map(p => 
      p.id === id ? { ...p, enabled: !p.enabled } : p
    ));
  };

  const runSimulation = (scenario: SimulationScenario): SimulationResult => {
    const enabledPolicies = policies.filter(p => p.enabled).sort((a, b) => b.priority - a.priority);
    const executionPath: SimulationResult["executionPath"] = [];
    const matchedRules: PolicyRule[] = [];

    let finalOutcome = "allowed" as SimulationResult["outcome"];

    for (const policy of enabledPolicies) {
      const capabilityMatch = !policy.target.capabilities?.length || 
        policy.target.capabilities.includes(scenario.capability);
      const riskMatch = !policy.target.riskClasses?.length || 
        policy.target.riskClasses.includes(scenario.riskClass);
      const agentMatch = !policy.target.agents?.length || 
        policy.target.agents.includes(scenario.agentId);

      if (capabilityMatch && riskMatch && agentMatch) {
        matchedRules.push(policy);
        
        let stepResult: string;
        let stepReason: string;

        switch (policy.action.type) {
          case "deny":
            finalOutcome = "denied";
            stepResult = "blocked";
            stepReason = policy.action.message || "Action denied by policy";
            break;
          case "require-approval":
            if (finalOutcome !== "denied") {
              finalOutcome = "requires-approval";
            }
            stepResult = "approval-required";
            stepReason = policy.action.message || "Approval required before proceeding";
            break;
          case "rate-limit":
            if (finalOutcome === "allowed") {
              finalOutcome = "rate-limited";
            }
            stepResult = "limited";
            stepReason = "Rate limit applied";
            break;
          case "allow":
            stepResult = "passed";
            stepReason = "Allowed by policy";
            break;
          default:
            stepResult = "monitored";
            stepReason = "Logged for monitoring";
        }

        executionPath.push({
          ruleId: policy.id,
          result: stepResult,
          reason: stepReason
        });

        if (finalOutcome === "denied") break;
      }
    }

    const recommendations: string[] = [];
    if (finalOutcome === "denied") {
      recommendations.push("Consider requesting an exception for this action");
      recommendations.push("Review the blocking policy with your administrator");
    }
    if (matchedRules.length === 0) {
      recommendations.push("No policies matched. Consider adding rules for this scenario.");
    }

    return {
      scenarioId: scenario.id,
      outcome: finalOutcome,
      matchedRules,
      executionPath,
      recommendations
    };
  };

  const handleRunSimulation = (scenario: SimulationScenario) => {
    const result = runSimulation(scenario);
    setSimulationResult(result);
  };

  const handleSave = () => {
    onSave?.(policies);
  };

  return (
    <div className={`policy-playground ${className}`}>
      <div className="policy-playground-header">
        <h3>Policy Playground</h3>
        <div className="policy-playground-tabs">
          <button
            type="button"
            className={`tab ${activeTab === "rules" ? "active" : ""}`}
            onClick={() => setActiveTab("rules")}
          >
            Rules ({policies.length})
          </button>
          <button
            type="button"
            className={`tab ${activeTab === "simulate" ? "active" : ""}`}
            onClick={() => setActiveTab("simulate")}
          >
            Simulate
          </button>
          <button
            type="button"
            className={`tab ${activeTab === "history" ? "active" : ""}`}
            onClick={() => setActiveTab("history")}
          >
            History
          </button>
        </div>
        {onSave && (
          <button type="button" onClick={handleSave} className="btn-primary">
            Save Policies
          </button>
        )}
      </div>

      <div className="policy-playground-content">
        {activeTab === "rules" && (
          <div className="policy-rules-tab">
            {(isCreating || editingRule) ? (
              <PolicyRuleBuilder
                rule={editingRule || undefined}
                onChange={editingRule ? handleUpdateRule : handleCreateRule}
                onCancel={() => {
                  setIsCreating(false);
                  setEditingRule(null);
                }}
                agents={agents}
              />
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setIsCreating(true)}
                  className="btn-primary add-rule-btn"
                >
                  + Add Rule
                </button>
                
                <div className="policy-rules-list">
                  {policies.length === 0 ? (
                    <div className="policy-empty">
                      <p>No policies defined yet.</p>
                      <p>Create your first rule to control agent behavior.</p>
                    </div>
                  ) : (
                    policies.map(rule => (
                      <PolicyRuleCard
                        key={rule.id}
                        rule={rule}
                        onEdit={() => setEditingRule(rule)}
                        onDelete={() => handleDeleteRule(rule.id)}
                        onToggle={() => handleToggleRule(rule.id)}
                      />
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === "simulate" && (
          <div className="policy-simulate-tab">
            <ScenarioBuilder agents={agents} onRun={handleRunSimulation} />
            
            {simulationResult && (
              <SimulationResultDisplay
                result={simulationResult}
                onClose={() => setSimulationResult(null)}
              />
            )}
          </div>
        )}

        {activeTab === "history" && (
          <div className="policy-history-tab">
            <p className="policy-history-placeholder">
              Simulation history will appear here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// Hook for policy management
export function usePolicyPlayground(initialPolicies: PolicyRule[] = []) {
  const [policies, setPolicies] = useState<PolicyRule[]>(initialPolicies);

  const addRule = useCallback((rule: PolicyRule) => {
    setPolicies(prev => [...prev, rule]);
  }, []);

  const updateRule = useCallback((rule: PolicyRule) => {
    setPolicies(prev => prev.map(p => p.id === rule.id ? rule : p));
  }, []);

  const deleteRule = useCallback((id: string) => {
    setPolicies(prev => prev.filter(p => p.id !== id));
  }, []);

  const toggleRule = useCallback((id: string) => {
    setPolicies(prev => prev.map(p => 
      p.id === id ? { ...p, enabled: !p.enabled } : p
    ));
  }, []);

  const evaluate = useCallback((
    capability: Capability,
    riskClass: RiskClass,
    agentId?: string
  ): { allowed: boolean; requiresApproval: boolean; matchedRules: PolicyRule[] } => {
    const enabledPolicies = policies.filter(p => p.enabled).sort((a, b) => b.priority - a.priority);
    const matchedRules: PolicyRule[] = [];
    let allowed = true;
    let requiresApproval = false;

    for (const policy of enabledPolicies) {
      const capabilityMatch = !policy.target.capabilities?.length || 
        policy.target.capabilities.includes(capability);
      const riskMatch = !policy.target.riskClasses?.length || 
        policy.target.riskClasses.includes(riskClass);
      const agentMatch = !policy.target.agents?.length || 
        (agentId && policy.target.agents.includes(agentId));

      if (capabilityMatch && riskMatch && agentMatch) {
        matchedRules.push(policy);
        
        if (policy.action.type === "deny") {
          allowed = false;
          break;
        }
        if (policy.action.type === "require-approval") {
          requiresApproval = true;
        }
      }
    }

    return { allowed, requiresApproval, matchedRules };
  }, [policies]);

  return {
    policies,
    addRule,
    updateRule,
    deleteRule,
    toggleRule,
    evaluate,
    setPolicies
  };
}
