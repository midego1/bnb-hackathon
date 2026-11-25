# Product spec

Source of truth for what we build for BNB Bangkok (HackQuest). Sponsor requirements are in
[SPONSORS.md](SPONSORS.md); the definition of done is in [ACCEPTANCE.md](ACCEPTANCE.md).

Submission deadline: **27 November, 09:00 Bangkok time (UTC+7)**. Hard deadline.

## One-liner

A scooter rental platform for Thailand where an AI inspector checks the vehicle's condition
via photos, deposits are held in on-chain escrow on BNB Chain, and owners (or fleet investors)
get paid automatically. No passport held hostage, no bogus damage claims.

## Problem (pitch story)

- Tourists renting scooters in Thailand commonly have to leave their passport as a deposit and
  are exposed to bogus damage claims at return.
- Owners in turn face real damage from renters, with no reliable proof.
- Both sides lack a neutral, trusted inspector and a fair deposit system.

## Core flow

1. **List.** Owner lists a scooter: photos, daily price in THB, deposit amount in THB.
2. **Start rental.** Renter pays rent + deposit into an escrow smart contract.
   - Accepted payment: USDT (BSC testnet) and BNB.
   - Rent and deposit are defined in fiat (THB/USD). For BNB, the contract converts using the
     Atlas on-chain price feed and adds a risk buffer (see [Risk Engine](#risk-engine)).
3. **Pickup inspection.** Renter takes guided photos: front, back, left, right, and a close-up
   of the frame/plate number.
   - Live camera capture only, no gallery uploads.
   - Each photo is stamped with time and location.
   - The agent rejects unclear photos and asks for a retake.
4. **Return inspection.** Same guided capture as pickup.
5. **AI verdict.** The AI inspector agent compares pickup vs return photos (vision-capable LLM)
   and outputs a structured verdict:
   ```json
   { "new_damage": bool, "locations": [], "severity": ..., "confidence": ..., "explanation": "..." }
   ```
   It also checks the scooter's history in its persistent memory (**Living Brain**), so damage
   that was already logged is never charged again.
6. **On-chain verdict.** The agent's dedicated wallet submits the verdict on-chain. **Only the
   agent wallet can do this.** Photo hashes + verdict hash are stored on-chain; images are
   stored off-chain.
7. **Dispute window (24h).** Owner or renter can challenge the verdict.
8. **Settlement** after the window:
   - No damage: rent goes to owner (or fleet vault), deposit fully returned to renter.
   - Damage: part of the deposit proportional to severity goes to owner (or fleet vault), the
     rest is returned to the renter.

## Risk Engine

The deposit must stay sufficient for the whole rental.

### Before the rental (off-chain backend)

- **CoinMarketCap volatility:** the payment token's volatility sets the deposit buffer.
  - Stablecoin: no buffer.
  - BNB: moderate buffer.
  - Highly volatile token: large buffer, or rejected.
- **CoinMarketCap DEX data:** screen payment tokens (Go+ `security_scan`, holder concentration)
  and reject scam/honeypot tokens. Only relevant if we accept tokens beyond BNB/USDT.
- **Cournot:** ask a claim like "Will BNB fall below $X before <return date>?" and use the
  returned probability to adjust the buffer. Probability, claim and evidence are shown in the UI.

### On-chain (smart contract)

- Atlas price feed converts fiat amounts to BNB at rental start.
- **Deposit health check:** the contract can compare the current deposit value (Atlas price)
  against the required coverage and flag the rental as under-collateralized, requesting a top-up.
- **Always reject stale prices:** check `updatedAt` / `onchainTs` against a max age.

### Display

- Owner dashboard shows amounts in THB (CoinMarketCap price conversion).

**Core idea for judges:** "CoinMarketCap and Cournot decide how much risk a rental carries,
Atlas enforces it on-chain."

## Fleet Vault (minimal buildable version)

- Investors deposit USDT into a Fleet Vault and receive fleet share tokens (plain ERC-20,
  e.g. "BKK-FLEET-1").
- Completed rentals route the owner's cut into the vault, minus an operator fee for maintenance.
- Damage payouts from slashed deposits also flow into the vault.
- Shareholders claim their share of accumulated income.
- Investor dashboard shows vault yield in USD/THB; non-stablecoin holdings are valued via Atlas.
- Testnet prototype only. Revenue-sharing tokens can be securities; "compliant issuance" is a
  next step for the pitch, not something we build.

## Demo flow

The one story that ties everything together:

> Renter returns a scratched scooter → agent compares photos, checks memory, detects **new**
> damage → verdict on-chain → deposit partially slashed → fleet vault balance increases →
> investor dashboard updates.

## Out of scope: pitch only, do not build

- Physical smart lock / unlocking (mock it).
- Secondary trading of fleet shares.
- Insurance pools.
- Pre-selling shares to finance new scooters.
- Multiple fleets per city.

## Suggested priority (adjust if behind schedule)

| Priority | Scope |
|---|---|
| **P0** | Escrow contract (list, start rental, agent verdict, dispute window, settlement); guided photo capture; vision verdict; Atlas pricing with staleness check. |
| **P1** | CoinMarketCap risk buffer + THB display; Living Brain memory; Fleet Vault. |
| **P2** | Cournot probability in the buffer; deposit health check / top-up; token screening. |

## Engineering rules

- Deploy on BSC testnet (mainnet is a bonus, not required).
- All API keys in `.env`, never committed, never in frontend code.
- All CoinMarketCap calls go through our backend and are logged (judges verify usage via API logs).
- Beginner-friendly, readable Solidity. Keep contracts small.
