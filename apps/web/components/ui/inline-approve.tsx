"use client";

import { useState, useCallback } from "react";
import type { ApprovalRequest } from "@agentic/contracts";

// Inline approval actions - approve/reject from toasts, floating bar, or inline

type InlineApproveProps = {
  approval: ApprovalRequest;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  variant?: "compact" | "full" | "toast";
  disabled?: boolean;
  className?: string;
};

export function InlineApprove({
  approval,
  onApprove,
  onReject,
  variant = "compact",
  disabled = false,
  className = ""
}: InlineApproveProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [action, setAction] = useState<"approve" | "reject" | null>(null);

  const handleApprove = useCallback(async () => {
    if (isProcessing || disabled) return;
    setIsProcessing(true);
    setAction("approve");
    try {
      await onApprove(approval.id);
    } finally {
      setIsProcessing(false);
      setAction(null);
    }
  }, [approval.id, onApprove, isProcessing, disabled]);

  const handleReject = useCallback(async () => {
    if (isProcessing || disabled) return;
    setIsProcessing(true);
    setAction("reject");
    try {
      await onReject(approval.id);
    } finally {
      setIsProcessing(false);
      setAction(null);
    }
  }, [approval.id, onReject, isProcessing, disabled]);

  if (approval.decision !== "pending") {
    return (
      <span className={`inline-approve-status ${approval.decision}`}>
        {approval.decision === "approved" ? "✓ Approved" : "✗ Rejected"}
      </span>
    );
  }

  if (variant === "toast") {
    return (
      <div className={`inline-approve-toast ${className}`}>
        <span className="inline-approve-title">{approval.title}</span>
        <div className="inline-approve-actions">
          <button
            type="button"
            className="inline-approve-btn approve"
            onClick={handleApprove}
            disabled={isProcessing || disabled}
          >
            {action === "approve" ? "..." : "✓"}
          </button>
          <button
            type="button"
            className="inline-approve-btn reject"
            onClick={handleReject}
            disabled={isProcessing || disabled}
          >
            {action === "reject" ? "..." : "✗"}
          </button>
        </div>
      </div>
    );
  }

  if (variant === "full") {
    return (
      <div className={`inline-approve-full ${className}`}>
        <div className="inline-approve-header">
          <span className="inline-approve-title">{approval.title}</span>
          <span className={`inline-approve-risk ${approval.riskClass}`}>
            {approval.riskClass}
          </span>
        </div>
        <p className="inline-approve-rationale">{approval.rationale}</p>
        <p className="inline-approve-action">{approval.requestedAction}</p>
        <div className="inline-approve-buttons">
          <button
            type="button"
            className="inline-approve-button approve"
            onClick={handleApprove}
            disabled={isProcessing || disabled}
          >
            {action === "approve" ? "Approving..." : "Approve"}
          </button>
          <button
            type="button"
            className="inline-approve-button reject"
            onClick={handleReject}
            disabled={isProcessing || disabled}
          >
            {action === "reject" ? "Rejecting..." : "Reject"}
          </button>
        </div>
      </div>
    );
  }

  // Compact variant (default)
  return (
    <div className={`inline-approve-compact ${className}`}>
      <button
        type="button"
        className="inline-approve-btn approve"
        onClick={handleApprove}
        disabled={isProcessing || disabled}
        title="Approve"
      >
        {action === "approve" ? "⏳" : "✓"}
      </button>
      <button
        type="button"
        className="inline-approve-btn reject"
        onClick={handleReject}
        disabled={isProcessing || disabled}
        title="Reject"
      >
        {action === "reject" ? "⏳" : "✗"}
      </button>
    </div>
  );
}

// Hook for managing inline approvals across multiple components
export function useInlineApprovals() {
  const [pendingApprovals, setPendingApprovals] = useState<Set<string>>(new Set());

  const approve = useCallback(async (id: string, handler: (id: string) => Promise<void>) => {
    setPendingApprovals(prev => new Set(prev).add(id));
    try {
      await handler(id);
    } finally {
      setPendingApprovals(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const reject = useCallback(async (id: string, handler: (id: string) => Promise<void>) => {
    setPendingApprovals(prev => new Set(prev).add(id));
    try {
      await handler(id);
    } finally {
      setPendingApprovals(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const isProcessing = useCallback((id: string) => pendingApprovals.has(id), [pendingApprovals]);

  return { approve, reject, isProcessing, pendingCount: pendingApprovals.size };
}

// Floating approval bar component
type FloatingApprovalBarProps = {
  approvals: ApprovalRequest[];
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onApproveAll?: () => Promise<void>;
  isVisible?: boolean;
  className?: string;
};

export function FloatingApprovalBar({
  approvals,
  onApprove,
  onReject,
  onApproveAll,
  isVisible = true,
  className = ""
}: FloatingApprovalBarProps) {
  const pending = approvals.filter(a => a.decision === "pending");
  const [isExpanded, setIsExpanded] = useState(false);

  if (!isVisible || pending.length === 0) {
    return null;
  }

  return (
    <div className={`floating-approval-bar ${isExpanded ? "expanded" : ""} ${className}`}>
      <div className="floating-approval-header">
        <button
          type="button"
          className="floating-approval-toggle"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <span className="floating-approval-badge">{pending.length}</span>
          <span>Pending Approval{pending.length !== 1 ? "s" : ""}</span>
          <span className="floating-approval-arrow">{isExpanded ? "▼" : "▲"}</span>
        </button>
        {onApproveAll && pending.length > 1 && (
          <button type="button" className="floating-approval-all" onClick={onApproveAll}>
            Approve All
          </button>
        )}
      </div>

      {isExpanded && (
        <div className="floating-approval-list">
          {pending.slice(0, 5).map(approval => (
            <InlineApprove
              key={approval.id}
              approval={approval}
              onApprove={onApprove}
              onReject={onReject}
              variant="toast"
            />
          ))}
          {pending.length > 5 && (
            <div className="floating-approval-more">
              +{pending.length - 5} more
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Approval notification toast
type ApprovalToastProps = {
  approval: ApprovalRequest;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onDismiss: () => void;
  autoHideMs?: number;
};

export function ApprovalToast({
  approval,
  onApprove,
  onReject,
  onDismiss,
  autoHideMs = 10000
}: ApprovalToastProps) {
  const [isVisible, setIsVisible] = useState(true);

  // Auto-hide after delay
  useState(() => {
    if (autoHideMs > 0) {
      const timer = setTimeout(() => {
        setIsVisible(false);
        onDismiss();
      }, autoHideMs);
      return () => clearTimeout(timer);
    }
  });

  if (!isVisible) return null;

  return (
    <div className="approval-toast">
      <div className="approval-toast-content">
        <span className="approval-toast-icon">⚠️</span>
        <div className="approval-toast-text">
          <span className="approval-toast-title">{approval.title}</span>
          <span className="approval-toast-action">{approval.requestedAction}</span>
        </div>
      </div>
      <InlineApprove
        approval={approval}
        onApprove={async (id) => {
          await onApprove(id);
          setIsVisible(false);
          onDismiss();
        }}
        onReject={async (id) => {
          await onReject(id);
          setIsVisible(false);
          onDismiss();
        }}
        variant="compact"
      />
      <button type="button" className="approval-toast-dismiss" onClick={onDismiss}>
        ✕
      </button>
    </div>
  );
}
