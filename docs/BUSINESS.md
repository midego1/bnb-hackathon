# Business model

## Problem

The case study is scooter rental in Thailand (scope and pitch story: [PRODUCT.md](PRODUCT.md)).

- **Passports held hostage.** Tourists and long-stay visitors renting a scooter commonly have to leave their
  passport with the rental shop as the deposit, or a cash deposit, for the whole rental.
- **Bogus damage claims at return.** At return the shop holds all the leverage: old scratches are billed as new
  damage, and the renter either pays or does not get the passport back.
- **Owners have a real problem too.** Renters do damage scooters, and owners lack reliable proof. The pickup
  condition is usually a few chat photos with no timestamps, or nothing at all.
- **Nobody neutral in between.** Neither side has a trusted inspector or a fair deposit system to turn to, and going
  to the police or a court over a few thousand baht rarely pays off.

We do not quote market-wide statistics on withheld deposits or damage claims, because we found no reliable public
source. The problem statement above is qualitative on purpose.

## Solution

KeyEscrow puts the deposit and the rent into a neutral smart contract on BNB Chain, one contract per rental:

1. **Neither party can move funds alone.** The deposit leaves the escrow only by mutual agreement, by the arbiter's
   ruling, or by a timeout that protects the renter.
2. **Evidence by default.** The rental agreement and the pickup and return photos are stored off-chain (BNB
   Greenfield when configured). Their content hashes are anchored on-chain, so the evidence cannot be swapped later.
3. **AI inspection.** The KeyEscrow Inspector, an ERC-8004 agent, compares pickup and return photos and drafts a
   split with reasons. It remembers each scooter's earlier inspections, so old damage is not charged twice. One
   party proposes the split on-chain and the other accepts. No haggling at the counter and no court.
4. **Disputes are bounded.** The KeyEscrow dispute desk is the default arbiter. If the owner ignores a proposal for
   7 days, or the arbiter does not rule within 14 days, the full deposit returns to the renter.

## Users

| Segment | Pain | What KeyEscrow gives them |
| --- | --- | --- |
| **Tourists and digital nomads** (Chiang Mai, Pai, Phuket, the islands) | Leave their passport at the shop. Face bogus damage claims at return, with no local leverage. | No passport at the counter: a contract holds the deposit, not the shop. A refund lands in their wallet the moment both sides agree. |
| **Long-stay and Thai renters** on monthly rentals | Haggle over scratches at return. Refunds are slow. | The same protection, with a transparent process and amounts shown in THB. |
| **Small rental shops** (a handful to a few dozen scooters) | Real damage from renters, with weak evidence. Disputes with tourists who are about to fly out. | Guided pickup and return photos as evidence, rent arriving on schedule, quick AI-assisted settlement, and a fleet dashboard with each scooter's status and income. |
| **Fleet investors** | Small investors cannot own part of a rental fleet's income. | The Fleet Vault: deposit a stablecoin, hold `BKK-FLEET-1` shares, claim rent and damage payouts. A testnet prototype today. |

## How KeyEscrow earns

### 1. Protocol fee: 10 % of one month's rent, once per rental

- It is charged **once per rental**, however long the rental runs.
- It is taken from the **first rent payout to the owner** (`releaseRent()`, or the settlement if no rent was
  released before). The renter pays nothing extra.
- It is **never taken from the deposit.** The deposit is the renter's money until the rental is settled.
- The rate (`feeBps`) is set on the `EscrowFactory` for **future** rentals and hard-capped there at 10 %
  (`MAX_FEE_BPS = 1000`). Testnet runs at that cap, so the rate can only go down. Each rental copies the rate when it
  is created, so a later change never affects an existing rental. The fee is rounded down to the token's base unit.

**Worked example (THB).** A Honda Click 125i rented by the month. The figures use an illustrative rate of
1 USDT = 34 THB; the app shows the live rate.

| Item | mUSDT | ≈ THB |
| --- | ---: | ---: |
| Monthly rent | 100 | 3,400 |
| Deposit (2 months, instead of the passport) | 200 | 6,800 |
| Renter funds at pickup (deposit + month 1) | 300 | 10,200 |
| **KeyEscrow fee** (10 % of one month, once) | **10** | **340** |
| Owner receives for month 1 | 90 | 3,060 |
| Owner receives for months 2–3 | 100 each | 3,400 each |

Over a 3-month rental the fee is about 3.3 % of the total rent. In return the shop gets an evidence trail and a fast,
neutral way to settle damage claims.

