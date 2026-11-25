# Business model

## Problem

The case study is scooter rental in Thailand (scope and pitch story: [PRODUCT.md](PRODUCT.md)).

- **Passports held hostage.** Tourists and long-stay visitors renting a scooter commonly have to leave their
  passport with the rental shop as the deposit, or a cash deposit, for the whole rental.
- **Bogus damage claims at return.** At return the shop holds all the leverage: old scratches are billed as new
  damage, and the renter either pays or does not get the passport back.
- **Owners have a real problem too.** Renters do damage scooters, and owners lack reliable proof. Pickup
  condition is usually a few chat photos with no timestamps, or none at all.
- **Nobody neutral in between.** Neither side has a trusted inspector or a fair deposit system to turn to, and
  going to the police or a court over a few thousand baht rarely pays off.

We do not quote market-wide statistics on withheld deposits or damage claims, because we found no reliable
public source. The problem statement above is qualitative on purpose.

## Solution

KeyEscrow puts the deposit and the rent into a neutral smart contract on BNB Chain, one contract per rental:

1. **Neither party can move funds alone.** The deposit leaves the escrow only by mutual agreement, by the
   arbiter's ruling, or by a timeout that protects the renter.
2. **Evidence by default.** The rental agreement, pickup photos and return photos of the scooter are stored on BNB Greenfield.
   Their content hashes are anchored on-chain, so the evidence cannot be swapped later.
3. **AI inspection.** A vision LLM compares pickup and return photos and proposes a split with
   reasons. One party submits it and the other accepts. Settlement is instant, with no haggling at the counter and no court.
4. **Disputes are bounded.** The KeyEscrow dispute desk is the default arbiter. If the owner ignores a
   proposal for 7 days, or the arbiter does not rule within 14 days, the full deposit returns to the
   renter.

## Users

| Segment | Pain | What KeyEscrow gives them |
| --- | --- | --- |
| **Tourists and digital nomads** (Chiang Mai, Pai, Phuket, the islands) | Leave their passport at the shop. Face bogus damage claims at return, with no local leverage. | No passport at the counter: the deposit is held by a contract, not by the shop. A refund lands in their wallet the moment both sides agree. |
| **Long-stay and Thai renters** on monthly rentals | Haggle over scratches at return. Refunds are slow. | The same protection, with a transparent process and amounts shown in THB. |
| **Small rental shops** (a handful to a few dozen scooters) | Real damage from renters, with weak evidence. Disputes with tourists who are about to fly out. | Guided pickup and return photos as evidence, rent arriving on schedule, and quick AI-assisted settlement. |
| **Fleet operators and fleet investors** | Track condition and income across many scooters by hand. | Per-scooter inspection history and on-chain payouts; a fleet vault is planned in [PRODUCT.md](PRODUCT.md). |

## Fee model

KeyEscrow earns a **protocol fee of 10 % of one month's rent per rental**:

- It is charged **once per rental**, however long the rental runs.
- It is deducted from the **first rent release to the owner**. The renter pays nothing extra.
- It is **never taken from the deposit.** The deposit is the renter's money until the rental is settled.
- The rate is configurable by the factory owner for future rentals and hard-capped in the `EscrowFactory`
  contract. Each rental copies the rate at creation, so a later change never affects existing rentals.

**Worked example (THB).** A Honda Click 125i rented by the month. These figures use an illustrative rate of
1 USDT = 34 THB. The app shows the live rate.

| Item | mUSDT | ≈ THB |
| --- | ---: | ---: |
| Monthly rent | 100 | 3,400 |
| Deposit (2 months, instead of the passport) | 200 | 6,800 |
| Renter funds at pickup (deposit + month 1) | 300 | 10,200 |
| **KeyEscrow fee** (10 % of one month, once) | **10** | **340** |
| Owner receives for month 1 | 90 | 3,060 |
| Owner receives for months 2–3 | 100 each | 3,400 each |

Over a 3-month rental, the fee is about 3 % of the total rent, and the shop gets an evidence trail and a fast,
neutral way to settle damage claims in return.

> **Status:** on `main`. The factory charges the fee once per rental (`feeBps` = 1,000, i.e. 10 % of one
> month), from the owner's first rent payout, and the app shows it on the create form and the rental page.
> The deposit never pays a fee.

### Dispute-desk revenue

