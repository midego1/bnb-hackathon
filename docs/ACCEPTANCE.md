# Acceptance criteria

A feature is done only when the check passes in code and tests, and in a demo on **BSC testnet** (or the local anvil
chain where real time is needed). Scope is in [PRODUCT.md](PRODUCT.md); sponsor requirements are in
[SPONSORS.md](SPONSORS.md). `[x]` = built and covered by tests; `[ ]` = not done or not live yet (the line says why).

Tests: `pnpm test` (Foundry), `pnpm -C web test` (Vitest), `pnpm agent:test`, `cd web && npx playwright test`.

## Rental and escrow

- [x] One `RentalEscrow` clone per rental from `EscrowFactory`; funds of different rentals are isolated.
- [x] The owner creates an offer with deposit, rent per period, a 7/14/30-day rent period and 1–60 periods; the
      renter funds deposit + first period's rent in the stablecoin (mUSDT on testnet, BSC-USD on the mainnet pilot).
- [x] Amounts are entered and shown in baht first, with the token amount next to it.
- [x] Due rent can be released to the owner (or payee) by anyone; prepaid rent not yet due is refunded at settlement.
- [x] The one-time protocol fee (10 % of one month's rent, hard cap 10 %) comes out of the owner's first rent payout,
      never from the deposit.
- [x] No single party can move the deposit; the factory owner has no power over funds in escrow; nothing is upgradeable.

## Settlement

- [x] The AI inspector only drafts `{tenantRefund, landlordClaim, reasons[], confidence, reportHash}`; amounts never
      exceed the deposit; it signs no transaction.
- [x] Either party proposes a split with a report hash; the other party (not the proposer) accepts the exact
      proposal nonce it reviewed, and one transaction pays everyone.
- [x] Either party can escalate to the dispute desk; only the desk can rule, with a ruling hash, before its deadline.
- [x] The owner silent on a renter's proposal for the response window (default **7 days**): the full deposit goes back
      to the renter; after the deadline the owner can no longer answer.
- [x] The desk silent for the arbiter window (default **14 days**): the full deposit goes back to the renter.
- [x] The rent clock stops at move-out, so a slow settlement never turns prepaid rent into rent due.

## Evidence and inspection

- [x] Pickup and return photo sets with angle labels; only SHA-256 fingerprints go on-chain (agreement, photo sets,
      report or ruling as the `Settled` basis).
- [x] Without a model key the deterministic demo inspector returns the same JSON, labelled in the UI.
- [x] The inspector reads the scooter's earlier inspections (memory) and does not charge logged damage again.
- [x] Reports carry the agent identity (ERC-8004 #2921), so the on-chain report hash commits to the agent.
- [ ] Camera-only capture with time and location stamps everywhere: only the judge phone (`/r`) forces the camera.
- [ ] A vision LLM on the live site: no model key is set there; the demo inspector runs.

## Dispute memory

- [x] The dispute desk sees a history card per party: facts folded from the chain plus remembered entries.
- [x] After every settlement, one factual entry per party is written (wallet address only, no personal data).
- [ ] Living Brain live on the deployed site: needs `LIVING_BRAIN_*`; until then the labelled local stand-in.

## Prices and risk (display only)

- [x] The contracts never read a price; a price outage cannot block a rental.
- [x] The deposit buffer changes with CoinMarketCap volatility: stablecoin none, BNB moderate, too volatile rejected.
- [x] Without `CMC_API_KEY` the risk panel says "not configured" and shows no invented numbers; prices fall back to
      labelled *Demo rates*.
- [x] Atlas push-feed reader rejects stale, never-updated or negative answers (tested with a fake feed).
- [x] Cournot claim, probability and evidence are stored and shown; the probability scales the BNB buffer.
- [ ] CoinMarketCap live on the deployed site with a logged call: needs `CMC_API_KEY` on the Worker.
- [ ] Atlas live: no BSC testnet push feeds published; the pull oracle (`ATLAS_API_KEY`) is not wired yet.
- [ ] Cournot live call with proof: waiting for a partner key / paid calls (`COURNOT_LIVE=1`).

## Fleet vault (testnet prototype)

- [x] Investors deposit the stablecoin and get `BKK-FLEET-1` shares 1:1; shares lock 7 days after a deposit.
- [x] Rentals with the vault as payee pay rent and damage payouts into it; the operator fee (≤ 30 %) is taken and
      shareholders claim the rest pro rata.

## Deployments

- [x] Contracts deployed and verified on BSC testnet (addresses: README).
- [x] Capped mainnet pilot factory on BSC (56): 0.70 USDT deposit, 0.30 USDT rent per period, 5 USDT in total;
      caps never block a payout.

## Safety

- [x] No API keys in the repo or frontend; no secret in a `NEXT_PUBLIC_` variable.
- [x] All sponsor calls go through the backend and are logged without the key (`/integrations`).
