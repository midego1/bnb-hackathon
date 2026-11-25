"use client";

import { withSample } from "@/lib/actions/definitions";
import { latestLease } from "@/lib/chainIndex";
import { useChainIndex } from "@/lib/hooks/useChainIndex";

/**
 * One /developers curl example. The definitions' examples hold anvil's seeded rental; this swaps in the newest rental
 * of the active chain (from the chain index) so a copied example never points at a rental of an older deployment.
 */
export function CurlExample({ path, method, example }: { path: string; method: string; example: Record<string, unknown> }) {
  const { data: sample } = useChainIndex(latestLease);
  const input = withSample(example, sample);
  const text =
    method === "GET"
      ? `curl -s "${path}?${new URLSearchParams(Object.entries(input).map(([k, v]) => [k, String(v)])).toString()}"`
      : `curl -s -X POST "${path}" \\\n  -H 'content-type: application/json' \\\n  -d '${JSON.stringify(input)}'`;
  return <pre className="mt-3 overflow-x-auto rounded-xl bg-surface-muted p-3 text-xs">{text}</pre>;
}