> **Status:** on `main` and live on BSC testnet (`feeBps` = 1000 in
> [contracts/deployments/97.json](../contracts/deployments/97.json)). The create form, the rental page and `/demo`
> show the fee.

### 2. The dispute desk as a service

The KeyEscrow dispute desk is the default arbiter on every rental. It is a second revenue line that grows with
rental volume:

- **Dispute fee (planned):** a flat fee per dispute that reaches a human, deducted from the settlement. Most returns
  should settle on the AI proposal without a dispute; the fee pays for the minority that need a person.
- **Arbitration as a service:** rental associations, insurers and mediators can be named as the arbiter on a rental
  instead (`arbiter` in the rental terms). A paid tier would give them the case queue, the evidence viewer and the
  AI pre-analysis that the desk uses.
- **Built-in incentive:** an arbiter that misses its deadline (14 days by default) loses the case to the renter. The
  desk has to be fast, and the platform can never hold a deposit hostage.

> **Status:** the desk itself is live: a default arbiter set in the factory, the `/arbiter` queue with photos,
> proposals and a ruling form, and the deadline. The dispute fee and paid arbitration tooling are roadmap; they are
> not in the contracts or the app.

### 3. Fleet Vault operator fee

A rental created with `createLeaseWithPayee(params, vault)` pays the owner's side (released rent, rent due at
settlement, any deposit claim) into a `FleetVault` instead of the owner's wallet. Each vault has an operator who keeps
the scooters on the road and takes a fixed share of every income into the vault, as a maintenance fee. The rest is
shared pro rata over the `BKK-FLEET-1` shares and claimable at any time. Shares are 1:1 with the stablecoin deposited
and redeem 1:1.

- The operator fee (`operatorFeeBps`) is fixed when the vault is deployed and capped at 30 % in the contract. The
  testnet vault uses 10 %.
- The operator can be the shop, a fleet company, or KeyEscrow running a fleet with partners.

Example, the same scooter in a vault: month 1 rent of ฿3,400 pays the ฿340 protocol fee, so ฿3,060 flows into the
vault. The operator takes 10 % (฿306) and shareholders share ฿2,754. A ฿1,287 damage claim from the deposit adds
฿128.70 for the operator and ฿1,158.30 for shareholders.

> **Status:** the contract, the Shareholders view and the Fleet owner view are on `main`. The testnet vault is
> deployed and verified, but it has no deposits yet. Revenue-sharing tokens can be securities: this is a testnet
> prototype and not an offer, and compliant issuance is a precondition for mainnet.

### 4. Monthly subscriptions (recurring rent)

Long-stay riders (digital nomads, expats, students) want a scooter for weeks or months, paid one period at a time,
without a passport held for the whole stay. A **subscription** is that offer, built on the escrow contracts with no
extra contract:

- **Owner:** "Offer as subscription" on a listed scooter (`/landlord`): monthly price and deposit in THB, payment
  rhythm (weekly, every 2 weeks or monthly) and max rent periods (default 12). The plan is stored with the off-chain listing and shown as a plan card.
- **Renter:** `/app/subscriptions`: pick a plan and subscribe. The shop issues one normal rental with
  `termPeriods` = max periods and `rentPeriod` = the plan's rhythm (`createLease`, or `createLeaseWithPayee` for Fleet
  Vault scooters); rent per period = monthly price x days / 30, rounded down. The renter funds deposit + the first
  period, then pays each period with `payRent(1)`. The page shows a status sentence, the next due date and
  the amount, baht first.
- **Cancel** = the existing return flow: return photos, AI split proposal, settle. The deposit and any prepaid,
  unused periods come back after that return check. There is no separate cancel function to trust.
