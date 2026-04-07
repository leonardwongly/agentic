"use client";

import { useCallback, useEffect, useState } from "react";

type FocusModeProps = {
  isActive: boolean;
  sectionId: string;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  actions?: React.ReactNode;
};

export function FocusMode({
  isActive,
  sectionId,
  title,
  onClose,
  children,
  actions
}: FocusModeProps) {
  useEffect(() => {
    if (isActive) {
      document.body.style.overflow = "hidden";
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          onClose();
        }
      };
      document.addEventListener("keydown", handleEscape);
      return () => {
        document.body.style.overflow = "";
        document.removeEventListener("keydown", handleEscape);
      };
    }
  }, [isActive, onClose]);

  if (!isActive) return null;

  return (
    <div className="focus-mode-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="focus-mode-container">
        <header className="focus-mode-header">
          <h2>{title}</h2>
          <div className="focus-mode-header-actions">
            {actions}
            <button
              type="button"
              className="focus-mode-close"
              onClick={onClose}
              aria-label="Exit focus mode"
            >
              <span>Exit</span>
              <kbd>Esc</kbd>
            </button>
          </div>
        </header>
        <div className="focus-mode-content" data-section={sectionId}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function useFocusMode() {
  const [focusedSection, setFocusedSection] = useState<{
    id: string;
    title: string;
  } | null>(null);

  const enterFocus = useCallback((id: string, title: string) => {
    setFocusedSection({ id, title });
  }, []);

  const exitFocus = useCallback(() => {
    setFocusedSection(null);
  }, []);

  return {
    focusedSection,
    isInFocusMode: focusedSection !== null,
    enterFocus,
    exitFocus
  };
}

type FocusModeButtonProps = {
  sectionId: string;
  sectionTitle: string;
  onEnterFocus: (id: string, title: string) => void;
};

export function FocusModeButton({ sectionId, sectionTitle, onEnterFocus }: FocusModeButtonProps) {
  return (
    <button
      type="button"
      className="focus-mode-button"
      onClick={() => onEnterFocus(sectionId, sectionTitle)}
      title="Enter focus mode"
      aria-label={`Focus on ${sectionTitle}`}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
