# Product spec

Source of truth for what KeyScrow is and does, for BNB Bangkok (HackQuest). Sponsor requirements are in
[SPONSORS.md](SPONSORS.md); the definition of done is in [ACCEPTANCE.md](ACCEPTANCE.md); how the code is built is in
[ARCHITECTURE.md](ARCHITECTURE.md).

Submission deadline: **27 November 2026, 09:00 Bangkok time (UTC+7)**. Hard deadline.

## One-liner

KeyScrow: rent a scooter in Thailand without leaving your passport. The deposit and the rent sit in a small escrow
contract on BNB Chain, one per rental; an AI inspector drafts the deposit split at return, the two parties settle it
on-chain, and a neutral dispute desk rules when they disagree.

## Problem

- Tourists renting a scooter in Thailand usually leave their passport, or a stack of cash, as the deposit. At return
  the shop alone decides what every scratch costs.
- Shops have the opposite problem: real damage and no proof beyond a few chat photos.
- Nobody neutral sits in between, and nobody goes to court over a few thousand baht.

## Roles

| Role | Does |
| --- | --- |
| **Owner** (a shop, or a fleet with a payee) | Lists a scooter, creates the rental offer, receives rent, proposes or accepts a deposit split |
| **Renter** | Funds deposit + first rent period, pays later periods, takes pickup and return photos, proposes or accepts a split |
| **Dispute desk** (arbiter) | Rules on a disputed deposit within its window. KeyScrow's desk is the factory default; an owner may name another |
| **Shareholders** | Hold `BKK-FLEET-1` shares of a Fleet Vault that receives a fleet's rent and damage payouts (testnet prototype) |
| **AI inspector** | ERC-8004 agent #2921. Compares pickup and return photos and **drafts** a split with reasons and a report hash. It never signs a transaction |

## Core flow

1. **Offer.** The owner creates a rental (`EscrowFactory.createLease`): renter, deposit, rent per period, rent period
   (7, 14 or 30 days, default 30), number of periods (1–60), the hash of the rental agreement. The factory deploys an
   EIP-1167 clone of `RentalEscrow` for this one rental. Amounts are typed and shown in baht first; the contract holds
   a stablecoin (mUSDT test money on BSC testnet, BSC-USD on the mainnet pilot). No BNB payments.
2. **Fund.** The renter funds deposit + the first period's rent (`fund()`), and can prepay more periods
   (`payRent`). The rent clock starts. The owner can withdraw an unfunded offer (`cancel()`).
3. **Pickup photos.** Guided photo sets (labelled angles). The files stay off-chain (BNB Greenfield, R2 or local
   disk); only their SHA-256 fingerprints go on-chain (`addEvidence`, `checkInHash`).
4. **Rent.** Each funded period that is due can be released to the owner by anyone (keeper-friendly); the renter may
   release early. The first payout also pays the one-time protocol fee (below).
5. **Return photos + AI draft.** The same angles at drop-off. The inspector compares both sets, checks the scooter's
   earlier inspections in its memory (Living Brain) so known damage is not charged again, and returns
   `{tenantRefund, landlordClaim, reasons[], confidence, reportHash}`. Amounts never exceed the deposit. Without a
   model key a deterministic *demo inspector* returns the same JSON, labelled in the UI.
6. **Propose and accept.** Either party proposes a split on-chain with the report hash (`propose`); a new proposal
   replaces the old one (counter-proposal). The other party accepts the exact proposal it reviewed (`accept(nonce)`)
   and one transaction pays everyone. The rent clock stops at the first proposal or dispute.
7. **Dispute.** Either party can escalate (`dispute()`). The dispute desk rules with a hash of its written ruling
   (`resolve`). It sees each party's history card (on-chain facts + dispute memory per wallet).
8. **Timeouts protect the renter.**
   - The owner does not reply to a renter's proposal within the **response window (default 7 days)**: anyone can call
     `claimTimeout()` and the **full deposit** goes back to the renter.
   - The desk does not rule within the **arbiter window (default 14 days)**: anyone can call `claimArbiterTimeout()`
     and the **full deposit** goes back to the renter.
   - Both deadlines are hard: after them the late party can no longer act.
9. **Settlement.** Funded rent that was due at move-out goes to the owner (or payee); prepaid rent not yet due goes back
   to the renter; the deposit is paid as agreed, ruled or timed out.

