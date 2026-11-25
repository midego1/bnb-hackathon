# Business model

## Problem

In Thailand, renting a condo or apartment usually means paying a security deposit up front. The deposit is
often two months' rent, on top of one month in advance. At move-out the landlord holds all of it, and the
tenant has little leverage:

- **Deposits are withheld or cut.** Common deductions include "cleaning" or "repainting" charges, normal
  wear and tear billed as damage, and slow or missing refunds. This is a frequent complaint among tenants
  in Bangkok, especially foreigners on one-year leases who leave the country at the end of the lease.
- **Recourse is weak in practice.** A 2018 notification from the Office of the Consumer Protection Board
  (OCPB) covers residential leasing businesses that let five or more units. It caps advance rent and
  deposits, and requires the deposit back within 7 days of move-out if the tenant is not at fault
  ([Tilleke & Gibbins](https://www.tilleke.com/insights/thailand-residential-property-leasing-businesses-be-subject-contract-controls/),
  [KPMG Thailand](https://kpmg.com/th/en/home/insights/2018/04/tax-news-flash-issue-36.html)). But many
  condo units are let by individual owners with fewer units. And going to court over a few tens of
  thousands of baht rarely pays off.
- **Landlords have a real problem too.** Tenants who leave damage, or stop paying the last month and tell
  the landlord to "keep the deposit", are a genuine risk. Landlords also lack good evidence. Check-in
  condition is usually a few chat photos with no timestamps.
- **Agents are expensive.** In Bangkok, letting agents typically charge the landlord about one full month's
  rent per new lease. They do not hold the deposit and do not settle disputes about it.

We do not quote market-wide statistics on withheld deposits, because we found no reliable public source for
Thailand. The problem statement above is qualitative on purpose.

## Solution

KeyEscrow puts the deposit and the rent into a neutral smart contract on BNB Chain, one contract per lease:

1. **Neither party can move funds alone.** The deposit leaves the escrow only by mutual agreement, by the
   arbiter's ruling, or by a timeout that protects the tenant.
2. **Evidence by default.** The lease, check-in photos and check-out photos are stored on BNB Greenfield.
   Their content hashes are anchored on-chain, so the evidence cannot be swapped later.
3. **AI inspection.** A vision LLM compares check-in and check-out photos and proposes a split with
   reasons. One party submits it and the other accepts. Settlement is instant, with no agent and no court.
4. **Disputes are bounded.** The KeyEscrow dispute desk is the default arbiter. If the landlord ignores a
   proposal for 7 days, or the arbiter does not rule within 14 days, the full deposit returns to the
   tenant.

## Users

| Segment | Pain | What KeyEscrow gives them |
| --- | --- | --- |
| **Expat and digital-nomad tenants** (Bangkok, Chiang Mai, Phuket) | Lose deposits when they leave the country. Have no local legal leverage. | Their deposit is held by a contract, not by the landlord. A refund lands in their wallet the moment both sides agree. |
| **Thai tenants** in condos and apartments | Have to haggle at move-out. Refunds are slow. | The same protection, with a transparent process and amounts shown in THB. |
| **Individual condo owners** (1–5 units) | Pay agent fees. Get disputes about damage. Have weak evidence. | A lower fee than an agent, rent arriving on schedule, an evidence trail, and quick AI-assisted settlement. |
| **Agents and condo-management companies** | Handle deposit disputes manually. Carry liability for holding funds. | White-label escrow and dispute handling for their portfolios (roadmap). |

## Fee model

KeyEscrow earns a **protocol fee of 10 % of one month's rent per lease**:

- It is charged **once per lease**, however long the lease runs.
- It is deducted from the **first rent release to the landlord**. The tenant pays nothing extra.
- It is **never taken from the deposit.** The deposit is the tenant's money until the lease is settled.
- The rate is owner-configurable for future leases and hard-capped in the `EscrowFactory` contract. Each
  lease copies the rate at creation, so a later change never affects existing leases.

**Worked example (THB).** These figures use an illustrative rate of 1 USDT = 34 THB. The app shows the live
rate.

| Item | mUSDT | ≈ THB |
| --- | ---: | ---: |
| Monthly rent | 750 | 25,500 |
| Deposit (2 months) | 1,500 | 51,000 |
| Tenant funds at signing (deposit + month 1) | 2,250 | 76,500 |
| **KeyEscrow fee** (10 % of one month, once) | **75** | **2,550** |
| Landlord receives for month 1 | 675 | 22,950 |
| Landlord receives for months 2–12 | 750 each | 25,500 each |
| *For comparison: typical Bangkok agent fee (≈ 1 month)* | *750* | *25,500* |

For the landlord, KeyEscrow costs about **one-tenth of a typical agent commission**. It also replaces the
part of an agent's job that matters most at move-out: deciding fairly who gets the deposit. Over a 12-month
lease, the fee is under 1 % of the total rent.

> **Status:** the contracts on `main` still use an earlier fee model: a capped share (at most 1 %) of
> *every* rent release. The one-time "10 % of one month" model is being built in the contracts and is the
> model we pitch. On both versions, the deposit never pays a fee.

### Dispute-desk revenue

The KeyEscrow dispute desk is the default arbiter. It is a second revenue line that grows with lease
volume:

- **Dispute fee (planned):** a flat fee per dispute that reaches a human arbiter, deducted from the
  settlement. Most move-outs should settle on the AI proposal without a dispute. The dispute fee pays for
  the minority that need a human.
- **Arbitration as a service:** condo juristic offices, agents and mediators can be named as arbiters on
  leases created through KeyEscrow. A paid tier gives them a case queue, an evidence viewer and AI
  pre-analysis of each case.
- **Incentive alignment:** an arbiter that misses the 14-day deadline loses the case to the tenant by
  default. This keeps the desk fast, and it builds trust, because the platform cannot hold a deposit
  hostage.

> **Status:** the dispute fee and the arbiter tooling are on the business roadmap. They are not in the
> contracts or the app yet.

### Other revenue (later)

- **B2B subscriptions** for agents and property managers: multi-lease dashboards, bulk lease creation and
  accounting exports.
- **Yield-free by design.** We do not lend out escrowed deposits. Earning yield on tenants' money would
  add risk and a regulatory burden, and it would undermine the trust we are selling.

## Roadmap

| Phase | When | Scope |
| --- | --- | --- |
| **1. Hackathon MVP** | Nov 2026 (BNB Bangkok) | EscrowFactory, RentalEscrow and MockUSDT on local anvil and BSC testnet. Landlord, tenant and arbiter flows. AI inspection proposal. THB/USD display via the Atlas feed or CoinMarketCap. Evidence on Greenfield with a local fallback. |
| **2. Testnet pilot** | Q1 2027 | 10–20 real leases in Bangkok with friendly landlords, on testnet funds. Tune the AI prompts and schema on real check-in and check-out photos. Staff the dispute desk. Tenant-facing explainer in Thai and English. Independent security review of the contracts. |
| **3. Mainnet and opBNB** | Q2–Q3 2027 | Deploy on BSC mainnet and opBNB with a real, widely held stablecoin. Wallet onboarding for non-crypto users (Binance Web3 Wallet, embedded wallets). Legal review of the escrow and dispute-desk roles under Thai law. A keeper for monthly rent releases. |
| **4. Partnerships** | 2027 → | White-label integrations with letting agents and condo-management companies. Juristic offices as named arbiters. A Thai-language contract template aligned with the OCPB lease rules. Expansion to other markets with similar deposit problems in Southeast Asia. |

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| **Smart-contract bug** locks or misroutes funds | Small, non-upgradeable contracts. Funds only ever go to the parties set at creation. Each lease is isolated in its own clone. Foundry tests. An external audit before mainnet. |
| **Wrong or manipulated AI proposal** | The AI only proposes. Both parties have to agree on-chain, and either can dispute. Proposals carry reasons and refer to hashed photos. The amounts are bounded by the deposit. |
| **Weak or partial evidence** (photos missing at check-in) | The check-in flow asks both parties for a photo set, and its hash is anchored on-chain at check-in. A missing check-in record counts against the landlord in arbitration. |
| **Dispute-desk capacity or bias** | Landlords can name a neutral arbiter instead. The 14-day deadline defaults to a full refund for the tenant. Rulings are hashed on-chain and open to audit. |
| **Regulatory:** escrow, payments or stablecoin rules in Thailand | Testnet only until legal review. We hold no custody keys and the contracts are non-custodial. We do not issue a token. We plan to work with licensed partners for fiat on- and off-ramps. |
| **Adoption:** landlords prefer cash and the status quo | Pitch to landlords as "cheaper than an agent, with faster dispute resolution". Go through agents and condo managers who already handle many leases. |
| **Stablecoin and FX risk:** lease priced in THB, paid in a USD stablecoin | THB and USD values are shown at signing and at settlement. AI damage estimates are converted at a quoted rate that is recorded in the report. A THB-denominated stablecoin can be supported later by deploying a factory for that token. |
| **Price-feed outage** | Server-side caching and a fallback chain: Atlas feed, then CoinMarketCap, then the last good quote. Prices never gate a contract call. See [WRITEUP.md](WRITEUP.md). |
