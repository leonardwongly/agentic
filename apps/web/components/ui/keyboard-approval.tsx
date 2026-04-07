"use client";

import { useCallback, useEffect, useState, createContext, useContext, type ReactNode } from "react";
import type { ApprovalRequest } from "@agentic/contracts";

// Keyboard-driven approval flow: j/k navigate, a approve, r reject, space expand, enter confirm

type ApprovalNavigationContextValue = {
  selectedIndex: number;
  setSelectedIndex: (index: number) => void;
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
  isActive: boolean;
  setIsActive: (active: boolean) => void;
};

const ApprovalNavigationContext = createContext<ApprovalNavigationContextValue | null>(null);

export function useApprovalNavigation() {
  const context = useContext(ApprovalNavigationContext);
  if (!context) {
    throw new Error("useApprovalNavigation must be used within ApprovalNavigationProvider");
  }
  return context;
}

type ApprovalNavigationProviderProps = {
  children: ReactNode;
  approvals: ApprovalRequest[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
};

export function ApprovalNavigationProvider({
  children,
  approvals,
  onApprove,
  onReject
}: ApprovalNavigationProviderProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ type: "approve" | "reject"; id: string } | null>(null);

  // Reset index if out of bounds
  useEffect(() => {
    if (selectedIndex >= approvals.length && approvals.length > 0) {
      setSelectedIndex(approvals.length - 1);
    }
  }, [approvals.length, selectedIndex]);

  // Keyboard handler
  useEffect(() => {
    if (!isActive || approvals.length === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }

      const currentApproval = approvals[selectedIndex];
      if (!currentApproval) return;

      switch (e.key.toLowerCase()) {
        case "j":
        case "arrowdown":
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, approvals.length - 1));
          break;
        case "k":
        case "arrowup":
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case " ": // Space to expand/collapse
          e.preventDefault();
          setExpandedId((prev) => (prev === currentApproval.id ? null : currentApproval.id));
          break;
        case "a":
          e.preventDefault();
          if (pendingAction?.id === currentApproval.id && pendingAction.type === "approve") {
            // Confirm
            onApprove(currentApproval.id);
            setPendingAction(null);
          } else {
            // First press - show confirmation
            setPendingAction({ type: "approve", id: currentApproval.id });
          }
          break;
        case "r":
          e.preventDefault();
          if (pendingAction?.id === currentApproval.id && pendingAction.type === "reject") {
            // Confirm
            onReject(currentApproval.id);
            setPendingAction(null);
          } else {
            // First press - show confirmation
            setPendingAction({ type: "reject", id: currentApproval.id });
          }
          break;
        case "enter":
          e.preventDefault();
          if (pendingAction && pendingAction.id === currentApproval.id) {
            if (pendingAction.type === "approve") {
              onApprove(currentApproval.id);
            } else {
              onReject(currentApproval.id);
            }
            setPendingAction(null);
          }
          break;
        case "escape":
          e.preventDefault();
          setPendingAction(null);
          setExpandedId(null);
          break;
        case "g":
          // gg to go to top (double tap)
          e.preventDefault();
          setSelectedIndex(0);
          break;
        case "G":
          // G to go to bottom
          e.preventDefault();
          setSelectedIndex(approvals.length - 1);
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isActive, approvals, selectedIndex, pendingAction, onApprove, onReject]);

  // Clear pending action after timeout
  useEffect(() => {
    if (!pendingAction) return;
    const timer = setTimeout(() => setPendingAction(null), 3000);
    return () => clearTimeout(timer);
  }, [pendingAction]);

  return (
    <ApprovalNavigationContext.Provider
      value={{ selectedIndex, setSelectedIndex, expandedId, setExpandedId, isActive, setIsActive }}
    >
      {children}
      {pendingAction && (
        <div className="keyboard-confirm-toast">
          Press <kbd>{pendingAction.type === "approve" ? "a" : "r"}</kbd> again or <kbd>Enter</kbd> to confirm{" "}
          {pendingAction.type}
        </div>
      )}
    </ApprovalNavigationContext.Provider>
  );
}

