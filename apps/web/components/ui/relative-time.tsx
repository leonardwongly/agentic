"use client";

import { useMemo } from "react";

type RelativeTimeProps = {
  date: string | Date;
  className?: string;
};

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  const diffWeek = Math.floor(diffDay / 7);
  const diffMonth = Math.floor(diffDay / 30);
  const diffYear = Math.floor(diffDay / 365);

  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay === 1) return "yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffWeek < 4) return `${diffWeek}w ago`;
  if (diffMonth < 12) return `${diffMonth}mo ago`;
  return `${diffYear}y ago`;
}

function formatAbsoluteTime(date: Date): string {
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function RelativeTime({ date, className = "" }: RelativeTimeProps) {
  const dateObj = useMemo(() => (typeof date === "string" ? new Date(date) : date), [date]);
  const relative = useMemo(() => formatRelativeTime(dateObj), [dateObj]);
  const absolute = useMemo(() => formatAbsoluteTime(dateObj), [dateObj]);

  return (
    <time dateTime={dateObj.toISOString()} title={absolute} className={`relative-time ${className}`}>
      {relative}
    </time>
  );
}

export function AbsoluteTime({ date, className = "" }: RelativeTimeProps) {
  const dateObj = useMemo(() => (typeof date === "string" ? new Date(date) : date), [date]);
  const absolute = useMemo(() => formatAbsoluteTime(dateObj), [dateObj]);

  return (
    <time dateTime={dateObj.toISOString()} className={`absolute-time ${className}`}>
      {absolute}
    </time>
  );
}
