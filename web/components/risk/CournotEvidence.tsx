"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ActionButton, Notice } from "@/components/ui";
import type { CournotStoredResult, CournotView } from "@/lib/risk";

const pct = (p: number) => `${(p * 100).toFixed(1)}%`;

/** Cournot claim, returned probability and evidence (verbatim), with our own explanation clearly labelled. */
export function CournotEvidence({ view, cmcBuffer, cournotBuffer }: { view: CournotView; cmcBuffer?: number; cournotBuffer?: number }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = view.result;

  async function ask() {
    if (!view.claim) return;
    if (!window.confirm(`Ask Cournot live?\n\n"${view.claim}"\n\nThis uses one of the 3 free Cournot calls for this server's IP.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/cournot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ claim: view.claim, confirm: true }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Cournot ${res.status}`);
      await qc.invalidateQueries({ queryKey: ["risk"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border p-4 text-sm" data-testid="cournot-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">Cournot Intelligence Oracle</p>
        <span className="text-xs text-subtle">{r ? `${r.source === "live" ? "live call" : "stored answer"} · ${new Date(r.at).toUTCString()}` : "no answer yet"}</span>
      </div>
      {r ? (
        <>
          <p className="mt-2 text-xs text-subtle">Claim evaluated (exact text sent)</p>
          <p className="font-medium" data-testid="cournot-claim">&ldquo;{r.claim}&rdquo;</p>
          {r.marketTitle && <p className="mt-1 text-xs text-subtle">Reference market: {r.marketTitle}</p>}
          <p className="mt-2">
            Probability returned: <span className="text-lg font-semibold tabular-nums" data-testid="cournot-probability">{pct(r.probability)}</span>
          </p>
          <ResultFields result={r.result} />
          <Basis basis={r.basis} />
          <p className="mt-2 text-xs text-subtle">Request id: <span className="font-mono">{r.requestId}</span></p>
        </>
      ) : (
        <p className="mt-2 text-muted-foreground">
          No Cournot answer is stored yet, so the buffer uses CoinMarketCap volatility alone. {view.live === "enabled" ? "Ask Cournot below." : "Live calls are off on this server (start it with COURNOT_LIVE=1)."}
        </p>
      )}
      {r && cmcBuffer !== undefined && cmcBuffer > 0 && (
        <div className="mt-3 rounded-lg bg-muted p-3 text-xs" data-testid="cournot-explanation">
          <p className="font-semibold">Explanation added by KeyEscrow (not from Cournot)</p>
          <p className="mt-1 text-muted-foreground">
            The BNB buffer of {pct(cmcBuffer)} from CoinMarketCap volatility is scaled by (1 + {pct(r.probability)}), adding {pct(cournotBuffer ?? 0)}:
            the more likely BNB falls through the coverage floor before the return date, the larger the deposit.
          </p>
        </div>
      )}
      {view.claim && view.claim !== r?.claim && (
        <p className="mt-3 text-xs text-subtle">
          Claim for this rental: &ldquo;{view.claim}&rdquo;{r ? " (the buffer uses the latest stored answer above until this one is asked)" : ""}
        </p>
      )}
      {view.live === "enabled" && view.claim && view.claim !== r?.claim && (
        <ActionButton variant="secondary" className="mt-2" busy={busy} onClick={ask} data-testid="cournot-ask">
          Ask Cournot (live, uses 1 free call)
        </ActionButton>
      )}
      {error && <div className="mt-2"><Notice kind="error">{error}</Notice></div>}
    </div>
  );
}

function ResultFields({ result }: { result: CournotStoredResult["result"] }) {
  if (!result) return null;
  const entries = Object.entries(result);
  if (!entries.length) return null;
  return (
    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
      {entries.map(([k, v]) => (
        <div key={k}>
          <dt className="text-subtle">{k}</dt>
          <dd className="font-mono">{fmt(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Evidence ("basis") rendered verbatim, section by section, as the Cournot skill requires. */
function Basis({ basis }: { basis: unknown }) {
  if (basis == null || (Array.isArray(basis) && !basis.length) || (typeof basis === "object" && !Object.keys(basis as object).length)) {
    return <p className="mt-2 text-xs text-subtle">Cournot returned no external data basis.</p>;
  }
  const sections: [string, unknown][] = Array.isArray(basis) ? [["basis", basis]] : Object.entries(basis as Record<string, unknown>);
  return (
    <div className="mt-3 space-y-2" data-testid="cournot-basis">
      <p className="text-xs font-semibold">External data basis (from Cournot, verbatim)</p>
      {sections.map(([name, value]) => (
        <div key={name} className="overflow-x-auto">
          <p className="text-xs text-subtle">{name}</p>
          <Table value={value} />
        </div>
      ))}
    </div>
  );
}

function Table({ value }: { value: unknown }) {
  const rows: Record<string, unknown>[] = Array.isArray(value)
    ? value.map((v) => (v && typeof v === "object" ? (v as Record<string, unknown>) : { value: v }))
    : value && typeof value === "object"
      ? [value as Record<string, unknown>]
      : [{ value }];
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return (
    <table className="w-full text-left text-xs">
      <thead>
        <tr>{cols.map((c) => <th key={c} className="border-b border-border px-1 py-0.5 font-medium">{c}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>{cols.map((c) => <td key={c} className="border-b border-border px-1 py-0.5 align-top">{fmt(r[c])}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

function fmt(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
