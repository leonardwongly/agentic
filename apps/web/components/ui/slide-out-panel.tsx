"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type SlideOutPanelProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  width?: "sm" | "md" | "lg" | "xl";
  children: ReactNode;
  footer?: ReactNode;
};

const widthClasses: Record<string, string> = {
  sm: "slideout-sm",
  md: "slideout-md",
  lg: "slideout-lg",
  xl: "slideout-xl"
};

export function SlideOutPanel({ isOpen, onClose, title, subtitle, width = "md", children, footer }: SlideOutPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Handle Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Focus trap
  useEffect(() => {
    if (!isOpen || !panelRef.current) return;

    const focusableElements = panelRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    window.addEventListener("keydown", handleTabKey);
    firstElement?.focus();

    return () => window.removeEventListener("keydown", handleTabKey);
  }, [isOpen]);

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="slideout-overlay" onClick={onClose}>
      <div
        ref={panelRef}
        className={`slideout-panel ${widthClasses[width]}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="slideout-title"
      >
        <div className="slideout-header">
          <div>
            <h2 id="slideout-title" className="slideout-title">{title}</h2>
            {subtitle && <p className="slideout-subtitle">{subtitle}</p>}
          </div>
          <button type="button" className="slideout-close" onClick={onClose} aria-label="Close panel">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="slideout-content">
          {children}
        </div>
        {footer && <div className="slideout-footer">{footer}</div>}
      </div>
    </div>
  );
}