The KeyEscrow dispute desk is the default arbiter. It is a second revenue line that grows with rental
volume:

- **Dispute fee (planned):** a flat fee per dispute that reaches a human arbiter, deducted from the
  settlement. Most returns should settle on the AI proposal without a dispute. The dispute fee pays for
  the minority that need a human.
- **Arbitration as a service:** local rental associations, insurers and mediators can be named as arbiters on
  rentals created through KeyEscrow. A paid tier gives them a case queue, an evidence viewer and AI
  pre-analysis of each case.
- **Incentive alignment:** an arbiter that misses the 14-day deadline loses the case to the renter by
  default. This keeps the desk fast, and it builds trust, because the platform cannot hold a deposit
  hostage.

> **Status:** the dispute desk itself is on `main`: a default arbiter set in the factory, a queue of disputed
> rentals with the photos, proposals and a ruling form, and the 14-day deadline. The dispute fee and the paid
> arbitration tooling are roadmap; they are not in the contracts or the app yet.

### Other revenue (later)

- **B2B subscriptions** for rental shops and fleet operators: multi-scooter dashboards, bulk rental creation
  and accounting exports.
- **Yield-free by design.** We do not lend out escrowed deposits. Earning yield on renters' money would
  add risk and a regulatory burden, and it would undermine the trust we are selling.

## Roadmap

| Phase | When | Scope |
| --- | --- | --- |
| **1. Hackathon MVP** | Nov 2026 (BNB Bangkok) | EscrowFactory, RentalEscrow and MockUSDT on local anvil and BSC testnet. Owner, renter and arbiter flows. AI inspection proposal. THB/USD display via the Atlas feed or CoinMarketCap. Evidence on Greenfield with a local fallback. |
| **2. Testnet pilot** | Q1 2027 | 10–20 real scooter rentals with friendly shops in Chiang Mai and Phuket, on testnet funds. Tune the AI prompts and schema on real pickup and return photos. Staff the dispute desk. Renter-facing explainer in Thai and English. Independent security review of the contracts. |
| **3. Mainnet and opBNB** | Q2–Q3 2027 | Deploy on BSC mainnet and opBNB with a real, widely held stablecoin. Wallet onboarding for non-crypto users (Binance Web3 Wallet, embedded wallets). Legal review of the escrow and dispute-desk roles under Thai law. A keeper for monthly rent releases. |
| **4. Partnerships** | 2027 → | Integrations with rental shops, fleet operators and travel platforms. Rental associations as named arbiters. A Thai-language rental agreement template. Expansion to other markets with the same passport-as-deposit problem in Southeast Asia (Bali, Vietnam). |

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| **Smart-contract bug** locks or misroutes funds | Small, non-upgradeable contracts. Funds only ever go to the parties set at creation. Each rental is isolated in its own clone. Foundry tests. An external audit before mainnet. |
| **Wrong or manipulated AI proposal** | The AI only proposes. Both parties have to agree on-chain, and either can dispute. Proposals carry reasons and refer to hashed photos. The amounts are bounded by the deposit. |
| **Weak or partial evidence** (photos missing at pickup) | The pickup flow asks both parties for a photo set, and its hash is anchored on-chain at pickup. A missing pickup record counts against the owner in arbitration. |
| **Dispute-desk capacity or bias** | Owners can name a neutral arbiter instead. The 14-day deadline defaults to a full refund for the renter. Rulings are hashed on-chain and open to audit. |
| **Regulatory:** escrow, payments or stablecoin rules in Thailand | Testnet only until legal review. We hold no custody keys and the contracts are non-custodial. We do not issue a token. We plan to work with licensed partners for fiat on- and off-ramps. |
| **Adoption:** shops prefer passports, cash and the status quo | Pitch to shops as "real evidence for real damage, and faster settlement", and to renters as "keep your passport". Start with shops that already serve long-stay foreigners. |
| **Stablecoin and FX risk:** rental priced in THB, paid in a USD stablecoin | THB and USD values are shown at signing and at settlement. AI damage estimates are converted at a quoted rate that is recorded in the report. A THB-denominated stablecoin can be supported later by deploying a factory for that token. |
| **Price-feed outage** | Server-side caching and a fallback chain: Atlas feed, then CoinMarketCap, then the last good quote. Prices never gate a contract call. See [WRITEUP.md](WRITEUP.md). |
