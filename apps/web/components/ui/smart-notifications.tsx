"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

// Smart Notifications - Context-aware alerting system
// Learns preferences, batches low-priority, pushes urgent, in-app for info

export type NotificationPriority = "urgent" | "high" | "medium" | "low" | "info";
export type NotificationChannel = "push" | "in-app" | "email" | "slack" | "silent";

export type Notification = {
  id: string;
  type: string;
  title: string;
  message: string;
  priority: NotificationPriority;
  channel: NotificationChannel;
  actionUrl?: string;
  actionLabel?: string;
  metadata?: Record<string, unknown>;
  read: boolean;
  dismissed: boolean;
  createdAt: string;
  expiresAt?: string;
};

export type NotificationPreferences = {
  channels: {
    urgent: NotificationChannel[];
    high: NotificationChannel[];
    medium: NotificationChannel[];
    low: NotificationChannel[];
    info: NotificationChannel[];
  };
  quietHours: {
    enabled: boolean;
    start: string; // HH:mm
    end: string;
  };
  batchLowPriority: boolean;
  batchInterval: number; // minutes
  soundEnabled: boolean;
  vibrationEnabled: boolean;
};

const defaultPreferences: NotificationPreferences = {
  channels: {
    urgent: ["push", "in-app"],
    high: ["push", "in-app"],
    medium: ["in-app"],
    low: ["in-app"],
    info: ["silent"]
  },
  quietHours: {
    enabled: false,
    start: "22:00",
    end: "08:00"
  },
  batchLowPriority: true,
  batchInterval: 30,
  soundEnabled: true,
  vibrationEnabled: true
};

