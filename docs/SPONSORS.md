# Sponsor tracks and requirements

What each prize we enter requires. Product scope is in [PRODUCT.md](PRODUCT.md); the definition
of done is in [ACCEPTANCE.md](ACCEPTANCE.md).

## Accounts and registration

Register every sponsor account with **hackathon@vanpeltventures.org**: CoinMarketCap (API key), Atlas (feed onboarding /
whitelisting), Cournot (prepaid key or wallet account, if ever needed), ChatAndBuild / Living Brain (API key),
AWS (Activate) and HackQuest (project submission). One shared address keeps keys, quotas and sponsor emails in
one inbox. Keys go only in untracked env files (`web/.env.local`), never in the repo.

## Tracks we enter

| Track | Prize | Entering |
|---|---|---|
| Developer Track | 10,000 USD | Yes |
| CoinMarketCap x Atlas Challenge | 10,000 USD + perks | Yes |
| ChatAndBuild / Living Brain | in-kind, ~5,000 USD | Yes |
| Cournot | 2,000 USDT | Yes |
| AWS credits (startup pitch session) | AWS credits | Yes |
| Flap | | **No** |
| Four.meme / OpenFour | | **No** |

---

## Developer Track (10,000 USD)

- Must be built on BNB Chain.
- Focus themes: real-world assets (RWA) and on-chain AI agents.
- We hit both: scooters as RWA, the inspector as an on-chain AI agent.

---

## CoinMarketCap x Atlas Challenge (10,000 USD + perks)

**Brief:** a trading, risk, or on-chain finance tool for BNB Chain using CMC data, Atlas data, or both.

### Eligibility (pass/fail)

- At least one data source in a **core** feature.
  - CMC: at least one live Pro API call, directly or via its MCP server.
  - Atlas: read an on-chain feed or call the Atlas API.
  - Meaningful use of **both** is rewarded.
- Deploy on BNB Chain or use BNB Chain data (testnet OK, mainnet bonus).
- Working data calls demonstrated; judges get repo access.

### Submit

- Repo + README with setup instructions.
- Live demo or video, **≤ 3 minutes**.
- One-page write-up:
  - problem and audience;
  - endpoints/feeds used and why;
  - BNB Chain contract addresses and/or data used;
  - what we'd build next.
- Team names and contacts.
- Keep API keys out of the frontend and public repos; usage verifiable via API logs or on-chain reads.

### Scoring (100)

| Criterion | Points |
|---|---|
| Data integration depth | 25 |
| Real-world potential | 25 |
| BNB Chain + RWA focus | 20 |
| Technical quality and safety | 15 |
| Originality | 10 |
| Demo and presentation | 5 |

### Technical notes: Atlas

Docs: <https://docs.atlasoracle.io/>

- **Push mode**
  - SingleFeed: one asset per contract, Chainlink AggregatorV2V3 compatible, use `latestRoundData`.
  - MultiFeed: many assets, 4-byte `feedId`, `fetch` / `fetchBatch` or `fetchCompact` + `FeedCodec`.
  - Interfaces: <https://github.com/oracle-atlas/push-oracle-interfaces>
- **Pull mode:** the TypeScript SDK fetches signed data, which is appended to tx calldata; the
  contract verifies it via `_getVerifiedFeedData(feedId)`.
- Feeds may be in **whitelist mode**: our contract address may need whitelisting by Atlas.
- **Always check staleness**, as in Atlas's example code.

### Technical notes: CoinMarketCap

Docs: <https://coinmarketcap.com/api/documentation/>

- Pro API base `https://pro-api.coinmarketcap.com`, header `X-CMC_PRO_API_KEY`.
- DEX endpoints cover BNB Chain: token prices, pairs, holders, OHLCV. v4 pair endpoints expose
  `security_scan` by Go+.
- Price conversion endpoint for THB display.
- MCP server: `https://mcp.coinmarketcap.com/mcp` with header `X-CMC-MCP-API-KEY`
  (quotes, technical analysis, Fear & Greed, on-chain metrics, derivatives).

---

## ChatAndBuild / Living Brain (in-kind, ~5,000 USD)

- A working AI agent solving a real problem, using Living Brain as its persistent memory layer
  via API, SDK, MCP or CLI.
