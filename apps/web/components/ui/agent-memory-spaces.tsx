"use client";

import { useState, useCallback, useEffect, useMemo, type ReactNode } from "react";
import type { MemoryRecord, MemoryType } from "@agentic/contracts";
import { formatDate } from "../../lib/format-date";

// Agent Memory Spaces: Persistent, agent-scoped memory management

export type MemorySpace = {
  id: string;
  name: string;
  description: string;
  agentId: string | null; // null = global space
  type: "personal" | "shared" | "project" | "archive";
  color: string;
  icon: string;
  memoryCount: number;
  lastAccessed: string;
  createdAt: string;
};

export type MemorySpaceStats = {
  spaceId: string;
  totalMemories: number;
  byType: Record<MemoryType, number>;
  recentAccess: number;
  storageUsed: number;
  topTags: string[];
};

export type MemoryLink = {
  sourceId: string;
  targetId: string;
  relationship: "related" | "derived" | "supersedes" | "contradicts" | "supports";
  strength: number; // 0-1
  createdAt: string;
};

// Memory space card
type MemorySpaceCardProps = {
  space: MemorySpace;
  stats?: MemorySpaceStats;
  isSelected?: boolean;
  onClick: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
};

export function MemorySpaceCard({ space, stats, isSelected, onClick, onEdit, onDelete }: MemorySpaceCardProps) {
  return (
    <div
      className={`memory-space-card ${isSelected ? "selected" : ""}`}
      style={{ "--space-color": space.color } as React.CSSProperties}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
    >
      <div className="memory-space-header">
        <span className="memory-space-icon">{space.icon}</span>
        <span className={`memory-space-type memory-space-type-${space.type}`}>
          {space.type}
        </span>
      </div>

      <h4 className="memory-space-name">{space.name}</h4>
      {space.description && (
        <p className="memory-space-description">{space.description}</p>
      )}

      <div className="memory-space-stats">
        <span className="stat">
          <span className="stat-value">{stats?.totalMemories || space.memoryCount}</span>
          <span className="stat-label">memories</span>
        </span>
        {stats?.recentAccess && stats.recentAccess > 0 && (
          <span className="stat">
            <span className="stat-value">{stats.recentAccess}</span>
            <span className="stat-label">accessed today</span>
          </span>
        )}
      </div>

      {stats?.topTags && stats.topTags.length > 0 && (
        <div className="memory-space-tags">
          {stats.topTags.slice(0, 3).map(tag => (
            <span key={tag} className="memory-tag">{tag}</span>
          ))}
        </div>
      )}

      <div className="memory-space-footer">
        <span className="last-accessed">
          Last accessed {formatDate(space.lastAccessed)}
        </span>
        <div className="memory-space-actions">
          {onEdit && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="btn-icon"
              title="Edit"
            >
              ✏️
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="btn-icon btn-danger"
              title="Delete"
            >
              🗑️
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Memory space creator/editor
type MemorySpaceEditorProps = {
  space?: Partial<MemorySpace>;
  agents: Array<{ id: string; name: string }>;
  onSave: (space: MemorySpace) => void;
  onCancel: () => void;
};

export function MemorySpaceEditor({ space, agents, onSave, onCancel }: MemorySpaceEditorProps) {
  const [formData, setFormData] = useState({
    id: space?.id || `space-${Date.now()}`,
    name: space?.name || "",
    description: space?.description || "",
    agentId: space?.agentId || null as string | null,
    type: space?.type || "personal" as MemorySpace["type"],
    color: space?.color || "#6366f1",
    icon: space?.icon || "📚"
  });

  const spaceTypes: Array<{ value: MemorySpace["type"]; label: string; description: string }> = [
    { value: "personal", label: "Personal", description: "Private to this agent" },
    { value: "shared", label: "Shared", description: "Accessible by all agents" },
    { value: "project", label: "Project", description: "Linked to specific goals" },
    { value: "archive", label: "Archive", description: "Historical reference" }
  ];

  const iconOptions = ["📚", "🧠", "💡", "🔬", "📝", "🎯", "🔐", "🌐", "⚡", "📊"];
  const colorOptions = ["#6366f1", "#ec4899", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#84cc16"];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    onSave({
      ...formData,
      memoryCount: space?.memoryCount || 0,
      lastAccessed: space?.lastAccessed || new Date().toISOString(),
      createdAt: space?.createdAt || new Date().toISOString()
    });
  };

  return (
    <form onSubmit={handleSubmit} className="memory-space-editor">
      <div className="editor-header">
        <h3>{space?.id ? "Edit Space" : "Create Memory Space"}</h3>
        <button type="button" onClick={onCancel} className="btn-close">✕</button>
      </div>

      <div className="form-group">
        <label htmlFor="space-name">Name</label>
        <input
          id="space-name"
          type="text"
          value={formData.name}
          onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
          placeholder="e.g., Meeting Notes, Research Data"
        />
      </div>

      <div className="form-group">
        <label htmlFor="space-description">Description</label>
        <textarea
          id="space-description"
          value={formData.description}
          onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
          placeholder="What this space is for..."
        />
      </div>

      <div className="form-group">
        <label htmlFor="space-agent">Assigned Agent</label>
        <select
          id="space-agent"
          value={formData.agentId || ""}
          onChange={e => setFormData(prev => ({ ...prev, agentId: e.target.value || null }))}
        >
          <option value="">Global (All Agents)</option>
          {agents.map(agent => (
            <option key={agent.id} value={agent.id}>{agent.name}</option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label>Space Type</label>
        <div className="space-type-options">
          {spaceTypes.map(type => (
            <button
              key={type.value}
              type="button"
              className={`space-type-option ${formData.type === type.value ? "selected" : ""}`}
              onClick={() => setFormData(prev => ({ ...prev, type: type.value }))}
            >
              <span className="type-label">{type.label}</span>
              <span className="type-description">{type.description}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Icon</label>
          <div className="icon-options">
            {iconOptions.map(icon => (
              <button
                key={icon}
                type="button"
                className={`icon-option ${formData.icon === icon ? "selected" : ""}`}
                onClick={() => setFormData(prev => ({ ...prev, icon }))}
              >
                {icon}
              </button>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label>Color</label>
          <div className="color-options">
            {colorOptions.map(color => (
              <button
                key={color}
                type="button"
                className={`color-option ${formData.color === color ? "selected" : ""}`}
                style={{ backgroundColor: color }}
                onClick={() => setFormData(prev => ({ ...prev, color }))}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="editor-footer">
        <button type="button" onClick={onCancel} className="btn-secondary">
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={!formData.name.trim()}>
          {space?.id ? "Update Space" : "Create Space"}
        </button>
      </div>
    </form>
  );
}

// Memory linking interface
type MemoryLinkerProps = {
  sourceMemory: MemoryRecord;
  targetMemories: MemoryRecord[];
  existingLinks: MemoryLink[];
  onLink: (link: Omit<MemoryLink, "createdAt">) => void;
  onUnlink: (sourceId: string, targetId: string) => void;
};

export function MemoryLinker({ sourceMemory, targetMemories, existingLinks, onLink, onUnlink }: MemoryLinkerProps) {
  const [selectedTarget, setSelectedTarget] = useState<string>("");
  const [relationship, setRelationship] = useState<MemoryLink["relationship"]>("related");
  const [strength, setStrength] = useState(0.5);

  const linkedMemories = existingLinks.filter(l => l.sourceId === sourceMemory.id);
  const availableTargets = targetMemories.filter(m =>
    m.id !== sourceMemory.id && !linkedMemories.some(l => l.targetId === m.id)
  );

  const handleLink = () => {
    if (!selectedTarget) return;
    onLink({
      sourceId: sourceMemory.id,
      targetId: selectedTarget,
      relationship,
      strength
    });
    setSelectedTarget("");
    setStrength(0.5);
  };

  const relationshipOptions: Array<{ value: MemoryLink["relationship"]; label: string; icon: string }> = [
    { value: "related", label: "Related", icon: "🔗" },
    { value: "derived", label: "Derived From", icon: "📐" },
    { value: "supersedes", label: "Supersedes", icon: "⬆️" },
    { value: "contradicts", label: "Contradicts", icon: "⚔️" },
    { value: "supports", label: "Supports", icon: "🤝" }
  ];

  return (
    <div className="memory-linker">
      <h4>Link Memories</h4>
      <p className="source-memory">
        Linking from: <strong>{sourceMemory.content.slice(0, 50)}...</strong>
      </p>

      {linkedMemories.length > 0 && (
        <div className="existing-links">
          <h5>Existing Links</h5>
          {linkedMemories.map(link => {
            const target = targetMemories.find(m => m.id === link.targetId);
            return (
              <div key={link.targetId} className="link-item">
                <span className="link-relationship">
                  {relationshipOptions.find(r => r.value === link.relationship)?.icon}
                  {link.relationship}
                </span>
                <span className="link-target">{target?.content.slice(0, 40)}...</span>
                <span className="link-strength">{Math.round(link.strength * 100)}%</span>
                <button
                  type="button"
                  onClick={() => onUnlink(sourceMemory.id, link.targetId)}
                  className="btn-icon btn-danger"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}

      {availableTargets.length > 0 && (
        <div className="new-link-form">
          <h5>Add Link</h5>

          <div className="form-group">
            <label htmlFor="link-target">Target Memory</label>
            <select
              id="link-target"
              value={selectedTarget}
              onChange={e => setSelectedTarget(e.target.value)}
            >
              <option value="">Select a memory...</option>
              {availableTargets.map(m => (
                <option key={m.id} value={m.id}>
                  {m.content.slice(0, 60)}...
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Relationship</label>
            <div className="relationship-options">
              {relationshipOptions.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  className={`relationship-option ${relationship === opt.value ? "selected" : ""}`}
                  onClick={() => setRelationship(opt.value)}
                >
                  <span>{opt.icon}</span>
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="link-strength">Link Strength: {Math.round(strength * 100)}%</label>
            <input
              id="link-strength"
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={strength}
              onChange={e => setStrength(parseFloat(e.target.value))}
            />
          </div>

          <button
            type="button"
            onClick={handleLink}
            className="btn-primary"
            disabled={!selectedTarget}
          >
            Create Link
          </button>
        </div>
      )}
    </div>
  );
}

// Memory space browser
type MemorySpaceBrowserProps = {
  spaces: MemorySpace[];
  selectedSpace: MemorySpace | null;
  memories: MemoryRecord[];
  onSelectSpace: (space: MemorySpace | null) => void;
  onCreateSpace: () => void;
  onEditSpace: (space: MemorySpace) => void;
  onDeleteSpace: (spaceId: string) => void;
  onSelectMemory: (memory: MemoryRecord) => void;
  className?: string;
};

export function MemorySpaceBrowser({
  spaces,
  selectedSpace,
  memories,
  onSelectSpace,
  onCreateSpace,
  onEditSpace,
  onDeleteSpace,
  onSelectMemory,
  className = ""
}: MemorySpaceBrowserProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<MemoryType | "all">("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const filteredSpaces = spaces.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const spaceMemories = selectedSpace
    ? memories.filter(m => m.agentId === selectedSpace.agentId || (!m.agentId && !selectedSpace.agentId))
    : memories;

  const filteredMemories = spaceMemories.filter(m =>
    (filterType === "all" || m.memoryType === filterType) &&
    m.content.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const memoryTypes: MemoryType[] = ["observed", "inferred", "confirmed"];

  return (
    <div className={`memory-space-browser ${className}`}>
      <div className="browser-header">
        <div className="browser-search">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={selectedSpace ? "Search memories..." : "Search spaces..."}
          />
        </div>

        <div className="browser-controls">
          {selectedSpace && (
            <>
              <select
                value={filterType}
                onChange={e => setFilterType(e.target.value as MemoryType | "all")}
                className="type-filter"
              >
                <option value="all">All Types</option>
                {memoryTypes.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
              <button
                type="button"
                className={`view-toggle ${viewMode === "grid" ? "active" : ""}`}
                onClick={() => setViewMode("grid")}
              >
                ▦
              </button>
              <button
                type="button"
                className={`view-toggle ${viewMode === "list" ? "active" : ""}`}
                onClick={() => setViewMode("list")}
              >
                ≡
              </button>
            </>
          )}
          <button type="button" onClick={onCreateSpace} className="btn-primary">
            + New Space
          </button>
        </div>
      </div>

      {selectedSpace ? (
        <>
          <div className="browser-breadcrumb">
            <button type="button" onClick={() => onSelectSpace(null)}>
              ← All Spaces
            </button>
            <span className="breadcrumb-separator">/</span>
            <span
              className="breadcrumb-current"
              style={{ color: selectedSpace.color }}
            >
              {selectedSpace.icon} {selectedSpace.name}
            </span>
          </div>

          <div className={`memory-list memory-list-${viewMode}`}>
            {filteredMemories.length === 0 ? (
              <div className="empty-state">
                <p>No memories in this space yet.</p>
              </div>
            ) : (
              filteredMemories.map(memory => (
                <div
                  key={memory.id}
                  className="memory-item"
                  onClick={() => onSelectMemory(memory)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && onSelectMemory(memory)}
                >
                  <span className={`memory-type memory-type-${memory.memoryType}`}>
                    {memory.memoryType}
                  </span>
                  <p className="memory-content">{memory.content}</p>
                  <span className="memory-date">
                    {formatDate(memory.createdAt)}
                  </span>
                </div>
              ))
            )}
          </div>
        </>
      ) : (
        <div className="space-grid">
          {filteredSpaces.length === 0 ? (
            <div className="empty-state">
              <p>No memory spaces yet.</p>
              <button type="button" onClick={onCreateSpace} className="btn-primary">
                Create Your First Space
              </button>
            </div>
          ) : (
            filteredSpaces.map(space => (
              <MemorySpaceCard
                key={space.id}
                space={space}
                onClick={() => onSelectSpace(space)}
                onEdit={() => onEditSpace(space)}
                onDelete={() => onDeleteSpace(space.id)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// Hook for memory space management
export function useMemorySpaces(agents: Array<{ id: string; name: string }>) {
  const [spaces, setSpaces] = useState<MemorySpace[]>([]);
  const [links, setLinks] = useState<MemoryLink[]>([]);
  const [selectedSpace, setSelectedSpace] = useState<MemorySpace | null>(null);

  // Initialize with default spaces
  useEffect(() => {
    const defaultSpaces: MemorySpace[] = [
      {
        id: "global",
        name: "Global Knowledge",
        description: "Shared knowledge accessible by all agents",
        agentId: null,
        type: "shared",
        color: "#6366f1",
        icon: "🌐",
        memoryCount: 0,
        lastAccessed: new Date().toISOString(),
        createdAt: new Date().toISOString()
      }
    ];
    setSpaces(defaultSpaces);
  }, []);

  const createSpace = useCallback((space: MemorySpace) => {
    setSpaces(prev => [...prev, space]);
  }, []);

  const updateSpace = useCallback((space: MemorySpace) => {
    setSpaces(prev => prev.map(s => s.id === space.id ? space : s));
  }, []);

  const deleteSpace = useCallback((spaceId: string) => {
    setSpaces(prev => prev.filter(s => s.id !== spaceId));
    if (selectedSpace?.id === spaceId) {
      setSelectedSpace(null);
    }
  }, [selectedSpace]);

  const addLink = useCallback((link: Omit<MemoryLink, "createdAt">) => {
    setLinks(prev => [...prev, { ...link, createdAt: new Date().toISOString() }]);
  }, []);

  const removeLink = useCallback((sourceId: string, targetId: string) => {
    setLinks(prev => prev.filter(l =>
      !(l.sourceId === sourceId && l.targetId === targetId)
    ));
  }, []);

  const getSpaceStats = useCallback((spaceId: string, memories: MemoryRecord[]): MemorySpaceStats => {
    const space = spaces.find(s => s.id === spaceId);
    const spaceMemories = memories.filter(m =>
      m.agentId === space?.agentId || (!m.agentId && !space?.agentId)
    );

    const byType: Record<MemoryType, number> = {
      observed: 0,
      inferred: 0,
      confirmed: 0
    };
    spaceMemories.forEach(m => {
      byType[m.memoryType]++;
    });

    const today = new Date().toDateString();
    const recentAccess = spaceMemories.filter(m =>
      new Date(m.createdAt).toDateString() === today
    ).length;

    return {
      spaceId,
      totalMemories: spaceMemories.length,
      byType,
      recentAccess,
      storageUsed: spaceMemories.reduce((acc, m) => acc + m.content.length, 0),
      topTags: []
    };
  }, [spaces]);

  return {
    spaces,
    selectedSpace,
    links,
    setSelectedSpace,
    createSpace,
    updateSpace,
    deleteSpace,
    addLink,
    removeLink,
    getSpaceStats
  };
}
