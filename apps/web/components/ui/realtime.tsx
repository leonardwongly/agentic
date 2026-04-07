"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type RealtimeEvent<T = unknown> = {
  type: string;
  data: T;
  timestamp: string;
};

type UseRealtimeOptions = {
  endpoint: string;
  onEvent?: (event: RealtimeEvent) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
};

export function useRealtime<T = unknown>({
  endpoint,
  onEvent,
  onConnect,
  onDisconnect,
  onError,
  reconnectInterval = 3000,
  maxReconnectAttempts = 10
}: UseRealtimeOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<RealtimeEvent<T> | null>(null);
  const [events, setEvents] = useState<RealtimeEvent<T>[]>([]);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource(endpoint);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setIsConnected(true);
      setReconnectAttempts(0);
      onConnect?.();
    };

    eventSource.onmessage = (e) => {
      try {
        const event: RealtimeEvent<T> = JSON.parse(e.data);
        setLastEvent(event);
        setEvents((prev) => [...prev.slice(-99), event]);
        onEvent?.(event as RealtimeEvent);
      } catch {
        // Ignore parse errors for heartbeat/keepalive messages
      }
    };

    eventSource.onerror = () => {
      setIsConnected(false);
      eventSource.close();
      onDisconnect?.();

      if (reconnectAttempts < maxReconnectAttempts) {
        reconnectTimeoutRef.current = setTimeout(() => {
          setReconnectAttempts((prev) => prev + 1);
          connect();
        }, reconnectInterval);
      } else {
        onError?.(new Error("Max reconnection attempts reached"));
      }
    };
  }, [endpoint, onConnect, onDisconnect, onError, onEvent, reconnectAttempts, reconnectInterval, maxReconnectAttempts]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsConnected(false);
  }, []);

  const clearEvents = useCallback(() => {
    setEvents([]);
    setLastEvent(null);
  }, []);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return {
    isConnected,
    lastEvent,
    events,
    reconnectAttempts,
    clearEvents,
    reconnect: connect,
    disconnect
  };
}

export type LiveCounter = {
  value: number;
  previousValue: number;
  isIncreasing: boolean;
  isDecreasing: boolean;
  lastUpdated: Date | null;
};

export function useLiveCounter(initialValue: number): LiveCounter & { update: (value: number) => void } {
  const [state, setState] = useState<LiveCounter>({
    value: initialValue,
    previousValue: initialValue,
    isIncreasing: false,
    isDecreasing: false,
    lastUpdated: null
  });

  const update = useCallback((newValue: number) => {
    setState((prev) => ({
      value: newValue,
      previousValue: prev.value,
      isIncreasing: newValue > prev.value,
      isDecreasing: newValue < prev.value,
      lastUpdated: new Date()
    }));
  }, []);

  return { ...state, update };
}

export function useLiveIndicator(isActive: boolean) {
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (isActive) {
      setPulse(true);
      const timeout = setTimeout(() => setPulse(false), 300);
      return () => clearTimeout(timeout);
    }
  }, [isActive]);

  return pulse;
}

type PollingOptions<T> = {
  fetcher: () => Promise<T>;
  interval: number;
  enabled?: boolean;
  onSuccess?: (data: T) => void;
  onError?: (error: Error) => void;
};

export function usePolling<T>({ fetcher, interval, enabled = true, onSuccess, onError }: PollingOptions<T>) {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    if (!enabled) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await fetcher();
      setData(result);
      setLastFetched(new Date());
      onSuccess?.(result);
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Polling failed");
      setError(error);
      onError?.(error);
    } finally {
      setIsLoading(false);
    }
  }, [enabled, fetcher, onSuccess, onError]);

  useEffect(() => {
    fetchData();

    if (enabled && interval > 0) {
      const intervalId = setInterval(fetchData, interval);
      return () => clearInterval(intervalId);
    }
  }, [fetchData, enabled, interval]);

  return { data, isLoading, error, lastFetched, refetch: fetchData };
}

export function LiveDot({ active, pulse }: { active: boolean; pulse?: boolean }) {
  return (
    <span className={`live-dot ${active ? "live-dot-active" : ""} ${pulse ? "live-dot-pulse" : ""}`} />
  );
}
