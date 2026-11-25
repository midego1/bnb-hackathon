"use client";

import { useQuery } from "@tanstack/react-query";
import type { RiskResponse } from "./risk";

/** GET /api/risk for a THB deposit over a rental length (server caches CMC quotes ~2 min). */
export function useRisk(depositThb: number | null, days: number) {
  return useQuery({
    queryKey: ["risk", depositThb && Math.round(depositThb), days],
    enabled: !!depositThb && depositThb > 0 && days > 0,
    queryFn: async (): Promise<RiskResponse> => {
      const res = await fetch(`/api/risk?depositThb=${Math.round(depositThb!)}&days=${Math.round(days)}`);
      if (!res.ok) throw new Error(`risk API ${res.status}`);
      return res.json();
    },
    staleTime: 60_000,
  });
}
