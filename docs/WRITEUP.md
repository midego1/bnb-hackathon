# KeyEscrow: CoinMarketCap x Atlas write-up (one page)

**Team:** KeyEscrow · contact: hackathon@vanpeltventures.org (team names: _owner to fill in_) · repo: this repository · demo: `/integrations` and the owner/renter rental pages.

## Problem and audience

Tourists renting scooters in Thailand leave their passport as a deposit and face bogus damage claims at return;
shop owners face real damage with no proof. KeyEscrow holds rent and deposit in a per-rental escrow contract on
BNB Chain and settles the deposit from an AI photo inspection. The audience is small rental shops (owners), tourists
and expats (renters), and later fleet investors. Everyone thinks in **baht**, while the deposit sits in a token, so
the deposit must keep covering a THB repair bill for the whole rental. That is a risk problem, and it needs market data.

## Data used, and why

| Source | Endpoint / feed | Used for | Where |
|---|---|---|---|
| CoinMarketCap Pro API | `GET /v2/cryptocurrency/quotes/latest?symbol=USDT,BNB&convert=USD` | `percent_change_24h/7d/30d` → daily volatility per payment token → **deposit risk buffer** (stablecoin 0 %, BNB ≈ 15–25 % for 30 days, > 60 % rejected) | `web/lib/risk.ts`, `web/lib/server/risk`, `GET /api/risk` |
| CoinMarketCap Pro API | same, `convert=THB` | THB price of USDT and BNB: every amount shown THB first; the THB deposit converted into tokens | `GET /api/price`, `GET /api/risk` |
| Atlas push oracle | SingleFeed `latestRoundData()` (AggregatorV3), feeds `ATLAS_FEED_BNB_USD`, `ATLAS_FEED_USDT_USD`, optional `ATLAS_FEED_USD_THB` | First price source for display and deposit valuation, with the Atlas staleness check (`updatedAt` older than `ATLAS_MAX_AGE_SECONDS`, default 1 h, or a never-updated feed is rejected) | `web/lib/server/price` (`readFeed`) |
| Cournot (bonus) | `POST /intelligence/v1/probability` | "Will BNB fall below the coverage floor before the return date?" → buffer × (1 + p) | `GET /api/risk`, `POST /api/cournot` |

**Core idea:** CoinMarketCap (and Cournot) decide how much risk a rental carries; Atlas supplies the on-chain price that values the deposit.
All calls are server-side (keys never reach the browser) and every call is logged with endpoint, time, HTTP status and
CMC `credit_count` (never the key) to `web/.sponsor-logs/*.jsonl` and shown on `/integrations`.

## BNB Chain contracts and data (BSC testnet, chain 97)

| Contract | Address |
|---|---|
| EscrowFactory | `0xd33b4dfF8C09e0079918fD987953c8f65F1363D8` |
| RentalEscrow implementation (EIP-1167 clones per rental) | `0x63f174fE3E80442c95b82a811a7D0d13f34D2314` |
| MockUSDT (test stablecoin, 6 decimals) | `0x46e69984A52233980F1CAeABB4571555e4c8fE37` |
| FleetVault (BKK-FLEET-1 shares) | `0xd046308Bf53752B79B9d62cD206fA0eB6a824ecB` |
| ERC-8004 Identity Registry (inspector agent #2921) | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| Atlas feeds | _not yet: Atlas publishes no BSC testnet feed addresses; to be filled in at the venue_ |

## Status (be precise for judges)

- Built and tested: CMC volatility buffer + THB conversion (fixture tests; live once `CMC_API_KEY` is set), Atlas read
  path with staleness check (unit-tested with a fake feed), call logging, `/integrations` evidence page.
- Pending the owner: a CMC key (live calls), Atlas BSC testnet feed addresses (and whitelisting if a contract reads them).

## What we would build next

1. On-chain enforcement: the escrow reads the Atlas BNB/USD feed at funding to convert the THB deposit into BNB and
   rejects stale prices; a deposit health check flags under-collateralised rentals and asks for a top-up.
2. CMC DEX data (`security_scan`, holder concentration) to screen any extra payment token.
3. CMC Fear & Greed and OHLCV history (paid tier) for a better volatility model than rolling percent changes.
4. Fleet vault yield in THB/USD valued with Atlas.
