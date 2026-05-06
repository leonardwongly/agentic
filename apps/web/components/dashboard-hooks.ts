"use client";

import { useCallback, useState } from "react";
import type { DashboardData } from "@agentic/repository";
import { loadDashboardSnapshot as fetchDashboardSnapshot } from "./dashboard-async";

export function useDashboardSnapshot(initialData: DashboardData) {
  const [data, setData] = useState(initialData);

  const loadDashboardSnapshot = useCallback(async () => {
    return fetchDashboardSnapshot();
  }, []);

  return {
    data,
    setData,
    loadDashboardSnapshot
  };
}
