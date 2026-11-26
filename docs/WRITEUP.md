English | [简体中文](WRITEUP.zh-CN.md)

# KeyScrow: CoinMarketCap x Atlas write-up (one page)

**Team:** KeyScrow · contact: hackathon@vanpeltventures.org (team names: _owner to fill in_) · repo: this repository · demo: `/integrations` and the owner/renter rental pages.

## Problem and audience

Tourists renting scooters in Thailand leave their passport as a deposit and face bogus damage claims at return;
shop owners face real damage with no proof. KeyScrow holds rent and deposit in a per-rental escrow contract on
BNB Chain and settles the deposit from an AI photo inspection. The audience is small rental shops (owners), tourists
and expats (renters), and later fleet investors. Everyone thinks in **baht**, while the deposit sits in a token, so
the deposit must keep covering a THB repair bill for the whole rental. That is a risk problem, and it needs market data.

## Data used, and why

| Source | Endpoint / feed | Used for | Where |
|---|---|---|---|
| CoinMarketCap Pro API | `GET /v2/cryptocurrency/quotes/latest?symbol=USDT,BNB&convert=USD` | `percent_change_24h/7d/30d` → daily volatility per payment token → **deposit risk buffer** (stablecoin 0 %, BNB ≈ 15–25 % for 30 days, > 60 % rejected) | `web/lib/risk.ts`, `web/lib/server/risk`, `GET /api/risk` |
| CoinMarketCap Pro API | same, `convert=THB` | THB price of USDT and BNB: every amount shown THB first; the THB deposit converted into tokens; the USD price fallback when Atlas fails | `GET /api/price`, `GET /api/risk` |
| Atlas push oracle | SingleFeed `decimals()` + `latestRoundData()` (AggregatorV3, 18 decimals), feeds `ATLAS_FEED_BNB_USD`, `ATLAS_FEED_USDT_USD` | **First USD price source** for display and deposit valuation (`GET /api/price` answers `"source":"atlas"`), with the Atlas staleness check: a never-updated feed or an answer older than `ATLAS_MAX_AGE_SECONDS` (default 1 h; the USDT feed's 24 h heartbeat is allowed up to 25 h) is rejected and CoinMarketCap takes over | `web/lib/server/price` (`readFeed`, `fetchAtlas`) |
| Cournot (bonus) | `POST /intelligence/v1/probability` | "Will BNB fall below the coverage floor before the return date?" → buffer × (1 + p) | `GET /api/risk`, `POST /api/cournot` |

**Core idea:** CoinMarketCap (and Cournot) decide how much risk a rental carries; Atlas supplies the on-chain price that values the deposit.
All calls are server-side (keys never reach the browser) and every call is logged with endpoint, time, HTTP status and
CMC `credit_count` (never the key) to `web/.sponsor-logs/*.jsonl` and shown on `/integrations`.

## BNB Chain contracts and data (BSC testnet, chain 97)

`EscrowFactory`, the `RentalEscrow` implementation (EIP-1167 clones per rental), `MockUSDT` (test stablecoin) and
`FleetVault` (BKK-FLEET-1 shares), verified on BscScan: addresses in the
[README contract table](../README.md#bsc-testnet-contracts-chain-97), from
[contracts/deployments/97.json](../contracts/deployments/97.json).

| Also used | Address |
|---|---|
| ERC-8004 Identity Registry (inspector agent #2921) | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| Atlas BNB/USD feed, BSC testnet (heartbeat 60 s) | [`0x3957d289ee9c38272377786787ea34f9dd29788d`](https://testnet.bscscan.com/address/0x3957d289ee9c38272377786787ea34f9dd29788d) |
| Atlas USDT/USD feed, BSC testnet (heartbeat 24 h) | [`0x9dfd7992952bb9e8fb4bc6065fdc3518addc4e8b`](https://testnet.bscscan.com/address/0x9dfd7992952bb9e8fb4bc6065fdc3518addc4e8b) |
| Atlas BNB/USD feed, BSC mainnet (mainnet pilot site; heartbeat 60 s) | [`0x9c0517f5b4c8657c7f18d68d2d79e2b3b1cd6438`](https://bscscan.com/address/0x9c0517f5b4c8657c7f18d68d2d79e2b3b1cd6438) |
| Atlas USDT/USD feed, BSC mainnet (mainnet pilot site; heartbeat 24 h) | [`0x9fc000fc9c17578b49853278a517e357201d01e4`](https://bscscan.com/address/0x9fc000fc9c17578b49853278a517e357201d01e4) |

## Status (be precise for judges)

- Live on the testnet site and the mainnet pilot site: the Atlas push feeds above are the first USD price source
  (`GET /api/price` → `"source":"atlas"`); CoinMarketCap is live as the fallback, the THB rate and the deposit volatility
  buffer. Every call shows on `/integrations` and `/sponsors`.
- Built and tested: the Atlas read path with the staleness check (unit tests with fake 8- and 18-decimal feeds), the CMC
  volatility buffer and THB conversion (fixture tests), call logging.
- Not yet: the Atlas Pull API (signed reports with a `consensusScore`): our key is available, no code calls it yet. The
  contracts read no price at all (they hold a stablecoin).

## What we would build next

1. On-chain enforcement: the escrow reads the Atlas BNB/USD feed at funding to convert the THB deposit into BNB and
   rejects stale prices; a deposit health check flags under-collateralised rentals and asks for a top-up.
2. CMC DEX data (`security_scan`, holder concentration) to screen any extra payment token.
3. CMC Fear & Greed and OHLCV history (paid tier) for a better volatility model than rolling percent changes.
4. Fleet vault yield in THB/USD valued with Atlas.
