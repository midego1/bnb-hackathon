# HackQuest submission fields

Ready to paste into the BNB Bangkok (HackQuest) form. Deadline: **Fri 27 Nov 2026, 09:00 ICT**.
Tracks: **Developer Track**, **CoinMarketCap x Atlas**, **ChatAndBuild / Living Brain**, **Cournot** and the **AWS startup
pitch** (one card per track with its live state: <https://keyscrow.app/sponsors>). State checked on the
live sites on 26 Nov 2026.

## Project name

KeyScrow

## One-liner (≤ 100 characters)

Rent a motorbike in Thailand without leaving your passport: the deposit sits in escrow on BNB Chain.

## Short description (≤ 300 characters)

Thai motorbike rental shops keep your passport as the deposit and alone decide what each scratch costs. KeyScrow holds the
deposit in its own contract on BNB Chain, one per rental. An AI inspector drafts the split; both sides agree or a
dispute desk rules.

## Long description

**Problem.** Rent a motorbike in Thailand and the shop usually keeps your passport, or a stack of cash, as the deposit.
At return the shop alone decides what every scratch costs, and the renter pays or does not get the passport back.
Shops have the opposite problem: real damage and no proof beyond a few chat photos. Nobody neutral sits in between,
and nobody goes to court over a few thousand baht.

**Solution.** KeyScrow replaces the passport with a deposit held in a small smart contract on BNB Chain, one contract
per rental (an EIP-1167 clone). The renter funds deposit plus the first month's rent; rent is paid out to the shop
month by month. The rental agreement and guided pickup photos stay off-chain, and only their SHA-256 fingerprints go
on-chain. At return, the KeyScrow Inspector (an ERC-8004 agent, #2921) compares pickup and return photos and drafts
a split with reasons. One party proposes it on-chain with the report hash, the other accepts, and one transaction pays
everyone. If they disagree, a neutral dispute desk rules within 14 days. If the owner ignores a proposal for 7 days,
or the desk misses its deadline, the full deposit goes back to the renter. Neither party can move the deposit alone,
and there is no admin key over funds. Every amount is shown in baht first.

**What is live.** Contracts on BSC testnet, plus a capped pilot on BSC mainnet with real BSC-USD (at most 1 USD per
rental, enforced by the factory); the web app and the agent on Cloudflare Workers. `/demo` plays a whole
rental with real BSC testnet transactions and no wallet (server-side demo wallets, gas-capped). Roles in one app:
renter, fleet owner, shareholders (Fleet Vault), back office and dispute desk. Every rental action is one definition
served as REST (OpenAPI 3.1), as MCP tools on the agent and as the app's form validation; `prepare_*` actions return
unsigned, simulated transactions, so KeyScrow never holds a user key. An in-app assistant (Ask AI) uses the same
actions and shows an approval card before any change.

**Business model.** 10 % of one month's rent, once per rental, taken from the owner's first rent payout and never
from the deposit (a ฿3,400/month scooter pays ฿340 once). Rentals can pay into a Fleet Vault, whose operator takes a
maintenance fee (10 % on testnet, capped at 30 %) before BKK-FLEET-1 shareholders claim the rest. The dispute desk as
a paid service is planned.

**Honest status.** BSC testnet with test money, plus the mainnet pilot capped at 1 USD per rental and 5 USD in total;
no token, no real users yet. On <https://keyscrow.app> the AI inspection runs a vision LLM (Claude, `claude-sonnet-5-5`
by default) on the pickup and return photos. The deterministic *demo inspector* returns the same JSON instead, and the
report says so and why, when the model is busy or out of credit, the server's daily cap of AI inspections (300) is
used up, the photos are not on the server, or the model's answer is unusable.
The Fleet Vault is a testnet prototype and not an offer of securities.

## How it uses BNB Chain

- **One escrow per rental on BSC testnet.** `EscrowFactory` deploys a 45-byte EIP-1167 clone of `RentalEscrow` for
  every rental. Funds are isolated per rental, nothing is upgradeable, and the factory indexes rentals by owner,
  renter and dispute desk on-chain, so the app needs no backend database to list them.
- **On-chain AI agent.** The KeyScrow Inspector is ERC-8004 agent **#2921** in the Identity Registry on BSC testnet,
  registered with the BNB Agent SDK. Its id goes into every report hash passed to `RentalEscrow.propose()`. It speaks
  A2A and MCP (17 tools).
- **Real-world assets.** Scooters earn rent; with `createLeaseWithPayee`, rent and damage payouts flow into a
  `FleetVault` (BKK-FLEET-1 shares) on BSC testnet.
- **BNB Greenfield for evidence.** Photos and the agreement are stored off-chain and only their hashes go on-chain.
  The Greenfield store (`@bnb-chain/greenfield-js-sdk`, delegated upload) is used when configured on a Node server;
  the Cloudflare deploy uses R2 or hashes the files in the browser.
- **Mainnet pilot on BSC.** Factory [`0x8d708713C2a9da93450F224f35eF7FA15c0a2d3E`](https://bscscan.com/address/0x8d708713C2a9da93450F224f35eF7FA15c0a2d3E)
  on chain 56 with real BSC-USD, on-chain caps of 0.70 deposit + 0.30 rent per period (max 1 USD a rental) and 5 USD
  across all open rentals; no Fleet Vault on mainnet. Site: <https://mainnet.keyscrow.app>.
- **opBNB-ready.** Plain Solidity, same bytecode; the deploy guard accepts opBNB testnet (5611) and the app lists it.
  Not deployed on opBNB yet.

## CoinMarketCap x Atlas usage

What is **built** (in the repo, tested) versus what is **live** on the deployed site today:

| Source | What it does in KeyScrow | Status on the live site (26 Nov) |
| --- | --- | --- |
| CoinMarketCap Pro API `GET /v2/cryptocurrency/quotes/latest?symbol=USDT,BNB&convert=USD` | 24h/7d/30d percent changes → daily volatility → the **deposit risk buffer** (stablecoin 0 %, BNB moderate, > 60 % rejected). Server-side only, cached, every call logged (endpoint, status, credits, never the key) and shown on `/integrations`. | **Live.** `CMC_API_KEY` is set on the live site; every call shows on `/integrations`. |
| CoinMarketCap Pro API, same endpoint with `convert=THB` | THB price of USDT and BNB: every amount shown in baht first; the USD fallback when Atlas fails. | **Live.** |
| Atlas push oracle, SingleFeed `latestRoundData()` | First price source for THB/USD amounts, with Atlas's staleness check (never-updated, negative or older than `ATLAS_MAX_AGE_SECONDS` is rejected); BNB/USD also guards Pay with BNB (refused beyond 2x its heartbeat). | **Live** on the testnet site and the mainnet pilot site: BSC push feeds BNB/USD + USDT/USD (18 decimals), `GET /api/price` returns `"source":"atlas"`. Feed addresses in [WRITEUP.md](../WRITEUP.md#bnb-chain-contracts-and-data-bsc-testnet-chain-97). |
| Atlas Pull API, `POST /report/v1/price/latest` (feeds 633, 649, signed) | Consensus guard for Pay with BNB (refused unless HEALTHY/DEGRADED, or when the swap quote is more than 2 % off Atlas; amountOutMin = 99 % of the Atlas value), the "Priced by Atlas" badge, and the signed report (verified against the official signer) as the price proof on AI settlements that charge damage. | **Live** on <https://keyscrow.app>: real signed reports verify against the official signer (`GET /api/price` → `atlas.ok: true`, consensus HEALTHY); Pay with BNB on testnet swaps through `AtlasSwapGuard` [`0xD26dBba1eE904c95d3467F479FC4410b0400b6bA`](https://testnet.bscscan.com/address/0xD26dBba1eE904c95d3467F479FC4410b0400b6bA). The mainnet pilot site has no Pull API key, so Pay with BNB is refused there. |

The contracts themselves never read a price: they hold a stablecoin, so a price-feed outage cannot move funds. The
one-page write-up is [docs/WRITEUP.md](../WRITEUP.md); every CMC call is logged on `/integrations`.

## Other sponsor tracks

| Track | What KeyScrow does | State (26 Nov) |
| --- | --- | --- |
| ChatAndBuild / Living Brain | The inspector reads each scooter's damage history before judging, so old scratches are never charged twice; after every settled rental each wallet gets one factual dispute-memory entry, shown on the dispute desk. The demo world's shops and renters come with histories. | **Live** on the testnet site; the mainnet pilot site runs without it |
| Cournot | A prediction-market probability that BNB falls below a threshold before the return date raises the deposit buffer; the exact claim and the evidence are shown. | **Built**, waiting for a partner key (no live call yet) |
| AWS startup pitch | A fee from day one (10 % of one month's rent, once per rental) and a roadmap from a testnet pilot to mainnet, asset pools, opBNB and native apps ([BUSINESS.md](../BUSINESS.md)). | Pitch |

Not entered: Four.meme / OpenFour (no testnet; KeyScrow has no token of its own) and Flap.

## Tech stack

- **Contracts:** Solidity 0.8.28, Foundry, OpenZeppelin (`Clones`, `SafeERC20`, `ReentrancyGuardTransient`,
  `Ownable2Step`). 314 tests including fuzz and invariants. Internal pre-audit review in [docs/SECURITY.md](../SECURITY.md).
- **Web:** Next.js (App Router), TypeScript, Tailwind, wagmi/viem, RainbowKit, on Cloudflare Workers (OpenNext)
  with one Durable Object for shared state. Vitest (558 tests in 40 files) and Playwright (154 tests in 27 spec files on a throwaway anvil). The web Worker is 2.89 MiB
  gzip (Free plan limit 3 MiB).
- **Agent:** TypeScript, ERC-8004 identity via the BNB Agent SDK, A2A + MCP (Streamable HTTP), Node server and
  Cloudflare Worker. 24 tests.
- **iOS:** a native SwiftUI app on the same REST API ([ios/](../../ios)).
- **AI:** a vision LLM (Claude) for the return inspection, live on keyscrow.app, with the deterministic demo inspector
  as the labelled fallback (and without a key); Ask AI on Claude
  (Anthropic SDK), with an offline demo model.
- **Data:** CoinMarketCap Pro API, Atlas push oracle, Cournot Intelligence Oracle, Living Brain memory (each with a
  labelled fallback). BNB Greenfield, R2 or local disk for evidence.
- **CI:** GitHub Actions: contracts, web, agent and end-to-end, with no secrets and no testnet.
- **Size:** ~74,000 lines of code and ~5,300 lines of Markdown docs (tracked files, without lockfiles, `contracts/lib`,
  generated ABIs, JSON data and binaries).
- **Built with Claude Code:** ≈2.68 billion tokens in total (8.74M output, 10,441 messages), on paseo-box + 10 boat
  VMs, counted from the Claude Code transcripts on 26 Nov at ~19:00 ICT.

## Links

| What | Link |
| --- | --- |
| Live app (landing, BSC testnet) | <https://keyscrow.app> |
| Mainnet pilot (BSC, max 1 USD per rental) | <https://mainnet.keyscrow.app> |
| Sponsor tracks with live state | <https://keyscrow.app/sponsors> |
| Split screen: renter phone + rental company | <https://keyscrow.app/duo/mystery-box> |
| App home | <https://keyscrow.app/app> |
| Live testnet demo (no wallet) | <https://keyscrow.app/demo> |
| 1-minute cartoon (ELI5) | <https://keyscrow.app/how-it-works> |
| Developers (REST, MCP, OpenAPI) | <https://keyscrow.app/developers> |
| AI inspector agent (ERC-8004 #2921) | <https://agent.keyscrow.app> |
| Repo | <https://github.com/midego1/bnb-hackathon> |
| Video (hero): `/duo` full run, renter phone left, rental company right (59 s) | [duo.mp4](duo.mp4) · [webm](duo.webm) |
| Video: `/demo` guided one-click run (90 s) | [demo-guided.mp4](demo-guided.mp4) · [webm](demo-guided.webm) |
| Video: app tour, landing to Ask AI (77 s) | [tour.mp4](tour.mp4) · [webm](tour.webm) |
| Video: ELI5 cartoon, happy ending (71 s) | [eli5.mp4](eli5.mp4) · [webm](eli5.webm) |
| Pitch deck (11 slides, slide 4 is the iOS app) | [deck.pdf](deck.pdf) (source: [deck.html](deck.html)) |
| Screenshots | [screenshots/](screenshots/) |

The videos were recorded on a local anvil chain with the seeded demo world (same build as the live site). Upload the
MP4s to YouTube or similar if the form wants a URL; GitHub links to these files also play in the browser.

### Contracts on BscScan (BSC testnet, chain 97)

Paste the contract table from the [README](../../README.md#bsc-testnet-contracts-chain-97) when you fill in the form:
it is the one place with the current addresses (contract v2, deployed Thu 26 Nov).

| Also on BscScan | Address |
| --- | --- |
| ERC-8004 Identity Registry (agent #2921) | [`0x8004A818BFB912233c491871b3d84c89A494BD9e`](https://testnet.bscscan.com/address/0x8004A818BFB912233c491871b3d84c89A494BD9e) · [registration tx](https://testnet.bscscan.com/tx/0x40c7cf2008857eabb197df1453e33b3b45760fdec8e7f846ac23a4c2e73328c0) |
| Mainnet pilot `EscrowFactory` (BSC, chain 56) | [`0x8d708713C2a9da93450F224f35eF7FA15c0a2d3E`](https://bscscan.com/address/0x8d708713C2a9da93450F224f35eF7FA15c0a2d3E) |

## What's next

1. **Testnet pilot (Q1 2027):** 10–20 real rentals with friendly shops in Chiang Mai and Phuket; tune the inspector
   on real photos; staff the dispute desk; evidence on Greenfield in production; an independent contract review.
2. **Market data on-chain:** Atlas Pull API signed reports (with `consensusScore`) verified in the contract, then
   on-chain enforcement (the escrow reads the Atlas feed at funding and rejects stale prices).
3. **Mainnet on BSC and opBNB (Q2–Q3 2027), past the 1 USD pilot cap:** asset pools, native apps, a widely held stablecoin, embedded wallets for non-crypto renters,
   legal review under Thai law, a keeper for monthly rent releases.
4. **Shops and partners:** fleet tools as a B2B subscription, rental associations as named arbiters, booking sites
   and AI travel agents through the MCP / REST actions. Insurance priced from inspection history after mainnet.

Full roadmap: [docs/BUSINESS.md](../BUSINESS.md#roadmap).

## 3-minute demo script

[docs/DEMO.md](../DEMO.md), "The 3-minute script": the live site on BSC testnet, `/how-it-works`, then `/demo` in
Guided, step-by-step mode, with a 30-second offline backup on a local chain.

## Team and contact

KeyScrow team · hackathon@vanpeltventures.org · team names: _owner to fill in before submitting_.