Security model: no single party can move the deposit. It leaves only by agreement, a ruling, or a timeout. The
contracts are not upgradeable and the factory owner has no power over funds already in escrow.

## Business model

- **Protocol fee:** 10 % of **one month's** rent, once per rental (`feeBps` 1000, hard cap 10 %), deducted from the
  owner's first rent payout. Never taken from the deposit, never charged to the renter. Weekly or two-weekly rent uses
  the monthly equivalent.
- **Fleet Vault operator fee:** 10 % of vault income on testnet (hard cap 30 %).
- **Dispute desk as a paid service:** planned. Details in [BUSINESS.md](BUSINESS.md).

## Prices and risk (off-chain, display only)

The contracts work in token units and **never read a price**, so a price outage cannot block or move funds.

- **Price for display** (`GET /api/price`): Atlas feed → CoinMarketCap → last good quote (marked stale) → labelled
  *Demo rates*. Every amount is shown in baht first.
- **Deposit risk buffer** (`GET /api/risk`): CoinMarketCap USD quotes (24h/7d/30d changes) give each token's volatility
  and a buffer: stablecoin none, BNB moderate, too volatile rejected. Shown as advice next to the deposit; the escrow
  itself takes the stablecoin only. Without `CMC_API_KEY` it says "not configured" and computes nothing.
- **Cournot:** a claim like "Will BNB fall below $X before <date>?"; the latest stored probability scales the BNB
  buffer. Live calls are off unless `COURNOT_LIVE=1`; built, waiting for a partner key / paid calls.
- **Atlas:** the push-feed reader (`latestRoundData()` with a staleness check) is built and tested with a fake feed.
  Atlas publishes no BSC testnet push feeds; the pull oracle (signed reports, `ATLAS_API_KEY`) is being wired.
- All sponsor calls are server-side and logged without keys (`/integrations`, `/sponsors`).

## Memory (Living Brain)

- **Scooter memory:** earlier inspections of the scooter feed the AI draft ("already logged, do not charge again").
- **Dispute memory per wallet:** after every settlement, one factual entry per party (outcome, amounts, transaction),
  read back on the dispute desk next to facts folded from the chain. Wallet addresses only, no personal data.
- Without Living Brain keys: a local file / Durable Object stand-in, labelled.

## Fleet Vault (testnet prototype)

Investors deposit the stablecoin and get `BKK-FLEET-1` shares 1:1. Rentals created with the vault as payee
(`createLeaseWithPayee`) pay rent and damage payouts into it; the operator fee is taken, the rest is claimable pro
rata. Not an offer of securities; not on mainnet.

## Demo surfaces

- `/demo`: one click plays a whole rental with real BSC testnet transactions, no wallet (server-side demo wallets,
  gas-capped).
- `/stage/<slug>` (big screen), `/r/<slug>` (the judge's phone), `/duo/<slug>` (both side by side): a judge rents the
  Mystery Box with a guest wallet.
- Demo world: 3 fictional shops, 10 fictional renters, 15 rentals (clean returns, damage by agreement, disputes, one
  open dispute, active rentals, an unfunded offer): `pnpm testnet:world`.
- Every rental action is one definition served as REST (OpenAPI 3.1), MCP / A2A tools on the agent, and Ask AI.

## Out of scope: pitch only, do not build

- A physical smart lock.
- Secondary trading of fleet shares; compliant share issuance.
- Asset pools (one big asset, many shareholders): roadmap only.
- Insurance; a real PromptPay on-ramp (the app shows a labelled simulation that mints test money).
- A KeyScrow token. There is none.

## Engineering rules

- **BSC testnet (97) is the product.** Local anvil (31337) for development and tests.
- **Capped BSC mainnet pilot** (56) for the jury demo only: factory `0x8d708713C2a9da93450F224f35eF7FA15c0a2d3E`,
  BSC-USD, at most 0.70 USDT deposit + 0.30 USDT rent per period (one rental ≤ 1 USD), 5 USDT in all escrows
  together. Caps are owner-set on the factory and never block a payout. No Fleet Vault on mainnet.
- No keys or `.env` content in commits or frontend code; no secret in a `NEXT_PUBLIC_` variable.
- All sponsor API calls go through our backend and are logged (endpoint, status, time; never the key).
- Small, readable, non-upgradeable Solidity.
