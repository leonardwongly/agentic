"use client";

import { type ReactNode } from "react";

export type BadgeVariant = "default" | "success" | "warning" | "error" | "info" | "muted";
export type BadgeSize = "sm" | "md" | "lg";

const variantStyles: Record<BadgeVariant, string> = {
  default: "badge-default",
  success: "badge-success",
  warning: "badge-warning",
  error: "badge-error",
  info: "badge-info",
  muted: "badge-muted"
};

const sizeStyles: Record<BadgeSize, string> = {
  sm: "badge-sm",
  md: "badge-md",
  lg: "badge-lg"
};

type BadgeProps = {
  children: ReactNode;
  variant?: BadgeVariant;
  size?: BadgeSize;
  className?: string;
  title?: string;
  dot?: boolean;
  count?: number;
  pulse?: boolean;
};

export function Badge({ children, variant = "default", size = "md", className = "", title, dot, count, pulse }: BadgeProps) {
  const classes = ["badge", variantStyles[variant], sizeStyles[size], pulse ? "badge-pulse" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} title={title}>
      {dot && <span className="badge-dot" />}
      {typeof count === "number" && count > 0 && <span className="badge-count">{count > 99 ? "99+" : count}</span>}
      {children}
    </span>
  );
}

export function StatusBadge({ status, children }: { status: string; children?: ReactNode }) {
  const variantMap: Record<string, BadgeVariant> = {
    completed: "success",
    approved: "success",
    active: "success",
    ready: "success",
    "autonomous-grade": "success",
    running: "info",
    "approval-grade": "info",
    pending: "warning",
    waiting: "warning",
    draft: "warning",
    "draft-grade": "warning",
    queued: "warning",
    failed: "error",
    rejected: "error",
    blocked: "error",
    error: "error",
    experimental: "muted",
    disabled: "muted",
    archived: "muted",
    paused: "muted"
  };

  const variant = variantMap[status.toLowerCase()] ?? "default";

  return (
    <Badge variant={variant}>
      {children ?? status}
    </Badge>
  );
}

export function RiskBadge({ riskClass }: { riskClass: string }) {
  const variantMap: Record<string, BadgeVariant> = {
    R1: "success",
    R2: "info",
    R3: "warning",
    R4: "error"
  };

  return (
    <Badge variant={variantMap[riskClass] ?? "default"}>
      {riskClass}
    </Badge>
  );
}
