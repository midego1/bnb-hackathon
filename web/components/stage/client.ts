"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { decodeJson, eventsOfLease, fetchChainIndex } from "@/lib/chainIndex";
import type { StageStatus } from "@/lib/stage";

/** Browser side of /api/stage/<slug>: one status poll shared by the phone and the big screen, and the POST actions. */

export async function stageAction<T = unknown>(slug: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`/api/stage/${slug}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) {
    let msg = `The server did not answer (HTTP ${res.status}). Try again.`;
    try {
      msg = (JSON.parse(text) as { error?: string }).error ?? msg;
    } catch {}
    throw new Error(msg);
  }
  return decodeJson<T>(text);
}

/**
 * Polls the stage status every `everyMs` (default 2 s). Keeps the last good answer through network hiccups and says so
 * (`offline`), so a flaky venue Wi-Fi freezes the screen instead of blanking it.
 */
export function useStageStatus(slug: string, renter?: Address, everyMs = 2_000) {
  const [status, setStatus] = useState<StageStatus>();
  const [error, setError] = useState<string>();
  const [offline, setOffline] = useState(false);
  const fails = useRef(0);
  const last = useRef<StageStatus>(undefined);
  const tick = useCallback(async () => {
    try {
      const qs = renter ? `?renter=${renter}` : "";
      const res = await fetch(`/api/stage/${slug}${qs}`, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
      const text = await res.text();
      if (!res.ok) throw new Error((JSON.parse(text) as { error?: string }).error ?? `HTTP ${res.status}`);
      const next = decodeJson<StageStatus>(text);
      // The rental's events (with tx hashes) come from the shared, cached chain index; keep the last ones on a hiccup.
      if (next.rental) {
        const lease = next.rental.lease;
        next.events = await fetchChainIndex(next.chainId)
          .then((ix) => eventsOfLease(ix.events, lease))
          .catch(() => (last.current?.rental?.lease === lease ? last.current.events : []));
      }
      last.current = next;
      setStatus(next);
      setError(undefined);
      fails.current = 0;
      setOffline(false);
    } catch (e) {
      fails.current++;
      if (fails.current >= 2) setOffline(true);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [slug, renter]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      await tick();
      if (alive) timer = setTimeout(loop, everyMs);
    };
    loop();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [tick, everyMs]);

  // The phone's chooser switches the slug: never show the last item's answer under the new one.
  return { status: status?.listing.slug === slug ? status : undefined, error, offline, refresh: tick };
}
