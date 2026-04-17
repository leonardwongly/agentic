"use client";

import { useEffect, useRef } from "react";

type CoreLoopViewTrackerProps = {
  workspaceId: string | null;
};

export function CoreLoopViewTracker({ workspaceId }: CoreLoopViewTrackerProps) {
  const lastTrackedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const storageKey = `agentic:core-loop-view:${workspaceId ?? "none"}`;

    if (lastTrackedKeyRef.current === storageKey) {
      return;
    }

    lastTrackedKeyRef.current = storageKey;

    try {
      if (window.sessionStorage.getItem(storageKey) === "tracked") {
        return;
      }

      window.sessionStorage.setItem(storageKey, "tracked");
    } catch {
      return;
    }

    void fetch("/api/dashboard/core-loop", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        event: "dashboard_view"
      })
    }).catch(() => undefined);
  }, [workspaceId]);

  return null;
}
