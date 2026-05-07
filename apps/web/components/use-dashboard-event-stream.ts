"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import type { DashboardData } from "@agentic/repository";
import {
  connectDashboardEventStream,
  createInitialDashboardEventStreamState,
  type DashboardEventStreamState
} from "./dashboard-async";

type DashboardEventStreamSyncOptions = {
  loadDashboardSnapshot: () => Promise<{ dashboard: DashboardData }>;
  setData: (data: DashboardData) => void;
  updateStats: () => void;
};

export function formatDashboardFreshnessLabel(state: DashboardEventStreamState): string {
  if (state.freshness === "live") {
    return `live #${state.lastSequence}`;
  }

  return state.freshness.replaceAll("_", " ");
}

export function useDashboardEventStreamSync(options: DashboardEventStreamSyncOptions) {
  const optionsRef = useRef(options);
  const [streamState, setStreamState] = useState(() => createInitialDashboardEventStreamState());
  const [summary, setSummary] = useState("Connecting dashboard event stream.");

  optionsRef.current = options;

  useEffect(() => {
    const close = connectDashboardEventStream({
      onBatch: (batch) => {
        const eventCount = batch.events.length;
        const latestSequence = batch.events.at(-1)?.sequence ?? 0;
        setSummary(
          eventCount > 0
            ? `${eventCount} event${eventCount === 1 ? "" : "s"} through #${latestSequence}.`
            : "Event stream is live; no dashboard changes in the latest batch."
        );

        if (eventCount === 0) {
          return;
        }

        void optionsRef.current.loadDashboardSnapshot()
          .then((payload) => {
            startTransition(() => {
              optionsRef.current.setData(payload.dashboard);
              optionsRef.current.updateStats();
            });
          })
          .catch(() => {
            setSummary("Event stream is live, but the dashboard snapshot refresh failed.");
          });
      },
      onFreshnessChange: setStreamState
    });

    return close;
  }, []);

  useEffect(() => {
    if (streamState.freshness !== "fallback") {
      return;
    }

    let cancelled = false;
    let timeout: number | null = null;
    let delayMs = 2_000;

    const poll = async () => {
      try {
        const payload = await optionsRef.current.loadDashboardSnapshot();

        if (cancelled) {
          return;
        }

        startTransition(() => {
          optionsRef.current.setData(payload.dashboard);
          optionsRef.current.updateStats();
        });
        setSummary("Fallback polling refreshed the dashboard snapshot.");
        delayMs = 2_000;
      } catch {
        if (!cancelled) {
          setSummary(`Fallback polling retrying in ${Math.round(delayMs / 1000)}s.`);
        }
        delayMs = Math.min(delayMs * 2, 30_000);
      }

      if (!cancelled) {
        timeout = window.setTimeout(poll, delayMs);
      }
    };

    timeout = window.setTimeout(poll, delayMs);

    return () => {
      cancelled = true;
      if (timeout) {
        window.clearTimeout(timeout);
      }
    };
  }, [streamState.freshness]);

  return {
    streamState,
    summary
  };
}
