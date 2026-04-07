"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import type { MemoryRecord } from "@agentic/contracts";

// Agent-scoped memory viewer and editor
// Shows memories associated with a specific agent

type AgentMemoryProps = {
  agentId: string;
  agentName: string;
  memories: MemoryRecord[];
  onAddMemory?: (memory: Partial<MemoryRecord>) => Promise<void>;
  onDeleteMemory?: (id: string) => Promise<void>;
  onUpdateMemory?: (id: string, updates: Partial<MemoryRecord>) => Promise<void>;
  className?: string;
};

export function AgentMemory({
  agentId,
  agentName,
  memories,
  onAddMemory,
  onDeleteMemory,
  onUpdateMemory,
  className = ""
}: AgentMemoryProps) {
  const [activeTab, setActiveTab] = useState<"episodic" | "semantic" | "procedural" | "working">("episodic");
  const [isAdding, setIsAdding] = useState(false);
  const [newMemoryContent, setNewMemoryContent] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Filter memories by agent
  const agentMemories = useMemo(() => {
    return memories.filter(m => 
      (m as MemoryRecord & { agentId?: string }).agentId === agentId ||
      m.content.toLowerCase().includes(agentName.toLowerCase())
    );
  }, [memories, agentId, agentName]);

  // Group by memory type (using category as proxy)
  const groupedMemories = useMemo(() => {
    const groups = {
      episodic: [] as MemoryRecord[],    // Past interactions and events
      semantic: [] as MemoryRecord[],    // Facts and knowledge
      procedural: [] as MemoryRecord[],  // How-to and procedures
      working: [] as MemoryRecord[]      // Temporary/recent context
    };

    for (const memory of agentMemories) {
      // Map categories to memory types
      if (memory.category === "history" || memory.category === "past-event") {
        groups.episodic.push(memory);
      } else if (memory.category === "preference" || memory.category === "fact") {
        groups.semantic.push(memory);
      } else if (memory.category === "workflow" || memory.category === "process") {
        groups.procedural.push(memory);
      } else {
        groups.working.push(memory);
      }
    }

    return groups;
  }, [agentMemories]);

  // Filter by search
  const filteredMemories = useMemo(() => {
    const memories = groupedMemories[activeTab];
    if (!searchQuery) return memories;
    const query = searchQuery.toLowerCase();
    return memories.filter(m => 
      m.content.toLowerCase().includes(query) ||
      m.category.toLowerCase().includes(query)
    );
  }, [groupedMemories, activeTab, searchQuery]);

  const handleAddMemory = async () => {
    if (!newMemoryContent.trim() || !onAddMemory) return;
    
    await onAddMemory({
      content: newMemoryContent.trim(),
      category: activeTab === "episodic" ? "history" :
               activeTab === "semantic" ? "preference" :
               activeTab === "procedural" ? "workflow" : "working-style"
    });
    
    setNewMemoryContent("");
    setIsAdding(false);
  };

  const tabCounts = {
    episodic: groupedMemories.episodic.length,
    semantic: groupedMemories.semantic.length,
    procedural: groupedMemories.procedural.length,
    working: groupedMemories.working.length
  };

  return (
    <div className={`agent-memory ${className}`}>
      <div className="agent-memory-header">
        <h3 className="agent-memory-title">
          🧠 {agentName} Memory
        </h3>
        <span className="agent-memory-count">{agentMemories.length} memories</span>
      </div>

      <div className="agent-memory-tabs">
        {(["episodic", "semantic", "procedural", "working"] as const).map(tab => (
          <button
            key={tab}
            type="button"
            className={`agent-memory-tab ${activeTab === tab ? "active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === "episodic" && "📅"}
            {tab === "semantic" && "📚"}
            {tab === "procedural" && "⚙️"}
            {tab === "working" && "💭"}
            <span className="agent-memory-tab-label">{tab.charAt(0).toUpperCase() + tab.slice(1)}</span>
            <span className="agent-memory-tab-count">{tabCounts[tab]}</span>
          </button>
        ))}
      </div>

      <div className="agent-memory-search">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search memories..."
          className="agent-memory-search-input"
        />
        {onAddMemory && (
          <button
            type="button"
            className="agent-memory-add-btn"
            onClick={() => setIsAdding(!isAdding)}
          >
            {isAdding ? "Cancel" : "+ Add"}
          </button>
        )}
      </div>

      {isAdding && (
        <div className="agent-memory-add-form">
          <textarea
            value={newMemoryContent}
            onChange={(e) => setNewMemoryContent(e.target.value)}
            placeholder={`Add ${activeTab} memory for ${agentName}...`}
            rows={3}
            className="agent-memory-textarea"
          />
          <button
            type="button"
            className="agent-memory-save-btn"
            onClick={handleAddMemory}
            disabled={!newMemoryContent.trim()}
          >
            Save Memory
          </button>
        </div>
      )}

      <div className="agent-memory-list">
        {filteredMemories.length === 0 ? (
          <div className="agent-memory-empty">
            <span className="agent-memory-empty-icon">
              {activeTab === "episodic" && "📅"}
              {activeTab === "semantic" && "📚"}
              {activeTab === "procedural" && "⚙️"}
              {activeTab === "working" && "💭"}
            </span>
            <span>No {activeTab} memories yet</span>
          </div>
        ) : (
          filteredMemories.map(memory => (
            <AgentMemoryItem
              key={memory.id}
              memory={memory}
              onDelete={onDeleteMemory}
              onUpdate={onUpdateMemory}
            />
          ))
        )}
      </div>

      <div className="agent-memory-footer">
        <div className="agent-memory-type-info">
          {activeTab === "episodic" && "Past interactions, events, and conversations"}
          {activeTab === "semantic" && "Facts, preferences, and learned knowledge"}
          {activeTab === "procedural" && "How-to knowledge and workflows"}
          {activeTab === "working" && "Recent context and temporary state"}
        </div>
      </div>
    </div>
  );
}

type AgentMemoryItemProps = {
  memory: MemoryRecord;
  onDelete?: (id: string) => Promise<void>;
  onUpdate?: (id: string, updates: Partial<MemoryRecord>) => Promise<void>;
};

function AgentMemoryItem({ memory, onDelete, onUpdate }: AgentMemoryItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(memory.content);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleSave = async () => {
    if (onUpdate && editContent.trim() !== memory.content) {
      await onUpdate(memory.id, { content: editContent.trim() });
    }
    setIsEditing(false);
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    setIsDeleting(true);
    try {
      await onDelete(memory.id);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className={`agent-memory-item ${isDeleting ? "deleting" : ""}`}>
      {isEditing ? (
        <div className="agent-memory-edit">
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            rows={3}
            className="agent-memory-edit-textarea"
          />
          <div className="agent-memory-edit-actions">
            <button type="button" onClick={handleSave}>Save</button>
            <button type="button" onClick={() => setIsEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <div className="agent-memory-content">{memory.content}</div>
          <div className="agent-memory-meta">
            <span className="agent-memory-category">{memory.category}</span>
            <span className="agent-memory-date">
              {new Date(memory.createdAt).toLocaleDateString()}
            </span>
          </div>
          <div className="agent-memory-actions">
            {onUpdate && (
              <button 
                type="button" 
                className="agent-memory-action-btn"
                onClick={() => setIsEditing(true)}
              >
                ✏️
              </button>
            )}
            {onDelete && (
              <button 
                type="button" 
                className="agent-memory-action-btn delete"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                🗑️
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Hook for managing agent-scoped memories
export function useAgentMemory(agentId: string) {
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch memories for this agent
  const fetchMemories = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/agents/${agentId}/memories`);
      if (!response.ok) throw new Error("Failed to fetch memories");
      const data = await response.json();
      setMemories(data.memories || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchMemories();
  }, [fetchMemories]);

  const addMemory = useCallback(async (memory: Partial<MemoryRecord>) => {
    const response = await fetch(`/api/agents/${agentId}/memories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(memory)
    });
    if (!response.ok) throw new Error("Failed to add memory");
    await fetchMemories();
  }, [agentId, fetchMemories]);

  const deleteMemory = useCallback(async (id: string) => {
    const response = await fetch(`/api/memory/${id}`, { method: "DELETE" });
    if (!response.ok) throw new Error("Failed to delete memory");
    setMemories(prev => prev.filter(m => m.id !== id));
  }, []);

  const updateMemory = useCallback(async (id: string, updates: Partial<MemoryRecord>) => {
    const response = await fetch(`/api/memory/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates)
    });
    if (!response.ok) throw new Error("Failed to update memory");
    await fetchMemories();
  }, [fetchMemories]);

  return {
    memories,
    loading,
    error,
    addMemory,
    deleteMemory,
    updateMemory,
    refresh: fetchMemories
  };
}

// Memory scope indicator for memory list items
type MemoryScopeProps = {
  memory: MemoryRecord & { agentId?: string };
  agents: Array<{ id: string; name: string; icon: string }>;
};

export function MemoryScope({ memory, agents }: MemoryScopeProps) {
  if (!memory.agentId) {
    return <span className="memory-scope global">🌐 Global</span>;
  }

  const agent = agents.find(a => a.id === memory.agentId);
  if (!agent) {
    return <span className="memory-scope unknown">❓ Unknown Agent</span>;
  }

  return (
    <span className="memory-scope agent">
      {agent.icon} {agent.name}
    </span>
  );
}
