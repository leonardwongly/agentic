"use client";

import { useCallback, useEffect, useState } from "react";

type DeepLinkState = {
  section?: string;
  filter?: string;
  item?: string;
  panel?: string;
};

function parseUrlState(): DeepLinkState {
  if (typeof window === "undefined") return {};
  
  const params = new URLSearchParams(window.location.search);
  return {
    section: params.get("section") || undefined,
    filter: params.get("filter") || undefined,
    item: params.get("item") || undefined,
    panel: params.get("panel") || undefined
  };
}

function buildUrl(state: DeepLinkState): string {
  const params = new URLSearchParams();
  
  if (state.section) params.set("section", state.section);
  if (state.filter) params.set("filter", state.filter);
  if (state.item) params.set("item", state.item);
  if (state.panel) params.set("panel", state.panel);
  
  const queryString = params.toString();
  const base = window.location.pathname;
  return queryString ? `${base}?${queryString}` : base;
}

export function useDeepLink() {
  const [state, setState] = useState<DeepLinkState>({});

  useEffect(() => {
    setState(parseUrlState());

    const handlePopState = () => {
      setState(parseUrlState());
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const updateState = useCallback((updates: Partial<DeepLinkState>, replace = false) => {
    const newState = { ...state, ...updates };
    
    // Remove undefined values
    const cleanState = Object.fromEntries(
      Object.entries(newState).filter(([, v]) => v !== undefined)
    ) as DeepLinkState;
    
    setState(cleanState);
    
    const url = buildUrl(cleanState);
    if (replace) {
      window.history.replaceState(cleanState, "", url);
    } else {
      window.history.pushState(cleanState, "", url);
    }
  }, [state]);

  const setSection = useCallback((section: string | undefined) => {
    updateState({ section, item: undefined, panel: undefined });
  }, [updateState]);

  const setFilter = useCallback((filter: string | undefined) => {
    updateState({ filter }, true);
  }, [updateState]);

  const setItem = useCallback((item: string | undefined, panel?: string) => {
    updateState({ item, panel });
  }, [updateState]);

  const clearState = useCallback(() => {
    setState({});
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const getShareableUrl = useCallback(() => {
    return window.location.origin + buildUrl(state);
  }, [state]);

  return {
    state,
    setSection,
    setFilter,
    setItem,
    clearState,
    getShareableUrl
  };
}

type DeepLinkSectionProps = {
  id: string;
  activeSection?: string;
  onActivate?: () => void;
  children: React.ReactNode;
};

export function DeepLinkSection({
  id,
  activeSection,
  onActivate,
  children
}: DeepLinkSectionProps) {
  useEffect(() => {
    if (activeSection === id) {
      // Scroll to section
      const element = document.getElementById(`section-${id}`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "start" });
        onActivate?.();
      }
    }
  }, [activeSection, id, onActivate]);

  return <>{children}</>;
}

type ShareLinkButtonProps = {
  getUrl: () => string;
  label?: string;
};

export function ShareLinkButton({ getUrl, label = "Copy link" }: ShareLinkButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(getUrl());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const url = getUrl();
      const textArea = document.createElement("textarea");
      textArea.value = url;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [getUrl]);

  return (
    <button
      type="button"
      className="share-link-button"
      onClick={handleCopy}
    >
      {copied ? "✓ Copied!" : label}
    </button>
  );
}
