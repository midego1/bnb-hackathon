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
| CoinMarketCap Pro API | same, `convert=THB` | THB price of USDT and BNB: every amount shown THB first; the THB deposit converted into tokens | `GET /api/price`, `GET /api/risk` |
| Atlas push oracle | SingleFeed `latestRoundData()` (AggregatorV3, 18 decimals), feeds `ATLAS_FEED_BNB_USD`, `ATLAS_FEED_USDT_USD`, optional `ATLAS_FEED_USD_THB` | First price source for display and deposit valuation, with the Atlas staleness check (`updatedAt` older than `ATLAS_MAX_AGE_SECONDS`, default 1 h, or a never-updated feed is rejected); BNB/USD also **guards "Pay with BNB"** (refused beyond 2x its 120 s heartbeat) | `web/lib/server/price` (`readFeed`), `web/lib/server/price/atlas.ts` |
| Atlas Pull API | `POST https://api.atlasoracle.io/report/v1/price/latest` `{feedIds: [633, 649], signed: true}`, header `X-API-KEY` (server-side) | Consensus per feed: Pay with BNB refuses unless BNB/USD is HEALTHY or DEGRADED; the **signed report**, verified against the official signer, is the price proof on AI settlement reports that charge damage | `web/lib/server/price/atlas.ts`, `POST /api/settlement` |
| Cournot (bonus) | `POST /intelligence/v1/probability` | "Will BNB fall below the coverage floor before the return date?" → buffer × (1 + p) | `GET /api/risk`, `POST /api/cournot` |

**Core idea:** CoinMarketCap (and Cournot) decide how much risk a rental carries; Atlas supplies the on-chain price that values the deposit, guards the BNB swap and proves the price behind a damage charge.
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
| Atlas BNB/USD push feed (testnet / mainnet) | `0x3957d289ee9c38272377786787ea34f9dd29788d` / `0x9c0517f5b4c8657c7f18d68d2d79e2b3b1cd6438` |
| Atlas USDT/USD push feed (testnet / mainnet) | `0x9dfd7992952bb9e8fb4bc6065fdc3518addc4e8b` / `0x9fc000fc9c17578b49853278a517e357201d01e4` |
| Atlas Pull API feed ids · official signer | BNB/USD 633, USDT/USD 649 · `0x59eD4701224fD9e2a85Ef2946c2ab828C1dDC600` |
| PancakeSwap V2 router (mainnet "Pay with BNB") | `0x10ED43C718714eb63d5aA57B78B54704E256024E` |
| `AtlasSwapGuard` (testnet "Pay with BNB" demo swap) | _to deploy: `contracts/script/DeployAtlasSwapGuard.s.sol`_ |

## Atlas in the product

1. **Atlas-guarded "Pay with BNB".** A renter without the stablecoin pays the deposit + first rent in BNB: the app
   swaps exactly what is missing. `amountOutMin` = 99 % of the Atlas BNB/USD value of the BNB sent. It fails closed:
   no swap when the push feed is older than 2x its heartbeat, when the Pull API consensus is not HEALTHY/DEGRADED, when
   the signed report does not verify, or when the pool quote is more than 2 % away from Atlas ("Price not trustworthy
   right now"). BSC mainnet swaps on the PancakeSwap V2 router, capped at 1 USDT (the pilot's deposit + rent caps).
   BSC testnet has no PancakeSwap pool for our MockUSDT, so a small, clearly labelled `AtlasSwapGuard` contract stands
   in: same two router functions, sells test BNB for test mUSDT at the Atlas feed price and re-checks staleness on-chain.
2. **Atlas badge.** The money card says "Priced by Atlas · updated N s ago · consensus 0.94 HEALTHY" (push feed +
   Pull API consensus, cached 30 s server-side), in English and Chinese.
3. **Signed price proof on the AI settlement.** When the AI inspection charges damage (priced in USD/THB), the Atlas
   signed BNB/USD + USDT/USD report (payload + signature) is verified server-side (keccak256 of the packages, `ecrecover`
   against the official signer, low-s, as in Atlas's consumer contract) and goes into the hashed settlement report with
   its hash: "Price proof: Atlas signed report 0x…". No contract change.

## Status (be precise for judges)

- Built and tested: CMC volatility buffer + THB conversion (fixture tests; live once `CMC_API_KEY` is set), Atlas push
  read path with staleness check, Atlas Pull API client + signature verification + consensus guard (unit tests with a
  mocked API and a test-key fixture), Pay with BNB (Foundry tests for `AtlasSwapGuard`, Playwright on anvil), call
  logging, `/integrations` evidence page.
- Pending the owner: deploy `AtlasSwapGuard` on BSC testnet (and check the Atlas feed is open-read for a contract, not
  whitelist-only), set `ATLAS_API_KEY`; a live check that real Pull API reports verify against the official signer.

## What we would build next

1. On-chain enforcement: the escrow verifies the Atlas pull report in the funding transaction (Atlas's
   `PullOracleConsumer`) to accept BNB deposits directly; a deposit health check flags under-collateralised rentals and
   asks for a top-up.
2. CMC DEX data (`security_scan`, holder concentration) to screen any extra payment token.
3. CMC Fear & Greed and OHLCV history (paid tier) for a better volatility model than rolling percent changes.
4. Fleet vault yield in THB/USD valued with Atlas.