- **Revenue:** the same one-time 10 % fee per rental (10 % of one month's rent, once, also for weekly plans). Owners and
  shareholders see **MRR** (monthly recurring revenue, THB and mUSDT) and the number of active subscribers.
- Which rentals are subscriptions is off-chain (the booking carries the plan); money and state stay in the escrow.

> **Status:** option A, built (web), with all three rhythms on contract v2 (per-rental `rentPeriod`). Roadmap:
> - **Auto-renew via pull payments (option B):** the renter approves a capped allowance once, and a keeper pulls
>   each month's rent when due (a `collectRent()` that anyone may call, bounded by the term and the allowance).
>   Today the renter pays each month by hand. Auto-renew past the term also needs v2 (extendable term).

### What we do not do

- **No yield on deposits.** We do not lend out escrowed deposits. Yield on renters' money would add risk and a
  regulatory burden, and it would undermine the trust we sell.
- **No token.** KeyEscrow has no token of its own. MockUSDT stands in for a stablecoin on testnet.

## Roadmap

| Phase | When | Scope |
| --- | --- | --- |
| **1. Hackathon MVP (done)** | Nov 2026, BNB Bangkok | Contracts live and verified on BSC testnet. Web app and agent on Cloudflare Workers. Owner, renter, dispute desk, back office and shareholder views. AI inspection by an ERC-8004 agent (#2921). Guided live demo. REST + MCP + A2A actions. |
| **2. Testnet pilot** | Q1 2027 | 10–20 real scooter rentals with friendly shops in Chiang Mai and Phuket, on testnet funds. Tune the inspector on real pickup and return photos. Staff the dispute desk. Thai and English renter guides. Evidence on BNB Greenfield in production. An independent security review of the contracts. |
| **3. Mainnet on BNB Chain and opBNB** | Q2–Q3 2027 | Deploy on BSC mainnet and opBNB (cheaper monthly payouts) with a widely held stablecoin. Wallet onboarding for non-crypto users (embedded wallets, Binance Web3 Wallet). Legal review of the escrow, dispute-desk and vault roles under Thai law. A keeper for monthly rent releases. |
| **4. Rental shops and partners** | 2027 → | Shop onboarding and multi-scooter tools (bulk listing, accounting exports) as a B2B subscription. Rental associations as named arbiters. Integrations with booking sites and AI travel agents through the MCP / REST actions. |
| **5. Insurance** | after mainnet | Partner insurers cover damage above the deposit, priced from each scooter's inspection history. Insurers can also act as named arbiters. |

### Fiat on-ramp via a licensed Thai partner

Most renters in Thailand have no crypto. They should be able to pay the deposit and rent in baht with PromptPay, the
national QR bank transfer, and never see a token. A licensed Thai partner (a regulated digital-asset or payment
operator) takes the baht, converts it to the stablecoin and sends it to the renter's own wallet (an embedded wallet in
phase 3); the renter's wallet then funds the escrow as today. KeyEscrow never holds the baht or the keys, and the
partner handles KYC and the licence. Refunds go back out the same way (stablecoin to baht).

The app already shows the flow as a clearly labelled **demo** (`/app/pay/<rental>`, "Pay with PromptPay (demo)" on a
rental awaiting funding): the baht amount at the current USDT/THB rate, a PromptPay-style QR to a fake all-zero id, a
countdown, and "I've paid", which mints test mUSDT to the renter on local anvil or BSC testnet. No real money moves and
no payment provider is connected. Next steps: pick a partner, agree on the payment-confirmation webhook, and replace the
test mint with the partner's stablecoin delivery.

Other markets with the same passport-as-deposit problem (Bali, Vietnam) come after Thailand works.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| **Smart-contract bug** locks or misroutes funds | Small, non-upgradeable contracts. Funds only go to the parties set at creation. Each rental is isolated in its own clone. 105 Foundry tests, including fuzz tests of vault solvency. An external audit before mainnet. |
| **Wrong or manipulated AI proposal** | The AI only proposes. Both parties have to agree on-chain, and either can dispute. Proposals carry reasons, refer to hashed photos and are bounded by the deposit. The report hash names the agent that made it. |
| **Weak or partial evidence** (photos missing at pickup) | Guided pickup photos are anchored on-chain at pickup. A missing pickup record counts against the owner in arbitration. |
| **Dispute-desk capacity or bias** | Owners can name another neutral arbiter. A missed deadline means a full refund for the renter. Rulings are hashed on-chain and open to audit. |
| **Regulation:** escrow, payments, stablecoins and revenue-sharing shares in Thailand | Testnet only until legal review. The contracts are non-custodial and we hold no keys over funds. No token. Licensed partners for fiat on- and off-ramps. The Fleet Vault stays a prototype until compliant issuance is possible. |
| **Adoption:** shops prefer passports, cash and the status quo | Pitch to shops as "real evidence for real damage, faster settlement" and to renters as "keep your passport". Start with shops that already serve long-stay foreigners. |
| **Stablecoin and FX:** priced in THB, paid in a USD stablecoin | THB and USD values are shown at signing and at settlement. A THB stablecoin can be supported later by deploying a factory for that token. |
| **Price-feed outage** | The contracts never read a price. The server falls back from the Atlas feed to CoinMarketCap to the last good quote, labelled. See [WRITEUP.md](WRITEUP.md). |
