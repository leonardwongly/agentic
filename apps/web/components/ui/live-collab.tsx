"use client";

import { useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { formatTime } from "../../lib/format-date";

// Live Collaboration: Real-time multi-user presence and editing

export type User = {
  id: string;
  name: string;
  avatar?: string;
  color: string;
  status: "online" | "away" | "busy" | "offline";
};

export type Cursor = {
  userId: string;
  x: number;
  y: number;
  target?: string; // Element ID or selector being hovered
  timestamp: number;
};

export type Selection = {
  userId: string;
  type: "goal" | "approval" | "agent" | "memory" | "text";
  itemId: string;
  startOffset?: number;
  endOffset?: number;
};

export type Presence = {
  user: User;
  cursor?: Cursor;
  selection?: Selection;
  lastSeen: number;
  currentView: string;
  isTyping?: boolean;
};

export type CollabEvent =
  | { type: "user-joined"; user: User }
  | { type: "user-left"; userId: string }
  | { type: "cursor-move"; cursor: Cursor }
  | { type: "selection-change"; selection: Selection }
  | { type: "typing-start"; userId: string; target: string }
  | { type: "typing-stop"; userId: string }
  | { type: "view-change"; userId: string; view: string }
  | { type: "edit"; userId: string; itemType: string; itemId: string; changes: unknown };

export type CollabMessage = {
  id: string;
  userId: string;
  content: string;
  timestamp: number;
  replyTo?: string;
  reactions?: Array<{ emoji: string; userIds: string[] }>;
};

// User presence avatars
type PresenceAvatarsProps = {
  presences: Presence[];
  currentUserId: string;
  maxVisible?: number;
  onUserClick?: (userId: string) => void;
};

export function PresenceAvatars({ presences, currentUserId, maxVisible = 5, onUserClick }: PresenceAvatarsProps) {
  const otherUsers = presences.filter(p => p.user.id !== currentUserId);
  const visible = otherUsers.slice(0, maxVisible);
  const overflow = otherUsers.length - maxVisible;

  return (
    <div className="presence-avatars">
      {visible.map((presence, i) => (
        <button
          key={presence.user.id}
          type="button"
          className={`presence-avatar presence-avatar-${presence.user.status}`}
          style={{
            backgroundColor: presence.user.color,
            zIndex: visible.length - i
          }}
          onClick={() => onUserClick?.(presence.user.id)}
          title={`${presence.user.name} (${presence.user.status})`}
        >
          {presence.user.avatar ? (
            <img src={presence.user.avatar} alt={presence.user.name} />
          ) : (
            <span>{presence.user.name.charAt(0).toUpperCase()}</span>
          )}
          {presence.isTyping && <span className="typing-indicator">...</span>}
        </button>
      ))}
      {overflow > 0 && (
        <div className="presence-overflow">+{overflow}</div>
      )}
    </div>
  );
}

// Floating cursor for other users
type FloatingCursorProps = {
  presence: Presence;
  containerRef?: React.RefObject<HTMLElement>;
};

export function FloatingCursor({ presence, containerRef }: FloatingCursorProps) {
  if (!presence.cursor) return null;

  return (
    <div
      className="floating-cursor"
      style={{
        left: presence.cursor.x,
        top: presence.cursor.y,
        "--cursor-color": presence.user.color
      } as React.CSSProperties}
    >
      <svg width="16" height="16" viewBox="0 0 16 16">
        <path
          d="M0 0L16 5.5L6 9.5L0 0Z"
          fill={presence.user.color}
        />
      </svg>
      <span className="cursor-label" style={{ backgroundColor: presence.user.color }}>
        {presence.user.name}
      </span>
    </div>
  );
}

// Selection highlight
type SelectionHighlightProps = {
  selection: Selection;
  user: User;
  containerRef?: React.RefObject<HTMLElement>;
};

export function SelectionHighlight({ selection, user, containerRef }: SelectionHighlightProps) {
  return (
    <div
      className="selection-highlight"
      data-item-id={selection.itemId}
      data-user-id={user.id}
      style={{
        "--selection-color": user.color
      } as React.CSSProperties}
    >
      <span className="selection-user-badge" style={{ backgroundColor: user.color }}>
        {user.name}
      </span>
    </div>
  );
}

// Live chat sidebar
type LiveChatProps = {
  messages: CollabMessage[];
  presences: Presence[];
  currentUserId: string;
  onSendMessage: (content: string, replyTo?: string) => void;
  onReact: (messageId: string, emoji: string) => void;
  className?: string;
};

export function LiveChat({ messages, presences, currentUserId, onSendMessage, onReact, className = "" }: LiveChatProps) {
  const [inputValue, setInputValue] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages.length]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;
    onSendMessage(inputValue.trim(), replyingTo || undefined);
    setInputValue("");
    setReplyingTo(null);
  };

  const getUserById = (userId: string) => presences.find(p => p.user.id === userId)?.user;

  const replyMessage = replyingTo ? messages.find(m => m.id === replyingTo) : null;

  const quickEmojis = ["👍", "❤️", "🎉", "👀", "🚀"];

  return (
    <div className={`live-chat ${className}`}>
      <div className="live-chat-header">
        <h4>Team Chat</h4>
        <PresenceAvatars presences={presences} currentUserId={currentUserId} maxVisible={3} />
      </div>

      <div className="live-chat-messages">
        {messages.map(msg => {
          const sender = getUserById(msg.userId);
          const isOwn = msg.userId === currentUserId;
          const reply = msg.replyTo ? messages.find(m => m.id === msg.replyTo) : null;

          return (
            <div key={msg.id} className={`chat-message ${isOwn ? "own" : ""}`}>
              {reply && (
                <div className="chat-message-reply">
                  <span className="reply-author">{getUserById(reply.userId)?.name}</span>
                  <span className="reply-content">{reply.content.slice(0, 50)}...</span>
                </div>
              )}
              <div className="chat-message-header">
                <span
                  className="chat-message-author"
                  style={{ color: sender?.color }}
                >
                  {sender?.name || "Unknown"}
                </span>
                <span className="chat-message-time">
                  {formatTime(msg.timestamp)}
                </span>
              </div>
              <div className="chat-message-content">{msg.content}</div>
              <div className="chat-message-actions">
                <button
                  type="button"
                  className="btn-icon btn-reply"
                  onClick={() => setReplyingTo(msg.id)}
                >
                  ↩️
                </button>
                <div className="quick-reactions">
                  {quickEmojis.map(emoji => (
                    <button
                      key={emoji}
                      type="button"
                      className={`btn-reaction ${msg.reactions?.some(r => r.emoji === emoji && r.userIds.includes(currentUserId)) ? "reacted" : ""}`}
                      onClick={() => onReact(msg.id, emoji)}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
              {msg.reactions && msg.reactions.length > 0 && (
                <div className="chat-message-reactions">
                  {msg.reactions.map(reaction => (
                    <span key={reaction.emoji} className="reaction-badge">
                      {reaction.emoji} {reaction.userIds.length}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {replyMessage && (
        <div className="chat-reply-preview">
          <span>Replying to {getUserById(replyMessage.userId)?.name}</span>
          <button type="button" onClick={() => setReplyingTo(null)}>✕</button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="live-chat-input">
        <input
          type="text"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          placeholder="Type a message..."
        />
        <button type="submit" disabled={!inputValue.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

// Activity feed showing real-time changes
type ActivityFeedProps = {
  events: CollabEvent[];
  presences: Presence[];
  maxItems?: number;
  className?: string;
};

export function ActivityFeed({ events, presences, maxItems = 20, className = "" }: ActivityFeedProps) {
  const recentEvents = events.slice(-maxItems).reverse();

  const getUserById = (userId: string) => presences.find(p => p.user.id === userId)?.user;

  const getEventDescription = (event: CollabEvent): string => {
    switch (event.type) {
      case "user-joined":
        return `joined the session`;
      case "user-left":
        return `left the session`;
      case "view-change":
        return `viewing ${event.view}`;
      case "selection-change":
        return `selected ${event.selection.type}`;
      case "typing-start":
        return `typing in ${event.target}`;
      case "edit":
        return `edited ${event.itemType}`;
      default:
        return "";
    }
  };

  return (
    <div className={`activity-feed ${className}`}>
      <h4>Live Activity</h4>
      <div className="activity-feed-list">
        {recentEvents.map((event, i) => {
          const userId = "userId" in event ? event.userId :
            event.type === "user-joined" ? event.user.id :
            event.type === "cursor-move" ? event.cursor.userId :
            event.type === "selection-change" ? event.selection.userId : "";
          const user = getUserById(userId);
          if (!user) return null;

          return (
            <div key={i} className="activity-feed-item">
              <div
                className="activity-avatar"
                style={{ backgroundColor: user.color }}
              >
                {user.name.charAt(0)}
              </div>
              <div className="activity-content">
                <span className="activity-user" style={{ color: user.color }}>
                  {user.name}
                </span>
                <span className="activity-action">{getEventDescription(event)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Collaborative editing lock indicator
type EditLockProps = {
  itemId: string;
  itemType: string;
  lockedBy?: User;
  onRequestEdit: () => void;
  onReleaseLock: () => void;
  currentUserId: string;
};

export function EditLock({ itemId, itemType, lockedBy, onRequestEdit, onReleaseLock, currentUserId }: EditLockProps) {
  const isLockedByMe = lockedBy?.id === currentUserId;
  const isLocked = !!lockedBy;

  return (
    <div className={`edit-lock ${isLocked ? "locked" : "unlocked"}`}>
      {isLocked ? (
        <div className="edit-lock-info">
          <span
            className="lock-user"
            style={{ color: lockedBy?.color }}
          >
            🔒 {isLockedByMe ? "You're editing" : `${lockedBy?.name} is editing`}
          </span>
          {isLockedByMe && (
            <button type="button" onClick={onReleaseLock} className="btn-release-lock">
              Release
            </button>
          )}
        </div>
      ) : (
        <button type="button" onClick={onRequestEdit} className="btn-request-edit">
          ✏️ Edit
        </button>
      )}
    </div>
  );
}

// User list with status
type UserListProps = {
  presences: Presence[];
  currentUserId: string;
  onFollow?: (userId: string) => void;
  className?: string;
};

export function UserList({ presences, currentUserId, onFollow, className = "" }: UserListProps) {
  const statusOrder: Record<User["status"], number> = {
    online: 0,
    busy: 1,
    away: 2,
    offline: 3
  };

  const sortedPresences = [...presences].sort((a, b) =>
    statusOrder[a.user.status] - statusOrder[b.user.status]
  );

  return (
    <div className={`user-list ${className}`}>
      <h4>Team ({presences.length})</h4>
      <div className="user-list-items">
        {sortedPresences.map(presence => (
          <div
            key={presence.user.id}
            className={`user-list-item ${presence.user.id === currentUserId ? "current" : ""}`}
          >
            <div
              className={`user-avatar user-status-${presence.user.status}`}
              style={{ backgroundColor: presence.user.color }}
            >
              {presence.user.name.charAt(0)}
            </div>
            <div className="user-info">
              <span className="user-name">
                {presence.user.name}
                {presence.user.id === currentUserId && " (You)"}
              </span>
              <span className="user-view">{presence.currentView}</span>
            </div>
            {presence.user.id !== currentUserId && onFollow && (
              <button
                type="button"
                onClick={() => onFollow(presence.user.id)}
                className="btn-follow"
                title="Follow view"
              >
                👁️
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Main collaboration provider
type CollaborationContextType = {
  presences: Presence[];
  events: CollabEvent[];
  currentUser: User | null;
  sendEvent: (event: Omit<CollabEvent, "timestamp">) => void;
  updateCursor: (x: number, y: number, target?: string) => void;
  updateSelection: (selection: Omit<Selection, "userId">) => void;
  setTyping: (isTyping: boolean, target?: string) => void;
  setView: (view: string) => void;
};

// Simulated collaboration hook
export function useCollaboration(options: {
  userId: string;
  userName: string;
  userColor?: string;
  roomId: string;
}): CollaborationContextType {
  const [presences, setPresences] = useState<Presence[]>([]);
  const [events, setEvents] = useState<CollabEvent[]>([]);
  const [currentUser] = useState<User>({
    id: options.userId,
    name: options.userName,
    color: options.userColor || `hsl(${Math.random() * 360}, 70%, 50%)`,
    status: "online"
  });

  // Simulate initial presence
  useEffect(() => {
    const myPresence: Presence = {
      user: currentUser,
      lastSeen: Date.now(),
      currentView: "dashboard"
    };
    setPresences([myPresence]);

    // Simulate other users joining
    const simulatedUsers: User[] = [
      { id: "user-2", name: "Alice", color: "#4CAF50", status: "online" },
      { id: "user-3", name: "Bob", color: "#2196F3", status: "away" }
    ];

    const timeout = setTimeout(() => {
      setPresences(prev => [
        ...prev,
        ...simulatedUsers.map(user => ({
          user,
          lastSeen: Date.now(),
          currentView: "goals"
        }))
      ]);
      setEvents(prev => [
        ...prev,
        ...simulatedUsers.map(user => ({ type: "user-joined" as const, user }))
      ]);
    }, 1000);

    return () => clearTimeout(timeout);
  }, [currentUser]);

  const sendEvent = useCallback((event: Omit<CollabEvent, "timestamp">) => {
    setEvents(prev => [...prev, event as CollabEvent]);
  }, []);

  const updateCursor = useCallback((x: number, y: number, target?: string) => {
    const cursor: Cursor = {
      userId: currentUser.id,
      x,
      y,
      target,
      timestamp: Date.now()
    };
    setPresences(prev => prev.map(p =>
      p.user.id === currentUser.id ? { ...p, cursor } : p
    ));
  }, [currentUser.id]);

  const updateSelection = useCallback((selection: Omit<Selection, "userId">) => {
    const fullSelection: Selection = { ...selection, userId: currentUser.id };
    setPresences(prev => prev.map(p =>
      p.user.id === currentUser.id ? { ...p, selection: fullSelection } : p
    ));
    sendEvent({ type: "selection-change", selection: fullSelection } as CollabEvent);
  }, [currentUser.id, sendEvent]);

  const setTyping = useCallback((isTyping: boolean, target?: string) => {
    setPresences(prev => prev.map(p =>
      p.user.id === currentUser.id ? { ...p, isTyping } : p
    ));
    if (isTyping && target) {
      sendEvent({ type: "typing-start", userId: currentUser.id, target } as CollabEvent);
    } else {
      sendEvent({ type: "typing-stop", userId: currentUser.id } as CollabEvent);
    }
  }, [currentUser.id, sendEvent]);

  const setView = useCallback((view: string) => {
    setPresences(prev => prev.map(p =>
      p.user.id === currentUser.id ? { ...p, currentView: view } : p
    ));
    sendEvent({ type: "view-change", userId: currentUser.id, view } as CollabEvent);
  }, [currentUser.id, sendEvent]);

  return {
    presences,
    events,
    currentUser,
    sendEvent,
    updateCursor,
    updateSelection,
    setTyping,
    setView
  };
}

// Collaboration panel
type CollaborationPanelProps = {
  collaboration: CollaborationContextType;
  messages?: CollabMessage[];
  onSendMessage?: (content: string, replyTo?: string) => void;
  onReact?: (messageId: string, emoji: string) => void;
  className?: string;
};

export function CollaborationPanel({
  collaboration,
  messages = [],
  onSendMessage,
  onReact,
  className = ""
}: CollaborationPanelProps) {
  const [activeTab, setActiveTab] = useState<"users" | "chat" | "activity">("users");

  return (
    <div className={`collaboration-panel ${className}`}>
      <div className="collab-panel-tabs">
        <button
          type="button"
          className={`tab ${activeTab === "users" ? "active" : ""}`}
          onClick={() => setActiveTab("users")}
        >
          Users
        </button>
        <button
          type="button"
          className={`tab ${activeTab === "chat" ? "active" : ""}`}
          onClick={() => setActiveTab("chat")}
        >
          Chat
        </button>
        <button
          type="button"
          className={`tab ${activeTab === "activity" ? "active" : ""}`}
          onClick={() => setActiveTab("activity")}
        >
          Activity
        </button>
      </div>

      <div className="collab-panel-content">
        {activeTab === "users" && (
          <UserList
            presences={collaboration.presences}
            currentUserId={collaboration.currentUser?.id || ""}
          />
        )}
        {activeTab === "chat" && onSendMessage && onReact && (
          <LiveChat
            messages={messages}
            presences={collaboration.presences}
            currentUserId={collaboration.currentUser?.id || ""}
            onSendMessage={onSendMessage}
            onReact={onReact}
          />
        )}
        {activeTab === "activity" && (
          <ActivityFeed
            events={collaboration.events}
            presences={collaboration.presences}
          />
        )}
      </div>
    </div>
  );
}

// Floating presence bar
type PresenceBarProps = {
  collaboration: CollaborationContextType;
  onOpenPanel?: () => void;
  className?: string;
};

export function PresenceBar({ collaboration, onOpenPanel, className = "" }: PresenceBarProps) {
  return (
    <div className={`presence-bar ${className}`}>
      <PresenceAvatars
        presences={collaboration.presences}
        currentUserId={collaboration.currentUser?.id || ""}
        maxVisible={4}
      />
      {onOpenPanel && (
        <button type="button" onClick={onOpenPanel} className="btn-open-collab">
          💬
        </button>
      )}
    </div>
  );
}
