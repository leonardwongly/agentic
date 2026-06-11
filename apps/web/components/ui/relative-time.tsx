"use client";

import { useEffect, useMemo, useState } from "react";

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
  return date.toLocaleString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function parseTimeValue(date: string | Date): Date | null {
  const parsed = typeof date === "string" ? new Date(date) : date;
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function RelativeTime({ date, className = "" }: RelativeTimeProps) {
  const dateObj = useMemo(() => parseTimeValue(date), [date]);

  if (!dateObj) {
    return <span className={`relative-time ${className}`}>Invalid timestamp</span>;
  }

  return <RelativeTimeValue date={dateObj} className={className} />;
}

function RelativeTimeValue({ date, className }: { date: Date; className: string }) {
  const stableAbsolute = useMemo(() => date.toISOString(), [date]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setIsHydrated(true);
    const interval = window.setInterval(() => {
      setTick((current) => current + 1);
    }, 30_000);

    return () => window.clearInterval(interval);
  }, []);

  const relative = useMemo(() => (isHydrated ? formatRelativeTime(date) : stableAbsolute), [date, isHydrated, stableAbsolute, tick]);
  const absolute = useMemo(() => (isHydrated ? formatAbsoluteTime(date) : stableAbsolute), [date, isHydrated, stableAbsolute]);

  return (
    <time dateTime={date.toISOString()} title={absolute} className={`relative-time ${className}`}>
      {relative}
    </time>
  );
}

export function AbsoluteTime({ date, className = "" }: RelativeTimeProps) {
  const dateObj = useMemo(() => parseTimeValue(date), [date]);

  if (!dateObj) {
    return <span className={`absolute-time ${className}`}>Invalid timestamp</span>;
  }

  return <AbsoluteTimeValue date={dateObj} className={className} />;
}

function AbsoluteTimeValue({ date, className }: { date: Date; className: string }) {
  const stableAbsolute = useMemo(() => date.toISOString(), [date]);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  const absolute = useMemo(() => (isHydrated ? formatAbsoluteTime(date) : stableAbsolute), [date, isHydrated, stableAbsolute]);

  return (
    <time dateTime={date.toISOString()} className={`absolute-time ${className}`}>
      {absolute}
    </time>
  );
}
