# CoinMarketCap x Atlas track: price data in KeyEscrow

**TL;DR:**

- KeyEscrow holds rental deposits and rent in a stablecoin on BNB Chain, but landlords and tenants in
  Thailand think in **baht**.
- We use live price data in two places: to show every amount in **THB and USD**, and to convert AI damage
  estimates quoted in THB into a **fair settlement value** in token units.
- Price data is fetched **only on the server**, cached, and backed by a fallback chain. It never gates a
  contract call.

> **Status:**
>
> - **On `main`:** `GET /api/price` (Atlas feeds → CoinMarketCap → last good quote → static demo rates), cached
>   in memory, and a UI that shows every amount THB first, then USD and the exact USDT, with a source badge:
>   **Atlas feed**, **Live CoinMarketCap** or **Demo rates** (plus *stale* when a live source just failed).
> - **Roadmap:** typing the rent in THB on the create form, and the THB "fair settlement value" conversion in
>   the AI report (section 2 below).
>
> During the hackathon we make no calls to paid APIs. Local runs and the demo use the labelled demo rates.

## Where price data is used

### 1. THB/USD display

Every amount in the app is stored on-chain in token units (MockUSDT, 6 decimals). The app shows it in three
units:

```
Rent / month   ฿14,559                      [● Live CoinMarketCap]
               $441.18 · 441.18 USDT
Deposit        ฿29,118
               $882.36 · 882.36 USDT
```

Running text (timeline, fee note, proposals) uses the short form `฿14,559 ($441.18)`. Hovering an amount shows
the exact on-chain USDT and the rate source; hovering the badge shows the source, its update time and any
warning.

- **Landlord** creating a lease: they type the rent and deposit in USDT and see the THB and USD value live
  underneath, plus the one-time fee in THB. (Typing the rent in THB directly is on the roadmap.)
- **Tenant** funding a lease: before signing the funding transaction, they see the deposit plus first
  month in THB.
- **Dispute desk:** compares the claim amounts in THB, the currency in which repair quotes are written.
- **Every rate shown** carries its **source and age** in the badge. Fallback rates read *Demo rates*; a live
  source that just failed adds *stale*.

### 2. Fair settlement value (roadmap)

The AI inspection estimates damage in THB, for example "repaint living-room wall ≈ ฿3,000", because that is
how Bangkok contractors quote. To turn this into an on-chain proposal, the server:

1. Fetches the current THB-per-USDT quote.
2. Converts each line item, then caps the total `landlordClaim` at the deposit
   (`tenantRefund = deposit − landlordClaim`).
3. Writes the quote into the inspection report JSON as `{source, pair, rate, timestamp}`, next to
   `reasons[]`.
4. Hashes the report. The hash goes on-chain as `reportHash` in `propose()`.

This makes the conversion **auditable**. Either party, or the arbiter, can open the report, see which rate
turned ฿3,000 into how many tokens, and check the report against the on-chain hash. Neither side can later
claim the rate was invented.

## Sources

| Order | Source | Used for | How |
| --- | --- | --- | --- |
| 1 | **Atlas on-chain price feed** | USD price of USDT and BNB, and THB where a USD/THB feed is set | `viem` `readContract` (AggregatorV3 `latestRoundData()`) on `ATLAS_FEED_USDT_USD`, `ATLAS_FEED_BNB_USD` and optionally `ATLAS_FEED_USD_THB` via `ATLAS_RPC_URL`, from the server route. Verifiable on-chain data within the BNB ecosystem. |
| 2 | **CoinMarketCap Pro API** | THB and USD quotes for USDT and BNB | Server-side request with `CMC_API_KEY` (alias `CMC_PRO_API_KEY`) sent as the `X-CMC_PRO_API_KEY` header. The quotes endpoint with `convert=USD` and `convert=THB`. |
| 3 | Last good quote | Short outages | In-memory cache, badge shows *stale*. |
| 4 | Static demo rates | Local dev and the demo without keys | Fixed rates, always labelled *Demo rates*. |

The route reports the source it used, and the UI shows it.

## Server-side only

- **Keys live only on the server.** `CMC_API_KEY` is read inside a Next.js route handler on the
  server. It is never a `NEXT_PUBLIC_` variable and never reaches the browser bundle.
  The `ATLAS_*` feed addresses are not secret, but they are read on the server too, so that the fallback logic
  stays in one place.
- **The browser calls only `/api/price`.** It never calls CoinMarketCap directly, so the key cannot leak
  and the CMC rate limits apply to one server, not to every visitor.
- **The contracts never read a price.** Escrow amounts are fixed in token units when the lease is created.
  A bad price can at worst make a THB label wrong for a few minutes. It cannot move funds. A settlement
  always needs a human on each side to sign, or the arbiter.

## Caching

- One in-memory quote (USDT and BNB in USD and THB). Every page load and every lease card reads the same
  cached value, and the browser refetches once a minute, so upstream traffic depends on the TTL, not on the
  number of visitors.
- The TTL is `PRICE_CACHE_TTL_SECONDS` (default 60 s). One CoinMarketCap refresh costs 2 credits, so the
  default stays inside a free plan's budget. Fiat rates for a stablecoin move slowly.
- **In-flight de-duplication.** Concurrent requests after expiry share one upstream fetch.
- **Stale on error.** If every live source fails, the last good live quote is served with a warning before
  falling back to demo rates.
- **Roadmap: a `maxAge` for settlement.** When the server prepares a THB-based proposal (section 2), it will
  refuse quotes older than a short limit and refresh first. A display can tolerate a slightly old rate; a
  report that moves money cannot.

## Fallback

The route tries the sources in order (Atlas → CoinMarketCap → last good quote → demo rates) and returns the
first valid one. An Atlas answer of zero or below is rejected. (A sanity band against the last good quote, to
catch a feed that is 100 times off, is on the roadmap.) If every live source fails:

- **Display:** shows the last good quote with a *stale* badge, or the demo rates with a *Demo rates* badge.
- **Settlement:** the AI proposal is produced in token units and does not depend on the price route, so no
  transaction is blocked. (Once the THB conversion of section 2 lands, the report will mark it as unavailable.)

## Why it matters for the track

Price data is what makes KeyEscrow usable for Thai renters. The escrow can settle in a USD stablecoin while
both parties sign in baht, and the conversion behind every settlement is recorded and can be checked. Both
CoinMarketCap and the Atlas feed are behind one small, cached server endpoint, so the integration is cheap
to run and safe to rely on.
