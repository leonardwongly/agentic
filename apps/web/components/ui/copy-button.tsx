"use client";

import { useState, useCallback } from "react";

type CopyButtonProps = {
  value: string;
  label?: string;
  className?: string;
  size?: "sm" | "md";
};

export function CopyButton({ value, label, className = "", size = "sm" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [value]);

  const sizeClass = size === "sm" ? "copy-btn-sm" : "copy-btn-md";

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`copy-btn ${sizeClass} ${copied ? "copy-btn-copied" : ""} ${className}`}
      title={copied ? "Copied!" : label ?? "Copy to clipboard"}
      aria-label={copied ? "Copied!" : label ?? "Copy to clipboard"}
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M13.5 4.5L6 12L2.5 8.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="5" y="5" width="9" height="9" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M11 5V3a2 2 0 0 0-2-2H3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )}
      {label && <span className="copy-btn-label">{copied ? "Copied!" : label}</span>}
    </button>
  );
}

export function CopyableText({ value, className = "" }: { value: string; className?: string }) {
  return (
    <span className={`copyable-text ${className}`}>
      <code>{value}</code>
      <CopyButton value={value} size="sm" />
    </span>
  );
}
