# CoinMarketCap x Atlas track: price data in KeyEscrow

**TL;DR:**

- KeyEscrow holds rental deposits and rent in a stablecoin on BNB Chain, but landlords and tenants in
  Thailand think in **baht**.
- We use live price data in two places: to show every amount in **THB and USD**, and to convert AI damage
  estimates quoted in THB into a **fair settlement value** in token units.
- Price data is fetched **only on the server**, cached, and backed by a fallback chain. It never gates a
  contract call.

> **Status:** the design below is fixed. The price route (`web/app/api/price`) and the UI that uses it are
> being built (M5/M4). The environment variable names are already in `.env.example`. During the hackathon
> we make no calls to paid APIs. Local runs use a labelled fixture.

## Where price data is used

### 1. THB/USD display

Every amount in the app is stored on-chain in token units (MockUSDT, 6 decimals). The app shows it in three
units:

```
Rent      750.00 mUSDT   ≈ ฿25,500   ≈ $750.00
Deposit 1,500.00 mUSDT   ≈ ฿51,000   ≈ $1,500.00
          rate 1 USDT = 34.00 THB · CoinMarketCap · 2 min ago
```

- **Landlord** creating a lease: they type the rent in THB, the form converts it to token units, and they
  can see exactly what the tenant will pay.
- **Tenant** funding a lease: before signing the funding transaction, they see the deposit plus first
  month in THB.
- **Arbiter:** compares the claim amounts in THB, the currency in which repair quotes are written.
- **Every rate shown** carries its **source and age**. A stale or fallback rate is clearly marked as
  indicative.

### 2. Fair settlement value

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
| 1 | **Atlas on-chain price feed** | USD price of the stablecoin, and THB where the feed offers it | `viem` `readContract` on the feed at `ATLAS_FEED_ADDRESS`, called from the server route. Verifiable on-chain data within the BNB ecosystem. |
| 2 | **CoinMarketCap Pro API** | THB and USD quotes for the stablecoin | Server-side request with `CMC_PRO_API_KEY` sent as the `X-CMC_PRO_API_KEY` header. The quotes endpoint with `convert=THB` / `convert=USD`. |
| 3 | Last good quote | Short outages | In-memory cache, shown as "stale" in the UI. |
| 4 | Fixture | Local dev and the demo without keys | Static rate, always labelled "indicative". |

The route reports the source it used, and the UI shows it.

## Server-side only

- **Keys live only on the server.** `CMC_PRO_API_KEY` is read inside a Next.js route handler on the
  server. It is never a `NEXT_PUBLIC_` variable and never reaches the browser bundle.
  `ATLAS_FEED_ADDRESS` is not a secret, but it is read on the server too, so that the fallback logic stays
  in one place.
- **The browser calls only `/api/price`.** It never calls CoinMarketCap directly, so the key cannot leak
  and the CMC rate limits apply to one server, not to every visitor.
- **The contracts never read a price.** Escrow amounts are fixed in token units when the lease is created.
  A bad price can at worst make a THB label wrong for a few minutes. It cannot move funds. A settlement
  always needs a human on each side to sign, or the arbiter.

## Caching

- An in-memory cache keyed by pair (`USDT/THB`, `USDT/USD`). Every page load and every lease card reads
  the same cached value, so upstream traffic depends on the TTL, not on the number of visitors.
- The TTL is a few minutes and is configurable, so upstream usage stays inside the API plan's credit
  budget. Fiat rates for a stablecoin move slowly, so a few minutes is accurate enough for display.
- **Stale-while-revalidate.** An expired value is served at once, marked with its age, while one
  background refresh runs. Many concurrent requests never trigger many upstream requests.
- A fixed **`maxAge` for settlement.** When the server prepares a proposal, it refuses quotes older than a
  short limit, such as 10 minutes, and refreshes first. A display can tolerate a slightly old rate. A
  report that moves money cannot.

## Fallback

The route tries the sources in order (Atlas → CoinMarketCap → last good quote → fixture) and returns the
first valid one. A quote is valid if it is a positive number, newer than the limit, and within a sanity
band compared with the last good quote. This guards against a broken feed returning 0 or a value 100 times
off. If every live source fails:

- **Display:** shows the last good quote, or the fixture, with an "indicative rate" badge.
- **Settlement:** the AI proposal is still produced in token units, but the report marks the THB conversion
  as unavailable, so the parties can see it. No transaction is blocked: the contracts do not depend on the
  price route.

## Why it matters for the track

Price data is what makes KeyEscrow usable for Thai renters. The escrow can settle in a USD stablecoin while
both parties sign in baht, and the conversion behind every settlement is recorded and can be checked. Both
CoinMarketCap and the Atlas feed are behind one small, cached server endpoint, so the integration is cheap
to run and safe to rely on.
