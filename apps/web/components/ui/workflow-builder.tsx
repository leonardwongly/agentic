"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import type { AgentDefinition } from "@agentic/contracts";

// Workflow Builder - Visual multi-agent workflow editor
// Drag-and-drop pipeline builder with agents as nodes

export type WorkflowNode = {
  id: string;
  type: "agent" | "trigger" | "condition" | "action" | "output";
  agentId?: string;
  label: string;
  icon: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
};

export type WorkflowEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  condition?: string;
};

export type WorkflowDefinition = {
  id: string;
  name: string;
  description: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  triggers: Array<{ type: string; config: Record<string, unknown> }>;
  createdAt: string;
  updatedAt: string;
};

type WorkflowBuilderProps = {
  workflow?: WorkflowDefinition;
  agents: AgentDefinition[];
  onSave: (workflow: WorkflowDefinition) => Promise<void>;
  onCancel: () => void;
  className?: string;
};

export function WorkflowBuilder({
  workflow,
  agents,
  onSave,
  onCancel,
  className = ""
}: WorkflowBuilderProps) {
  const [name, setName] = useState(workflow?.name ?? "");
  const [description, setDescription] = useState(workflow?.description ?? "");
  const [nodes, setNodes] = useState<WorkflowNode[]>(workflow?.nodes ?? []);
  const [edges, setEdges] = useState<WorkflowEdge[]>(workflow?.edges ?? []);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragNode, setDragNode] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  const nodeTypes = [
    { type: "trigger", label: "Trigger", icon: "⚡", description: "Start workflow" },
    { type: "agent", label: "Agent", icon: "🤖", description: "Run an agent" },
    { type: "condition", label: "Condition", icon: "🔀", description: "Branch logic" },
    { type: "action", label: "Action", icon: "⚙️", description: "Custom action" },
    { type: "output", label: "Output", icon: "📤", description: "End with result" }
  ];

  const addNode = useCallback((type: string, agentId?: string) => {
    const agent = agentId ? agents.find(a => a.id === agentId) : null;
    const nodeType = nodeTypes.find(t => t.type === type);
    
    const newNode: WorkflowNode = {
      id: `node-${Date.now()}`,
      type: type as WorkflowNode["type"],
      agentId,
      label: agent?.displayName ?? nodeType?.label ?? type,
      icon: agent?.icon ?? nodeType?.icon ?? "📦",
      position: {
        x: 100 + Math.random() * 200,
        y: 100 + Math.random() * 200
      },
      config: {}
    };

    setNodes(prev => [...prev, newNode]);
    setSelectedNode(newNode.id);
  }, [agents]);

  const removeNode = useCallback((nodeId: string) => {
    setNodes(prev => prev.filter(n => n.id !== nodeId));
    setEdges(prev => prev.filter(e => e.source !== nodeId && e.target !== nodeId));
    if (selectedNode === nodeId) setSelectedNode(null);
  }, [selectedNode]);

  const addEdge = useCallback((source: string, target: string) => {
    // Prevent self-loops and duplicates
    if (source === target) return;
    if (edges.some(e => e.source === source && e.target === target)) return;

    const newEdge: WorkflowEdge = {
      id: `edge-${Date.now()}`,
      source,
      target
    };

    setEdges(prev => [...prev, newEdge]);
  }, [edges]);

  const removeEdge = useCallback((edgeId: string) => {
    setEdges(prev => prev.filter(e => e.id !== edgeId));
  }, []);

  const updateNodePosition = useCallback((nodeId: string, position: { x: number; y: number }) => {
    setNodes(prev => prev.map(n => 
      n.id === nodeId ? { ...n, position } : n
    ));
  }, []);

  const updateNodeConfig = useCallback((nodeId: string, config: Record<string, unknown>) => {
    setNodes(prev => prev.map(n => 
      n.id === nodeId ? { ...n, config: { ...n.config, ...config } } : n
    ));
  }, []);

  const handleSave = async () => {
    if (!name.trim()) return;
    
    setIsSaving(true);
    try {
      await onSave({
        id: workflow?.id ?? `workflow-${Date.now()}`,
        name: name.trim(),
        description: description.trim(),
        nodes,
        edges,
        triggers: nodes.filter(n => n.type === "trigger").map(n => ({
          type: (n.config.triggerType as string) ?? "manual",
          config: n.config
        })),
        createdAt: workflow?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    } finally {
      setIsSaving(false);
    }
  };

  const selectedNodeData = useMemo(() => {
    return nodes.find(n => n.id === selectedNode);
  }, [nodes, selectedNode]);

  return (
    <div className={`workflow-builder ${className}`}>
      <div className="workflow-builder-header">
        <div className="workflow-builder-info">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Workflow name..."
            className="workflow-builder-name"
          />
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description..."
            className="workflow-builder-description"
          />
        </div>
        <div className="workflow-builder-actions">
          <button type="button" className="workflow-builder-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button 
            type="button" 
            className="workflow-builder-save"
            onClick={handleSave}
            disabled={!name.trim() || isSaving}
          >
            {isSaving ? "Saving..." : "Save Workflow"}
          </button>
        </div>
      </div>

      <div className="workflow-builder-main">
        {/* Node palette */}
        <div className="workflow-builder-palette">
          <h4>Components</h4>
          {nodeTypes.map(type => (
            <button
              key={type.type}
              type="button"
              className="workflow-palette-item"
              onClick={() => addNode(type.type)}
            >
              <span className="workflow-palette-icon">{type.icon}</span>
              <span className="workflow-palette-label">{type.label}</span>
            </button>
          ))}

          <h4>Agents</h4>
          <div className="workflow-palette-agents">
            {agents.filter(a => a.status === "active").map(agent => (
              <button
                key={agent.id}
                type="button"
                className="workflow-palette-item agent"
                onClick={() => addNode("agent", agent.id)}
              >
                <span className="workflow-palette-icon">{agent.icon}</span>
                <span className="workflow-palette-label">{agent.displayName}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Canvas */}
        <div 
          ref={canvasRef}
          className="workflow-builder-canvas"
          onClick={() => setSelectedNode(null)}
        >
          {/* Render edges */}
          <svg className="workflow-edges">
            {edges.map(edge => {
              const sourceNode = nodes.find(n => n.id === edge.source);
              const targetNode = nodes.find(n => n.id === edge.target);
              if (!sourceNode || !targetNode) return null;

              return (
                <WorkflowEdgeComponent
                  key={edge.id}
                  edge={edge}
                  sourcePos={sourceNode.position}
                  targetPos={targetNode.position}
                  onRemove={() => removeEdge(edge.id)}
                />
              );
            })}
          </svg>

          {/* Render nodes */}
          {nodes.map(node => (
            <WorkflowNodeComponent
              key={node.id}
              node={node}
              isSelected={selectedNode === node.id}
              onClick={() => setSelectedNode(node.id)}
              onDrag={(pos) => updateNodePosition(node.id, pos)}
              onConnect={(targetId) => addEdge(node.id, targetId)}
              onRemove={() => removeNode(node.id)}
            />
          ))}

          {nodes.length === 0 && (
            <div className="workflow-canvas-empty">
              <span className="workflow-canvas-empty-icon">🔧</span>
              <span>Add components from the palette to start building</span>
            </div>
          )}
        </div>

        {/* Node config panel */}
        <div className={`workflow-builder-config ${selectedNodeData ? "visible" : ""}`}>
          {selectedNodeData && (
            <NodeConfigPanel
              node={selectedNodeData}
              agents={agents}
              onUpdate={(config) => updateNodeConfig(selectedNodeData.id, config)}
              onClose={() => setSelectedNode(null)}
            />
          )}
        </div>
      </div>

      {/* Status bar */}
      <div className="workflow-builder-status">
        <span>{nodes.length} node{nodes.length !== 1 ? "s" : ""}</span>
        <span>•</span>
        <span>{edges.length} connection{edges.length !== 1 ? "s" : ""}</span>
        {selectedNodeData && (
          <>
            <span>•</span>
            <span>Selected: {selectedNodeData.label}</span>
          </>
        )}
      </div>
    </div>
  );
}

type WorkflowNodeComponentProps = {
  node: WorkflowNode;
  isSelected: boolean;
  onClick: () => void;
  onDrag: (pos: { x: number; y: number }) => void;
  onConnect: (targetId: string) => void;
  onRemove: () => void;
};

function WorkflowNodeComponent({
  node,
  isSelected,
  onClick,
  onDrag,
  onRemove
}: WorkflowNodeComponentProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDragging(true);
    setDragStart({ x: e.clientX - node.position.x, y: e.clientY - node.position.y });
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      onDrag({
        x: Math.max(0, e.clientX - dragStart.x),
        y: Math.max(0, e.clientY - dragStart.y)
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, dragStart, onDrag]);

  return (
    <div
      className={`workflow-node ${node.type} ${isSelected ? "selected" : ""} ${isDragging ? "dragging" : ""}`}
      style={{
        transform: `translate(${node.position.x}px, ${node.position.y}px)`
      }}
      onMouseDown={handleMouseDown}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <div className="workflow-node-header">
        <span className="workflow-node-icon">{node.icon}</span>
        <span className="workflow-node-label">{node.label}</span>
        <button 
          type="button" 
          className="workflow-node-remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ✕
        </button>
      </div>
      <div className="workflow-node-type">{node.type}</div>
      
      {/* Connection points */}
      <div className="workflow-node-port input" />
      <div className="workflow-node-port output" />
    </div>
  );
}

type WorkflowEdgeComponentProps = {
  edge: WorkflowEdge;
  sourcePos: { x: number; y: number };
  targetPos: { x: number; y: number };
  onRemove: () => void;
};

function WorkflowEdgeComponent({
  edge,
  sourcePos,
  targetPos,
  onRemove
}: WorkflowEdgeComponentProps) {
  // Calculate bezier curve
  const sourceX = sourcePos.x + 80; // Right side of source node
  const sourceY = sourcePos.y + 25;  // Center of source node
  const targetX = targetPos.x;        // Left side of target node
  const targetY = targetPos.y + 25;   // Center of target node

  const midX = (sourceX + targetX) / 2;
  
  const path = `M ${sourceX} ${sourceY} C ${midX} ${sourceY}, ${midX} ${targetY}, ${targetX} ${targetY}`;

  return (
    <g className="workflow-edge-group">
      {/* Invisible wider path for easier clicking */}
      <path
        d={path}
        className="workflow-edge-hitbox"
        onClick={onRemove}
      />
      <path
        d={path}
        className="workflow-edge"
        markerEnd="url(#arrowhead)"
      />
      {edge.label && (
        <text
          x={midX}
          y={(sourceY + targetY) / 2 - 5}
          className="workflow-edge-label"
        >
          {edge.label}
        </text>
      )}
      <defs>
        <marker
          id="arrowhead"
          markerWidth="10"
          markerHeight="7"
          refX="9"
          refY="3.5"
          orient="auto"
        >
          <polygon points="0 0, 10 3.5, 0 7" fill="var(--muted)" />
        </marker>
      </defs>
    </g>
  );
}

type NodeConfigPanelProps = {
  node: WorkflowNode;
  agents: AgentDefinition[];
  onUpdate: (config: Record<string, unknown>) => void;
  onClose: () => void;
};

function NodeConfigPanel({ node, agents, onUpdate, onClose }: NodeConfigPanelProps) {
  const agent = node.agentId ? agents.find(a => a.id === node.agentId) : null;

  return (
    <div className="node-config-panel">
      <div className="node-config-header">
        <span className="node-config-icon">{node.icon}</span>
        <span className="node-config-title">{node.label}</span>
        <button type="button" className="node-config-close" onClick={onClose}>✕</button>
      </div>

      <div className="node-config-content">
        {node.type === "trigger" && (
          <div className="node-config-field">
            <label>Trigger Type</label>
            <select
              value={(node.config.triggerType as string) ?? "manual"}
              onChange={(e) => onUpdate({ triggerType: e.target.value })}
            >
              <option value="manual">Manual</option>
              <option value="schedule">Scheduled</option>
              <option value="webhook">Webhook</option>
              <option value="event">Event</option>
            </select>
          </div>
        )}

        {node.type === "agent" && agent && (
          <>
            <div className="node-config-agent-info">
              <p>{agent.description}</p>
              <div className="node-config-agent-caps">
                {agent.allowedCapabilities.slice(0, 3).map(cap => (
                  <span key={cap} className="node-config-cap">{cap}</span>
                ))}
              </div>
            </div>
            <div className="node-config-field">
              <label>Input Mapping</label>
              <textarea
                value={(node.config.inputMapping as string) ?? ""}
                onChange={(e) => onUpdate({ inputMapping: e.target.value })}
                placeholder="Map workflow data to agent input..."
                rows={3}
              />
            </div>
          </>
        )}

        {node.type === "condition" && (
          <div className="node-config-field">
            <label>Condition Expression</label>
            <textarea
              value={(node.config.condition as string) ?? ""}
              onChange={(e) => onUpdate({ condition: e.target.value })}
              placeholder="e.g., result.status === 'success'"
              rows={3}
            />
          </div>
        )}

        {node.type === "action" && (
          <>
            <div className="node-config-field">
              <label>Action Type</label>
              <select
                value={(node.config.actionType as string) ?? "http"}
                onChange={(e) => onUpdate({ actionType: e.target.value })}
              >
                <option value="http">HTTP Request</option>
                <option value="email">Send Email</option>
                <option value="slack">Slack Message</option>
                <option value="log">Log Output</option>
              </select>
            </div>
            <div className="node-config-field">
              <label>Configuration</label>
              <textarea
                value={(node.config.actionConfig as string) ?? ""}
                onChange={(e) => onUpdate({ actionConfig: e.target.value })}
                placeholder="Action configuration..."
                rows={4}
              />
            </div>
          </>
        )}

        {node.type === "output" && (
          <div className="node-config-field">
            <label>Output Format</label>
            <select
              value={(node.config.outputFormat as string) ?? "json"}
              onChange={(e) => onUpdate({ outputFormat: e.target.value })}
            >
              <option value="json">JSON</option>
              <option value="text">Plain Text</option>
              <option value="markdown">Markdown</option>
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

// Hook for managing workflow state
export function useWorkflowBuilder() {
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowDefinition | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const createWorkflow = useCallback(() => {
    setActiveWorkflow(null);
    setIsEditing(true);
  }, []);

  const editWorkflow = useCallback((workflow: WorkflowDefinition) => {
    setActiveWorkflow(workflow);
    setIsEditing(true);
  }, []);

  const saveWorkflow = useCallback(async (workflow: WorkflowDefinition) => {
    setWorkflows(prev => {
      const existing = prev.findIndex(w => w.id === workflow.id);
      if (existing >= 0) {
        const next = [...prev];
        next[existing] = workflow;
        return next;
      }
      return [...prev, workflow];
    });
    setIsEditing(false);
    setActiveWorkflow(null);
  }, []);

  const deleteWorkflow = useCallback((id: string) => {
    setWorkflows(prev => prev.filter(w => w.id !== id));
    if (activeWorkflow?.id === id) {
      setActiveWorkflow(null);
      setIsEditing(false);
    }
  }, [activeWorkflow]);

  const cancelEdit = useCallback(() => {
    setIsEditing(false);
    setActiveWorkflow(null);
  }, []);

  return {
    workflows,
    activeWorkflow,
    isEditing,
    createWorkflow,
    editWorkflow,
    saveWorkflow,
    deleteWorkflow,
    cancelEdit
  };
}
