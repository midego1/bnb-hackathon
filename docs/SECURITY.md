# Smart-contract security review (pre-audit)

Internal review of the KeyScrow contracts before any mainnet launch. It is **not** a substitute for an
external audit. Product context: [PRODUCT.md](PRODUCT.md); how the contracts fit together:
[ARCHITECTURE.md](ARCHITECTURE.md).

**Status:** review done on branch `kb/security` (base `main` at `8eec39b`). KE-01, KE-02 and KE-03 are fixed in
the source with regression tests; KE-12, KE-14 and KE-15 (audit findings #1, #9 and #10) were fixed later on
`kb/audit-fixes` and `kb/contract-v2`, also with regression tests. **None of the fixes is on the deployed BSC testnet contracts yet**: they need
a redeploy (see [Redeploy needed](#redeploy-needed)). Everything else is acknowledged and listed below.

## 1. Scope

| File | Contract | Notes |
| --- | --- | --- |
| `contracts/src/EscrowFactory.sol` | `EscrowFactory` | `Ownable2Step`; clones one escrow per rental (EIP-1167), fee and default arbiter for future rentals. |
| `contracts/src/RentalEscrow.sol` | `RentalEscrow` | Implementation behind every clone: deposit + rent escrow, proposals, dispute, timeouts. |
| `contracts/src/FleetVault.sol` | `FleetVault` | Investor shares (ERC-20, 1:1 with principal), income accumulator, operator fee. |
| `contracts/src/mocks/MockUSDT.sol` | `MockUSDT` | Testnet stand-in only (open faucet). Reviewed for completeness, never for mainnet. |

Out of scope: OpenZeppelin (`lib/openzeppelin-contracts`, used as is: `SafeERC20`, `Clones`, `Initializable`,
`ReentrancyGuardTransient`, `Ownable2Step`, `ERC20`), deploy/seed scripts, the web app and the agent.
Compiler: solc 0.8.28, optimizer 200 runs, `evm_version = cancun` (transient storage for the reentrancy
guard; BSC supports it).

## 2. Method

1. Manual line-by-line review of every external/public function for: access control, reentrancy (including
   ERC-20 hooks), checks-effects-interactions, rounding and dust (the one-time 10 % fee, settlement splits,
   vault share accounting and operator fee), timestamp and deadline boundaries (owner-silence timeout,
   arbiter deadline and fallback), state-machine holes (double settle, settle after dispute, resolve twice,
   cancel paths), clone initialization (re-initialization, front-running), the payee path
   (`createLeaseWithPayee`), token assumptions (fee-on-transfer, missing return values), event completeness
   and denial of service (unbounded loops, griefing).
2. Static analysis: Slither 0.11.6 (`slither . --foundry-out-directory out --filter-paths "lib/|test/|script/"`
   from `contracts/`). Every finding triaged in [§5](#5-static-analysis-slither).
3. Tests: one regression test per fixed finding (`contracts/test/Security.t.sol`), each checked to fail with
   the fix removed; handler-based invariant tests (`contracts/test/invariant/`, 64 runs x depth 64 per suite)
   with mutation checks (removing `ProposerCannotAccept` or the share lock makes them fail).
4. End-to-end: `pnpm e2e:chain` (deploy + seed + happy, dispute, owner-timeout and arbiter-fallback paths
   on a local anvil) and the agent's anvil integration test, both against the fixed contracts.

## 3. Findings

Severity: **High** = funds of uninvolved users can be taken; **Medium** = a party loses an entitlement or
funds are locked for long; **Low** = limited impact or needs an unusual setup; **Info** = design note.
Line numbers refer to the fixed code on this branch.

| ID | Severity | Location | Description | Status |
| --- | --- | --- | --- | --- |
| KE-01 | High | `FleetVault.sol:99-120`, `:172-188` | **Income sniping in the vault.** Income is credited to whoever holds shares when it arrives, shares are minted 1:1 and redeemable at once, and anyone can trigger a payout into the vault (`releaseRent` for due rent, `claimTimeout`, `claimArbiterTimeout`). An attacker could deposit a large amount (flash loan), trigger the payout, `claim`, `redeem` and repay in one transaction, taking almost all of the income from long-term shareholders. | **Fixed:** shares leaving an account (redeem or transfer) revert with `SharesLocked` until `SHARE_LOCK` (7 days) after that account's latest deposit (`:107`, `:199-206`). Claiming is never locked; receiving shares never locks. Residual: a depositor willing to lock capital for 7 days can still dilute one foreseeable payout. Before mainnet, consider streaming income over a period instead. Tests: `test_KE01_*`, `invariant_shareLockHolds`. |
| KE-02 | Medium | `RentalEscrow.sol:274`, `:298`, `:322` | **Owner could race the owner-silence timeout.** After the response window on a renter proposal had passed, the owner could still `dispute()` (or counter-propose / accept) until someone called `claimTimeout()`, for example by front-running it. That turned the renter's guaranteed full refund into an arbiter decision and delayed it by up to `arbiterWindow` (max 90 days). | **Fixed:** `_requireResponseWindowOpen()` (`:411-414`) makes the deadline hard: from `timeoutAt()` on, `propose`, `accept` and `dispute` revert with `ResponseWindowClosed` and only `claimTimeout` remains (same rule as the arbiter deadline). Tests: `test_KE02_*`. |
| KE-03 | Low | `EscrowFactory.sol:106-113` | **Payee could be the arbiter (or the renter).** `createLeaseWithPayee` accepted any non-zero payee. With `payee == arbiter` (e.g. the default dispute desk) the arbiter would rule on a deposit claim paid to itself. | **Fixed:** `_createLease` reverts with `RolesNotDistinct` when the payee is the renter or the (resolved) arbiter (`:113`). Test: `test_KE03_payeeCannotBeArbiterOrTenant`. |
| KE-04 | Low | `RentalEscrow.sol:432-465`, `FleetVault.sol:187` | **Push payments can block payouts.** Settlement pays fee recipient, payee and renter in one transaction, and `_sync` pays the operator inside `deposit`/`redeem`/`claim`. If the token can refuse a transfer to one of them (a blocklist or pause, as on some mainnet stablecoins), every payout of that rental (or every vault action) reverts until the token changes. MockUSDT has no blocklist. | Acknowledged. Before mainnet: check the chosen stablecoin; if it can blocklist, switch the escrow and the operator fee to pull payments (credit balances, `withdraw()`). |
| KE-05 | Low | `RentalEscrow.sol:256-265` | **Evidence hashes are last-writer-wins.** `checkInHash` / `checkOutHash` can be overwritten by either party at any time before settlement, e.g. the owner replacing the renter's pickup-photo hash. Every `EvidenceAdded` event (with `by`) is kept, and the web timeline reads the events (`web/components/lease/evidence.ts`), but `getLease` in the agent action layer (`web/lib/actions/lease.ts`) exposes only the latest stored hash. | Acknowledged (changing it needs a redeploy). Recommend write-once per kind (or per party) and having the agent read the event history. |
| KE-06 | Low | `EscrowFactory.sol:203-213` | **Unbounded index arrays.** Anyone can create rentals that name any renter, or the default dispute desk as arbiter, so `leasesByTenant` / `leasesByArbiter` can be spammed until a view call is too heavy for the frontend. Fake offers in a renter's list are also a phishing vector. No funds at risk; no state-changing loops exist. | Acknowledged. Before mainnet: paginated getters or an indexer, and flag offers from unknown owners in the UI. |
| KE-07 | Info | `EscrowFactory.sol:143-179` | **Arbiter trust.** The owner may name any arbiter (distinct from owner and renter, but possibly a second address of the owner) and an arbiter window of up to 90 days. That arbiter can award the whole deposit to the owner. The renter accepts the arbiter by funding. | By design (trust model, [ARCHITECTURE.md §2](ARCHITECTURE.md)). Recommend the renter UI warn when the arbiter is not the KeyScrow dispute desk. |
| KE-08 | Info | `EscrowFactory.sol:182-191` | **Admin key.** The factory owner can change the fee (capped at 10 % of one month's rent) and the default arbiter at any time, including between an owner's `createLease` submission and its inclusion. Existing escrows are never affected (terms are snapshotted). On testnet the owner, fee recipient, default arbiter and fleet operator are one EOA. | Acknowledged. Mainnet: multisig owner, ideally behind a timelock; separate keys per role. |
| KE-09 | Info | `RentalEscrow.sol` (whole contract) | Tokens sent to an escrow directly (not through `fund`/`payRent`) are never accounted for and stay stuck, also after settlement. | Acknowledged (no sweep on purpose: no admin over escrows). |
| KE-10 | Info | `RentalEscrow.sol:435`, `FleetVault.sol:178-181` | **Rounding.** The fee rounds down (at most 1 base unit in the owner's favour; 0 for rent below 10 base units). The vault's per-share accumulator rounds down; the dust stays in `reservedIncome`, so claims can never exceed the balance. | By design; covered by `invariant_solvent` and the vault exit check. |
| KE-11 | Info | `RentalEscrow.sol:378-383`, `:446-465` | Month 1 is due at funding, so every settlement pays it to the owner (non-refundable first month) and the one-time fee is always charged eventually. | By design; worth saying in the renter UI. |
| KE-12 | High | `FleetVault.sol:173-180` | **Income in an empty vault could be taken.** Income that arrived while no shares existed waited for the next sync and was then credited to the first depositor(s). `claim` has no lock (KE-01 locks only redeem and transfer), so a 1-unit `deposit` followed by `claim` took all of it, e.g. 900 of 1,000 USDT of rent, or front-ran the first real investor. | Fixed (needs a vault redeploy): with no shares, `_sync` sends that income to the operator (`test_orphanIncome_cannotBeTakenByATinyDeposit`). |
| KE-13 | Info | `EscrowFactory.sol:106` | A payee that cannot use the token (e.g. the escrow's own address, predictable from the factory nonce) only hurts the owner who chose it; renter funds are unaffected. | Acknowledged (self-harm only). |
| KE-14 | Medium | `RentalEscrow.sol` `monthsDue`, `propose`, `dispute`, `_settle` (audit #9; now `periodsDue`) | **Delaying settlement turned prepaid rent into rent due.** How much prepaid rent was refunded depended on *when* settlement ran, and the owner controls that: stay silent for the response window (up to 60 days), counter-propose, or dispute and let the arbiter window (up to 90 days) run out. Example: 3 months prepaid, the renter returns on day 10, the owner disputes on day 14 and the arbiter stays silent: `claimArbiterTimeout` paid the owner all 3 months instead of 1. | **Fixed** (needs a factory redeploy): the rent clock stops when the move-out starts, i.e. the first `propose` or `dispute` (`moveOutAt`); `periodsDue` is computed at that moment from then on. Product rule: starting the move-out ends the rental, for either party. The owner who thinks the renter ended it early to save rent claims that from the deposit (dispute desk). Tests: `test_KE14_*`. |
| KE-15 | Medium | `FleetVault.sol` `_update` (audit #10) | **A share transfer handed the seller's unsynced income to the buyer.** `deposit`, `redeem` and `claim` sync income first, a plain `transfer` did not: Alice holds all shares, 100 USDT of rent arrives, nobody syncs, Alice transfers to Bob, and Bob gets Alice's 90 USDT. | **Fixed** (needs a vault redeploy): `_update` runs `_sync()` before a transfer (not on mint/burn, which sync in `deposit`/`redeem`). Test: `test_KE15_transferKeepsUnsyncedIncomeWithSeller`. |

Checked and found sound (no finding):

- **Access control:** `fund`/`payRent` renter only; `cancel` owner only and only while `Created`; `propose`,
  `accept`, `dispute`, `addEvidence` parties only; `resolve` arbiter only and only while `Disputed` and
  before the deadline; keepers can only release due rent and trigger expired timeouts, which pay fixed
  recipients. No function takes a recipient address.
- **Reentrancy / CEI:** every function that moves tokens is `nonReentrant` (transient guard, shared across
  the contract); status and counters are written before transfers. The non-guarded functions
  (`propose`, `dispute`, `addEvidence`, `cancel`) make no external calls and reject a `Settled` lease, so a
  hook token re-entering during a payout cannot change the outcome (existing test
  `test_reentrancy_blockedOnPayout`).
- **State machine:** settlement happens once (`Settled` is terminal); `accept` and `claimTimeout` need
  `MoveOut`, so they are impossible after a dispute; `resolve` and `claimArbiterTimeout` need `Disputed`
  and split exactly at the deadline (`resolve` until `deadline - 1`, fallback from `deadline`); `cancel`
  only before funding; `accept` is bound to the reviewed nonce and the proposer cannot accept.
- **Clone initialization:** the implementation calls `_disableInitializers()` in its constructor; each
  clone is created with `CREATE` and initialized in the same transaction by the factory, so it cannot be
  front-run or re-initialized (`test_implementation_cannotBeInitialized`,
  `test_clone_initializedInCreationTx_cannotBeReinitialized`).
- **Token assumptions:** all transfers use `SafeERC20` (tokens without a return value are fine); incoming
  transfers check the balance delta and revert with `TransferShortfall` on fee-on-transfer tokens (escrow
  and vault). Rebasing tokens are not supported (the factory token is fixed at deploy time).
- **Arithmetic:** solidity 0.8 checked math; `uint64` timestamps and `uint32` month counters cannot
  overflow in practice; an absurd `rentAmount` can only make `fund` revert.
- **Events:** every state change emits an event (`Funded`, `RentPaid`, `RentReleased`, `ProtocolFeePaid`,
  `EvidenceAdded`, `SettlementProposed`, `DisputeRaised`, `Settled` with the basis, `Cancelled`,
  `LeaseCreated`, `PayeeSet`, `FeeUpdated`, `DefaultArbiterUpdated`, vault `Deposited` / `Redeemed` /
  `IncomeDistributed` / `Claimed` / ERC-20 `Transfer`). Clones emit nothing on `initialize`; the factory's
  `LeaseCreated` covers it.
- **DoS:** no loop in any state-changing function; `leases(offset, limit)` is paginated.
- **Vault share accounting:** shares are principal 1:1, so there is no share-price inflation attack;
  `_update` accrues both sides before balances move (mint, burn, transfer).

## 4. Invariants

Tested in `contracts/test/invariant/` (handlers drive real role addresses with random calls and time jumps
of up to 45 days; 64 runs x 64 calls per suite) and in the fuzz tests of `RentalEscrow.t.sol` /
`FleetVault.t.sol`. Every escrow suite also runs with weekly rent and an 18-decimal token (`*Weekly18InvariantTest`),
the vault suite with an 18-decimal asset (`FleetVault18DecimalsInvariantTest`); the KE-14 and KE-15 invariants were
checked to fail with their fix removed.

| Invariant | Where |
| --- | --- |
| **Funds conservation (escrow):** everything the renter paid in == escrow balance + paid to renter + paid to payee + fee. | `invariant_fundsConserved` |
| **Escrow book:** while live, balance == deposit + (periodsFunded - periodsReleased) x rent per period == the factory's `activeValue`; 0 once settled; periodsReleased <= periodsFunded <= termPeriods. | `invariant_balanceMatchesBook` |
| **Rent follows the schedule:** rent paid out (net + fee) == periodsReleased x rent, and periodsReleased never exceeds the periods due or what the renter released early; the fee is exactly 10 % of one month's rent (monthly equivalent: rent x 30 days / period), at most once. | `invariant_rentFollowsSchedule` |
| **No party can move funds alone:** the deposit is split exactly once; the owner gets any of it only through `accept` (renter consented) or `resolve` (by the arbiter); keeper-triggered timeouts return the full deposit to the renter. | `invariant_depositNeedsConsent` |
| Owner acting alone (plus keepers) never gets any deposit. | `LandlordAloneInvariantTest` |
| Renter acting alone (plus keepers) cannot skip rent that fell due: at settlement every funded, due month went to the owner. | `TenantAloneInvariantTest` |
| Arbiter acting alone (plus keepers) cannot settle or move funds without a party's dispute. | `ArbiterAloneInvariantTest` |
| **Vault solvency:** balance >= totalPrincipal + reservedIncome, and >= everything investors can claim now (incl. unsynced income). | `invariant_solvent` |
| **Vault books:** totalSupply == totalPrincipal == deposits - redeems; income in == distributed + operator fees + unsynced; reservedIncome == distributed - claimed. | `invariant_principalBook`, `invariant_incomeBook` |
| **Share lock:** no shares ever left an account within `SHARE_LOCK` of its deposit. | `invariant_shareLockHolds` |
| **Rent clock stops at the move-out (KE-14):** once a propose/dispute started the move-out, rent that falls due later never goes to the owner (only the renter's own early release can pay out more). | `invariant_rentClockStopsAtMoveOut` |
| **Transfers move no income (KE-15):** a share transfer never changes what the seller or the buyer can claim, unsynced income included. | `invariant_transferMovesNoIncome` |
| **Everyone can exit:** after any history, all investors can claim and redeem everything; only rounding dust (< 1,000 base units) stays behind. | `afterInvariant` in `FleetVaultInvariantTest` |

## 5. Static analysis (Slither)

Slither 0.11.6, 102 detectors, `lib/`, `test/` and `script/` filtered: 15 results before the fixes, 17 after
(the two new ones are `timestamp` on the new deadline and lock checks).

| Detector | Count | Location | Triage |
| --- | --- | --- | --- |
| `incorrect-equality` | 2 | `FleetVault._sync` (`income == 0`), `FleetVault.claim` (`amount == 0`) | False positive: early-exit checks on internally computed amounts, not a balance equality that a donation could break. |
| `missing-zero-check` | 1 | `RentalEscrow.initialize` (`payee_`) | False positive: only the factory initializes, in the creation transaction, with the owner or a checked non-zero payee. |
| `reentrancy-benign` | 1 | `EscrowFactory._createLease` | False positive: the only external call is `initialize` on the freshly cloned escrow (our code, no external calls). |
| `reentrancy-events` | 1 | `EscrowFactory._createLease` | False positive, same reason (also suppressed for `forge lint`). |
| `timestamp` | 10 | `RentalEscrow` deadlines / `periodsDue`, `FleetVault._update` | Accepted: windows are days long, validator timestamp drift is seconds; every boundary is tested at `deadline - 1` and `deadline`. Also excluded in `foundry.toml` `[lint]`. |
| `unindexed-event-address` | 2 | `EscrowFactory.FeeUpdated`, `DefaultArbiterUpdated` | Info: rare admin events; indexing would change the ABI the web decodes. Not changed. |

`forge lint src` is clean; `forge fmt --check` is clean for `src/` and `test/`.

## 6. Known limitations

- **Dispute memory is personal data.** The per-wallet history (Living Brain label `wallet:<address>`) holds wallet
  addresses and factual, code-written sentences only; `POST /api/history` takes only a rental address and reads the
  outcome from the chain index, so a caller cannot write text into it. Deletion per wallet on request (Thai PDPA):
  [ARCHITECTURE.md](ARCHITECTURE.md#dispute-memory-per-wallet).
- **Testnet token.** MockUSDT has an open faucet (10,000 per call, unlimited calls): anyone can mint, so
  testnet balances mean nothing. Never deploy it to mainnet. Mainnet USDT on BNB Chain (BSC-USD) has 18 decimals,
  not 6. The contracts are decimal-agnostic (every escrow test also runs with an 18-decimal token,
  `RentalEscrow18DecimalsTest`); `Deploy.s.sol` reads `decimals()` and `symbol()` from the token into the deployment
  JSON, and the web app and agent parse and format every amount with those (`TOKEN` in `web/lib/contracts`).
- **Admin keys.** On BSC testnet one EOA is factory owner, fee recipient, default arbiter (dispute desk) and
  fleet operator. The owner can only change the fee (capped) and default arbiter for future rentals; it has
  no power over existing escrows or the vault. The fleet operator is immutable per vault.
- **Pilot caps.** For the capped mainnet pilot the factory owner sets `maxDeposit`, `maxRentPerPeriod` (checked
  in `createLease`) and `maxActiveValue` (checked when an escrow takes funds in `fund` / `payRent`, against
  `activeValue`, the deposits + unreleased rent all escrows hold, booked by the escrows through `lockValue` /
  `unlockValue`). Payouts never check a cap and `unlockValue` cannot revert for a lease, so lowering a cap (even
  to 0, the emergency stop for new funding) never locks money already in escrow. Anyone who funds escrows between
  two of their own addresses can fill `maxActiveValue` with their own money and block other renters until they
  settle; the owner can raise the cap. Unlimited (`type(uint256).max`) on anvil and testnet.
  Tests: `test_caps_*`, `invariant_balanceMatchesBook` (`activeValue` == escrow balance).
- **Arbiter trust.** The arbiter decides the whole deposit split of a disputed rental. Its only limits are
  the deadline and that funds go to owner or renter. The renter must trust the named arbiter (KE-07).
- **Timeout policy.** Both timeouts return the full deposit to the renter (burden of proof on the owner). A
  renter can therefore get the deposit back alone if the owner stays silent for the response window. This
  is a product decision, not a bug.
- **Fleet vault.** A testnet prototype: income is recognized when it arrives (KE-01 residual), principal is
  not invested, and the shares may be securities (see [PRODUCT.md](PRODUCT.md)).
- **Spec conflicts (flagged, not changed).** [PRODUCT.md](PRODUCT.md) and [ACCEPTANCE.md](ACCEPTANCE.md)
  describe an on-chain verdict that **only the agent wallet** can submit, a **24 h** dispute window and an
  on-chain **Atlas** price check with staleness rejection and BNB payments. The contracts have no agent role
  (the AI report is anchored as `reportHash` in a party's proposal), the shortest response window is
  1 day (default 7), and they hold only the stablecoin with no on-chain oracle. Any of these, if added, needs
  its own review (oracle staleness, agent key compromise).

## Redeploy needed

The escrows on BSC testnet are clones of the deployed implementation and the vault is immutable, so the
fixes reach users only through new deployments. The ABI changes are additive (new errors, `SHARE_LOCK`,
`lockedUntil`), so the web keeps working against the current testnet deployment.

| Fix | Needs | Effect on what is deployed |
| --- | --- | --- |
| KE-01 share lock | New `FleetVault` | The current vault keeps instant redeem. Rentals created with it as payee keep paying into it (payee is fixed per escrow). |
| KE-02 hard response deadline | New `EscrowFactory` (deploys a new `RentalEscrow` implementation) | Existing rentals keep the old, raceable deadline. |
| KE-03 payee check | New `EscrowFactory` | The current factory still accepts any non-zero payee. |
| KE-12 empty-vault income to the operator | New `FleetVault` (no ABI change) | The current vault still credits income that reaches it with no shares to the next depositor, who can claim it at once. |
| KE-14 rent clock stops at the move-out | New `EscrowFactory` (new `moveOutAt` view) | Existing rentals still count rent due up to the settlement moment. |
| KE-15 sync before a share transfer | New `FleetVault` (no ABI change) | Shares transferred on the current vault still carry the seller's unsynced income to the buyer. |

After a redeploy: update `contracts/deployments/97.json`, run `pnpm -C web sync:contracts`, and re-seed the
testnet demo.