type NotificationCenterProps = {
  notifications: Notification[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onDismiss: (id: string) => void;
  onAction: (id: string, action: string) => void;
  className?: string;
};

export function NotificationCenter({
  notifications,
  onMarkRead,
  onMarkAllRead,
  onDismiss,
  onAction,
  className = ""
}: NotificationCenterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const activeNotifications = useMemo(() => {
    return notifications
      .filter(n => !n.dismissed)
      .filter(n => filter === "all" || !n.read)
      .sort((a, b) => {
        const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3, info: 4 };
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (priorityDiff !== 0) return priorityDiff;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }, [notifications, filter]);

  const unreadCount = notifications.filter(n => !n.read && !n.dismissed).length;
  const urgentCount = notifications.filter(n => n.priority === "urgent" && !n.read && !n.dismissed).length;

  return (
    <div className={`notification-center ${className}`}>
      <button
        type="button"
        className={`notification-trigger ${urgentCount > 0 ? "has-urgent" : ""}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="notification-icon">🔔</span>
        {unreadCount > 0 && (
          <span className={`notification-badge ${urgentCount > 0 ? "urgent" : ""}`}>
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="notification-dropdown">
          <div className="notification-header">
            <h3>Notifications</h3>
            <div className="notification-header-actions">
              <select 
                value={filter} 
                onChange={(e) => setFilter(e.target.value as "all" | "unread")}
                className="notification-filter"
              >
                <option value="all">All</option>
                <option value="unread">Unread</option>
              </select>
              {unreadCount > 0 && (
                <button 
                  type="button" 
                  className="notification-mark-all"
                  onClick={onMarkAllRead}
                >
                  Mark all read
                </button>
              )}
            </div>
          </div>

          <div className="notification-list">
            {activeNotifications.length === 0 ? (
              <div className="notification-empty">
                <span className="notification-empty-icon">✨</span>
                <span>All caught up!</span>
              </div>
            ) : (
              activeNotifications.map(notification => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onMarkRead={onMarkRead}
                  onDismiss={onDismiss}
                  onAction={onAction}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationItem({
  notification,
  onMarkRead,
  onDismiss,
  onAction
}: {
  notification: Notification;
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
  onAction: (id: string, action: string) => void;
}) {
  const priorityIcons = {
    urgent: "🚨",
    high: "⚠️",
    medium: "📌",
    low: "💬",
    info: "ℹ️"
  };

  return (
    <div 
      className={`notification-item priority-${notification.priority} ${notification.read ? "read" : "unread"}`}
      onClick={() => !notification.read && onMarkRead(notification.id)}
    >
      <div className="notification-item-icon">
        {priorityIcons[notification.priority]}
      </div>
      <div className="notification-item-content">
        <div className="notification-item-title">{notification.title}</div>
        <div className="notification-item-message">{notification.message}</div>
        <div className="notification-item-meta">
          <span className="notification-item-time">
            {formatRelativeTime(new Date(notification.createdAt))}
          </span>
          {notification.actionLabel && (
            <button
              type="button"
              className="notification-item-action"
              onClick={(e) => {
                e.stopPropagation();
                onAction(notification.id, notification.actionLabel!);
              }}
            >
              {notification.actionLabel}
            </button>
          )}
        </div>
      </div>
      <button
        type="button"
        className="notification-item-dismiss"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(notification.id);
        }}
      >
        ✕
      </button>
    </div>
  );
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

// Hook for managing notifications
export function useSmartNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [preferences, setPreferences] = useState<NotificationPreferences>(defaultPreferences);
  const [batchedNotifications, setBatchedNotifications] = useState<Notification[]>([]);

  // Load preferences from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("notification-preferences");
    if (saved) {
      try {
        setPreferences({ ...defaultPreferences, ...JSON.parse(saved) });
      } catch {
        // Ignore parse errors
      }
    }
  }, []);

  // Save preferences
  const updatePreferences = useCallback((updates: Partial<NotificationPreferences>) => {
    setPreferences(prev => {
      const next = { ...prev, ...updates };
      localStorage.setItem("notification-preferences", JSON.stringify(next));
      return next;
    });
  }, []);

  // Check if in quiet hours
  const isQuietHours = useCallback(() => {
    if (!preferences.quietHours.enabled) return false;
    
    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
    
    const { start, end } = preferences.quietHours;
    if (start < end) {
      return currentTime >= start && currentTime < end;
    } else {
      return currentTime >= start || currentTime < end;
    }
  }, [preferences.quietHours]);

  // Add notification with smart routing
  const addNotification = useCallback((notification: Omit<Notification, "id" | "read" | "dismissed" | "createdAt">) => {
    const newNotification: Notification = {
      ...notification,
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      read: false,
      dismissed: false,
      createdAt: new Date().toISOString()
    };

    // Determine channel based on priority and preferences
    const channels = preferences.channels[notification.priority];
    
    // During quiet hours, downgrade non-urgent notifications
    if (isQuietHours() && notification.priority !== "urgent") {
      newNotification.channel = "silent";
    }

    // Batch low priority notifications
    if (preferences.batchLowPriority && (notification.priority === "low" || notification.priority === "info")) {
      setBatchedNotifications(prev => [...prev, newNotification]);
      return newNotification;
    }

    setNotifications(prev => [newNotification, ...prev]);

    // Play sound for non-silent notifications
    if (preferences.soundEnabled && channels.includes("push") && newNotification.channel !== "silent") {
      // Would trigger sound here in real implementation
    }

    return newNotification;
  }, [preferences, isQuietHours]);

  // Process batched notifications
  useEffect(() => {
    if (!preferences.batchLowPriority || batchedNotifications.length === 0) return;

    const timer = setTimeout(() => {
      if (batchedNotifications.length > 0) {
        // Create a summary notification
        const summary: Notification = {
          id: `batch-${Date.now()}`,
          type: "batch",
          title: `${batchedNotifications.length} updates`,
          message: batchedNotifications.map(n => n.title).slice(0, 3).join(", ") + 
                   (batchedNotifications.length > 3 ? ` +${batchedNotifications.length - 3} more` : ""),
          priority: "low",
          channel: "in-app",
          read: false,
          dismissed: false,
          createdAt: new Date().toISOString()
        };
        
        setNotifications(prev => [summary, ...prev]);
        setBatchedNotifications([]);
      }
    }, preferences.batchInterval * 60 * 1000);

    return () => clearTimeout(timer);
  }, [batchedNotifications, preferences.batchLowPriority, preferences.batchInterval]);

  const markRead = useCallback((id: string) => {
    setNotifications(prev => prev.map(n => 
      n.id === id ? { ...n, read: true } : n
    ));
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const dismiss = useCallback((id: string) => {
    setNotifications(prev => prev.map(n => 
      n.id === id ? { ...n, dismissed: true } : n
    ));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  return {
    notifications,
    preferences,
    updatePreferences,
    addNotification,
    markRead,
    markAllRead,
    dismiss,
    clearAll,
    unreadCount: notifications.filter(n => !n.read && !n.dismissed).length,
    urgentCount: notifications.filter(n => n.priority === "urgent" && !n.read && !n.dismissed).length
  };
}

// Notification preferences panel
export function NotificationPreferencesPanel({
  preferences,
  onUpdate,
  className = ""
}: {
  preferences: NotificationPreferences;
  onUpdate: (updates: Partial<NotificationPreferences>) => void;
  className?: string;
}) {
  return (
    <div className={`notification-preferences ${className}`}>
      <h4>Notification Settings</h4>
      
      <div className="notification-pref-section">
        <label className="notification-pref-toggle">
          <input
            type="checkbox"
            checked={preferences.soundEnabled}
            onChange={(e) => onUpdate({ soundEnabled: e.target.checked })}
          />
          <span>Sound notifications</span>
        </label>
      </div>

      <div className="notification-pref-section">
        <label className="notification-pref-toggle">
          <input
            type="checkbox"
            checked={preferences.batchLowPriority}
            onChange={(e) => onUpdate({ batchLowPriority: e.target.checked })}
          />
          <span>Batch low-priority notifications</span>
        </label>
        {preferences.batchLowPriority && (
          <div className="notification-pref-detail">
            <label>Batch interval (minutes)</label>
            <input
              type="number"
              value={preferences.batchInterval}
              onChange={(e) => onUpdate({ batchInterval: parseInt(e.target.value) || 30 })}
              min={5}
              max={120}
            />
          </div>
        )}
      </div>

      <div className="notification-pref-section">
        <label className="notification-pref-toggle">
          <input
            type="checkbox"
            checked={preferences.quietHours.enabled}
            onChange={(e) => onUpdate({ 
              quietHours: { ...preferences.quietHours, enabled: e.target.checked }
            })}
          />
          <span>Quiet hours</span>
        </label>
        {preferences.quietHours.enabled && (
          <div className="notification-pref-detail">
            <label>
              From
              <input
                type="time"
                value={preferences.quietHours.start}
                onChange={(e) => onUpdate({
                  quietHours: { ...preferences.quietHours, start: e.target.value }
                })}
              />
            </label>
            <label>
              To
              <input
                type="time"
                value={preferences.quietHours.end}
                onChange={(e) => onUpdate({
                  quietHours: { ...preferences.quietHours, end: e.target.value }
                })}
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