- Our use: per-scooter damage and inspection history, and **dispute memory per wallet**: one factual entry per
  party after every settled rental, read back on the dispute desk ([ARCHITECTURE.md](ARCHITECTURE.md#dispute-memory-per-wallet)).
- Submit:
  - a **3–5 minute** demo video showing how the agent remembers, retrieves and connects info;
  - a short description: problem, solution, what makes it unique.
- Docs: <https://docs.livingbrain.com/docs/build>

---

## Cournot (2,000 USDT): pass/fail before scoring

- At least one successful **live** call to the official Cournot Intelligence Oracle Skill.
  **Mocked, hardcoded or static probabilities disqualify.**
- Display the returned probability and show it driving a decision (our deposit buffer).
- Show the exact claim evaluated and the evidence Cournot returns; clearly label any explanation
  added by our app.
- Claims need an asset, threshold or date (e.g. "Will BNB fall below $X before <date>?").
- README must have a **"Cournot Integration"** section covering:
  - where and how we call it;
  - how the probability is used;
  - where users see claim + evidence;
  - proof of a successful call (sanitized log or request ID).
- Show a live Cournot call in the demo; have a recording as backup.
- Cost: 3 free calls per account, then $0.01 per call via x402/b402 wallet. No API key.
- Skill: <https://github.com/Cournot-AI/cournot-skills>
- Scoring: integration depth 35, product potential 25, innovation 20, execution/UX 20.

---

## AWS credits (pitch session)

- Not an integration requirement. Chosen mainly at the final-day startup pitch session.
- Requires AWS Activate eligibility, including a valid business registration; one award per company.

---

## Evidence checklist before submitting

State on 26 Nov 2026. The same list, per track with evidence links, is on <https://keyscrow.app/sponsors>
(data: `web/lib/sponsorChecklist.ts`).

- [ ] Repo access for judges: README with setup + "Sponsor integrations" is done; the repo is private and goes public
      on Fri 27 Nov in the morning, before the deadline
- [x] Contract addresses on BSC testnet listed in README and write-up
- [x] CMC API call logs: `CMC_API_KEY` is set on <https://keyscrow.app>; live calls (USD + THB quotes) show on
      `/integrations` and `/api/integrations`
- [x] Atlas live on <https://keyscrow.app> and <https://mainnet.keyscrow.app>: BNB/USD and USDT/USD push feeds are the
      first price source (`GET /api/price` → `"source":"atlas"`), the Pull API signed reports (feed ids 633/649) give the
      consensus badge, the Pay with BNB guard and the settlement price proof; addresses in
      [WRITEUP.md](WRITEUP.md#bnb-chain-contracts-and-data-bsc-testnet-chain-97)
- [x] `AtlasSwapGuard` on BSC testnet: [`0xD26dBba1eE904c95d3467F479FC4410b0400b6bA`](https://testnet.bscscan.com/address/0xD26dBba1eE904c95d3467F479FC4410b0400b6bA)
      (reads the Atlas BNB/USD feed on-chain, max age 120 s; Pay with BNB on chain 97)
- [x] README "Cournot Integration" section with proof of call: live call 26 Nov 13:06 UTC, request id 7dcbb40bfbfdebad018e9bcad0d70c51, p = 0.30
      key / paid calls), so no proof
- [x] One-page write-up (CMC x Atlas): [WRITEUP.md](WRITEUP.md), team KeyScrow
- [ ] Videos in [submission/](submission/): ≤ 3 min for CMC x Atlas done (`duo.mp4` 64 s, `demo-guided.mp4` 90 s,
      `tour.mp4` 77 s, `eli5.mp4` 71 s); the 3–5 min Living Brain memory video and a Cournot live-call recording are
      not made yet
- [ ] Project submitted on HackQuest with all tracks selected: not submitted yet; fields ready in
      [submission/HACKQUEST.md](submission/HACKQUEST.md)

## To verify with sponsors at the venue

- Which Atlas feeds exist on BSC testnet, and whether our contract needs whitelisting (onboarding contact:
  hackathon@vanpeltventures.org).
- Whether CMC provides a hackathon API key (some endpoints may exceed the free tier).
- Cournot wallet/payment setup if we exceed 3 free calls.

## Account setup steps

Every account below is created with **hackathon@vanpeltventures.org**.

| Sponsor | Account to create | Then set (web/.env.local) |
|---|---|---|
| CoinMarketCap | Pro API key (free Basic plan): <https://pro.coinmarketcap.com/signup> | `CMC_API_KEY` |
| Atlas | Feed onboarding with Atlas (at the venue): BSC testnet feed addresses, whitelisting if a contract reads them | `ATLAS_RPC_URL`, `ATLAS_FEED_BNB_USD`, `ATLAS_FEED_USDT_USD` |
| Cournot | None for the 3 free calls per IP. Only if more are needed: a prepaid key / x402-b402 wallet | `COURNOT_LIVE=1`, optional `COURNOT_API_KEY` |
| ChatAndBuild / Living Brain | API key from the Living Brain dashboard (<https://docs.livingbrain.com>) | `LIVING_BRAIN_API_KEY`, `LIVING_BRAIN_SUBJECT_ID`, `LIVING_BRAIN_BRAIN_ID` |
| AWS | AWS Activate application (needs business registration) | none |
| HackQuest | Team/project account for the submission | none |
