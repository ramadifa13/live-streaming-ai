"use client";

import { useState, useEffect, useCallback } from "react";

export interface LiveMetricsData {
  viewers: number;
  comments: number;
  clicks: number;
  sales: number;
  peakViewers?: number;
  durationSeconds?: number;
}

export function useLiveMetrics(isActive: boolean, pollIntervalMs = 4000) {
  const [metrics, setMetrics] = useState<LiveMetricsData>({
    viewers: 0,
    comments: 0,
    clicks: 0,
    sales: 0,
  });

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch("/api/live-session/metrics");
      if (!res.ok) return;
      const data = await res.json();
      if (data?.data) {
        setMetrics({
          viewers: data.data.viewers ?? 0,
          comments: data.data.comments ?? 0,
          clicks: data.data.clicks ?? 0,
          sales: data.data.sales ?? 0,
          peakViewers: data.data.peakViewers ?? 0,
          durationSeconds: data.data.durationSeconds ?? 0,
        });
      }
    } catch {
      // ignore transient network errors
    }
  }, []);

  useEffect(() => {
    if (!isActive) return;
    fetchMetrics();
    const interval = setInterval(fetchMetrics, pollIntervalMs);
    return () => clearInterval(interval);
  }, [isActive, fetchMetrics, pollIntervalMs]);

  return { metrics, refreshMetrics: fetchMetrics };
}
