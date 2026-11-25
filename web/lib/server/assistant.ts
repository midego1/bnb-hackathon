import type { EngineDeps } from "@/lib/assistant/engine";
import type { LeaseSnapshot } from "@/lib/actions/lease";
import { dailyTokenLimit, TokenBudget } from "@/lib/assistant/limits";
import { modelFromEnv, resolveModel } from "@/lib/assistant/model";
import { casStore, type AssistantStore } from "@/lib/assistant/store";
import { webActionHost } from "@/lib/server/actions";
import { cloudflareBinding } from "@/lib/server/platform";
import { getSharedState } from "@/lib/server/state";

/** Ask AI's store on the shared state: a Map under Node, the KeyEscrowState Durable Object on Workers. */
export function assistantStore(): AssistantStore {
  return casStore(getSharedState());
}

/**
 * The web app's Ask AI host: the same action host as /api/v1, the model from server env (ANTHROPIC_API_KEY, never
 * NEXT_PUBLIC_; the demo model without it), the shared state, and inspect_return through this app's own
 * POST /api/settlement (called over fetch, so the assistant's Worker chunk does not carry a second copy of it).
 * Built per request; `origin` is the request's own origin.
 */
export function assistantDeps(origin: string, env: Record<string, string | undefined> = process.env): EngineDeps {
  const store = assistantStore();
  return {
    store,
    model: modelFromEnv(env),
    modelFor: (requested) => ({ model: modelFromEnv(env, requested), refused: resolveModel(requested, env).refused }),
    host: webActionHost(),
    budget: new TokenBudget(store, dailyTokenLimit(env)),
    inspect: async (lease: LeaseSnapshot) => {
      // On Workers a WORKER_SELF_REFERENCE service binding (if configured) reaches this same Worker directly.
      const self = cloudflareBinding<{ fetch: typeof fetch }>("WORKER_SELF_REFERENCE");
      const res = await (self ? self.fetch.bind(self) : fetch)(new URL("/api/settlement", origin), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deposit: lease.terms.depositAmount.toString(),
          decimals: 6,
          currency: "USDT",
          checkIn: [{ hash: lease.checkInHash }],
          checkOut: [{ hash: lease.checkOutHash }],
          scooterId: lease.address,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `the inspector answered ${res.status}`);
      return body;
    },
  };
}
