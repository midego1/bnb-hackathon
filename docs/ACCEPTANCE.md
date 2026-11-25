# Acceptance criteria

A feature is done only when **every** check below passes in a demo on **BSC testnet**.
Scope is in [PRODUCT.md](PRODUCT.md); sponsor requirements are in [SPONSORS.md](SPONSORS.md).

## Rental and escrow

- [ ] Owner can list a scooter with THB price and THB deposit.
- [ ] Renter sees rent and deposit in THB and in the chosen token (USDT or BNB).
- [ ] BNB amounts are computed from the Atlas feed; stale prices are rejected.
- [ ] Rent + deposit are locked in the contract at rental start.
- [ ] Only the agent wallet can submit a verdict.
- [ ] A 24h dispute window exists; settlement only happens after it (a shortened setting is allowed for the demo).
- [ ] No damage: owner/vault paid, renter's deposit fully returned.
- [ ] Damage: deposit split by severity between owner/vault and renter.

## Inspection

- [ ] Guided capture requires all angles; gallery uploads are impossible.
- [ ] Photos carry timestamp and location.
- [ ] Unclear photos are rejected with a retake request.
- [ ] Verdict is structured (`new_damage`, `locations`, `severity`, `confidence`, `explanation`)
      and visible to both parties.
- [ ] Pre-existing damage from memory is never charged again, and the UI says so.
- [ ] Photo hashes and verdict hash are on-chain.

## Risk engine

- [ ] Deposit buffer visibly changes with token volatility (CMC).
- [ ] Cournot claim, probability and evidence are shown on the rental screen, and the
      probability visibly affects the buffer.
- [ ] Under-collateralized rentals are flagged with a top-up request.
- [ ] Owner dashboard shows earnings in THB.

## Fleet vault

- [ ] Investor can deposit USDT and receive share tokens.
- [ ] Completed rentals and damage payouts increase the vault balance.
- [ ] Investor can claim income; dashboard shows yield in USD/THB.

## Safety

- [ ] No API keys in the repo or frontend.
- [ ] All CMC calls go through the backend and are logged.
