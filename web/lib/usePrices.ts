"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { formatTokenInFiat, type Fiat, type PricedAsset, type PriceResponse } from "./fiat";

async function fetchPrices(): Promise<PriceResponse> {
  const res = await fetch("/api/price");
  if (!res.ok) throw new Error(`price API ${res.status}`);
  return res.json();
}

/**
 * Fiat prices from /api/price (server caches upstream for 60 s, the Atlas guard data 30 s; we refetch every 30 s).
 * `format(amount, asset)` -> "฿16,500 · $500.00".
 */
export function usePrices() {
  const query = useQuery({
    queryKey: ["prices"],
    queryFn: fetchPrices,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const prices = query.data;
  const format = useCallback(
    (amount: bigint | number | string, asset: PricedAsset = "USDT", fiats?: Fiat[]) =>
      formatTokenInFiat(amount, asset, prices, fiats),
    [prices],
  );
  return { prices, isMock: prices?.mock ?? false, format, isLoading: query.isLoading, error: query.error };
}
