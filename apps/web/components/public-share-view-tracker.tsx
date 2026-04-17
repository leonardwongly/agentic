"use client";

import { useEffect } from "react";

type PublicShareViewTrackerProps = {
  token: string;
};

export function PublicShareViewTracker({ token }: PublicShareViewTrackerProps) {
  useEffect(() => {
    const controller = new AbortController();

    // Share rendering must stay resilient even if best-effort view tracking fails.
    void fetch("/api/share/view", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ token }),
      cache: "no-store",
      keepalive: true,
      signal: controller.signal
    }).catch(() => {});

    return () => {
      controller.abort();
    };
  }, [token]);

  return null;
}