// Component to wrap each approval item
type KeyboardApprovalItemProps = {
  index: number;
  approval: ApprovalRequest;
  children: ReactNode;
  onFocus?: () => void;
};

export function KeyboardApprovalItem({ index, approval, children, onFocus }: KeyboardApprovalItemProps) {
  const { selectedIndex, expandedId, isActive, setSelectedIndex, setIsActive } = useApprovalNavigation();
  const isSelected = isActive && selectedIndex === index;
  const isExpanded = expandedId === approval.id;

  const handleClick = useCallback(() => {
    setSelectedIndex(index);
    setIsActive(true);
    onFocus?.();
  }, [index, setSelectedIndex, setIsActive, onFocus]);

  // Extract agent name from taskId
  const agentMatch = approval.taskId.match(/^task-([^-]+)-/);
  const agentName = agentMatch ? agentMatch[1] : "unknown";

  return (
    <div
      className={`keyboard-approval-item ${isSelected ? "keyboard-selected" : ""} ${isExpanded ? "keyboard-expanded" : ""}`}
      onClick={handleClick}
      data-approval-id={approval.id}
      role="option"
      aria-selected={isSelected}
    >
      {children}
      {isExpanded && (
        <div className="keyboard-expanded-details">
          <div className="expanded-detail-row">
            <span className="detail-label">Risk Class:</span>
            <span className="detail-value">{approval.riskClass}</span>
          </div>
          <div className="expanded-detail-row">
            <span className="detail-label">Agent:</span>
            <span className="detail-value">{agentName}</span>
          </div>
          <div className="expanded-detail-row">
            <span className="detail-label">Goal:</span>
            <span className="detail-value">{approval.goalId}</span>
          </div>
          <div className="expanded-detail-row">
            <span className="detail-label">Action:</span>
            <span className="detail-value">{approval.requestedAction}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// Keyboard hint bar for approval section
export function ApprovalKeyboardHints({ isActive }: { isActive: boolean }) {
  if (!isActive) {
    return (
      <div className="keyboard-hints inactive">
        Click an approval or press <kbd>Tab</kbd> to enable keyboard navigation
      </div>
    );
  }

  return (
    <div className="keyboard-hints">
      <span>
        <kbd>j</kbd>/<kbd>k</kbd> navigate
      </span>
      <span>
        <kbd>a</kbd> approve
      </span>
      <span>
        <kbd>r</kbd> reject
      </span>
      <span>
        <kbd>Space</kbd> expand
      </span>
      <span>
        <kbd>Esc</kbd> cancel
      </span>
    </div>
  );
}

// Activation button
export function ActivateKeyboardNav() {
  const { setIsActive, isActive } = useApprovalNavigation();

  return (
    <button
      type="button"
      className={`keyboard-activate-btn ${isActive ? "active" : ""}`}
      onClick={() => setIsActive(!isActive)}
      title={isActive ? "Keyboard navigation active" : "Click to enable keyboard navigation"}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="1" y="4" width="14" height="10" rx="1" stroke="currentColor" strokeWidth="1.5" />
        <rect x="3" y="6" width="2" height="2" fill="currentColor" />
        <rect x="6" y="6" width="2" height="2" fill="currentColor" />
        <rect x="9" y="6" width="2" height="2" fill="currentColor" />
        <rect x="12" y="6" width="1" height="2" fill="currentColor" />
        <rect x="3" y="9" width="1" height="2" fill="currentColor" />
        <rect x="5" y="9" width="6" height="2" fill="currentColor" />
        <rect x="12" y="9" width="1" height="2" fill="currentColor" />
      </svg>
      {isActive ? "⌨️ Active" : "⌨️"}
    </button>
  );
}
