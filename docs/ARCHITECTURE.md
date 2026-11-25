# Architecture

KeyEscrow is a platform for scooter rental deposits and rent in Thailand, on BNB Chain (case study and scope:
[PRODUCT.md](PRODUCT.md)). One `EscrowFactory` creates a small,
non-upgradeable `RentalEscrow` contract for every rental. The escrow holds the renter's deposit and prepaid
rent in a stablecoin. MockUSDT stands in for that stablecoin on testnet. KeyEscrow has no token of its own.

Documents and photos stay off-chain, on BNB Greenfield, or in a local folder when Greenfield is not
configured. Only their content hashes go on-chain. A vision LLM compares pickup and return photos and
proposes how to split the deposit. The parties settle that proposal on-chain themselves.

> **Naming.** The docs and UI say rental shop *owner*, *renter*, *scooter rental*, *pickup* and *return*. The
> contracts and ABIs keep their original identifiers: `landlord` = owner, `tenant` = renter, `lease` = rental,
> `CheckIn` / `CheckOut` = pickup / return photos, `MoveOut` = a return (deposit) proposal is open.

> **How to read the Status lines.** Each section says what is on `main` today. Anything not on `main` yet is
> marked **Roadmap**; do not treat it as done.

## 1. Components

```mermaid
flowchart LR
    subgraph Users
        L[Owner (rental shop)]
        T[Renter]
        A["Arbiter<br/>(KeyEscrow dispute desk<br/>by default)"]
    end

    subgraph Web["web/ (Next.js App Router)"]
        UI["Pages: /landlord (owner) /tenant (renter)<br/>/arbiter /lease/[address]"]
        W["wagmi + viem + RainbowKit<br/>(wallet, reads, writes)"]
        subgraph API["Server routes (web/app/api)"]
            AI["AI inspection<br/>(vision LLM)"]
            PX["Price<br/>(Atlas feed / CMC Pro)"]
            EV["Evidence upload<br/>(hash + store)"]
        end
    end

    subgraph Chain["BNB Chain (BSC / opBNB; anvil locally)"]
        F[EscrowFactory]
        E1["RentalEscrow<br/>(rental #1)"]
        E2["RentalEscrow<br/>(rental #n)"]
        U[MockUSDT]
    end

    GF[("BNB Greenfield<br/>or local fallback<br/>web/.evidence/")]
    LLM(["Vision LLM provider"])
    CMC(["CoinMarketCap Pro API"])
    ATL(["Atlas on-chain price feed"])

    L & T & A --> UI
    UI --> W
    W -->|createLease| F
    F -->|EIP-1167 clone| E1 & E2
    W -->|"fund / propose / accept /<br/>dispute / resolve"| E1
    E1 <-->|transferFrom / transfer| U
    UI --> AI & PX & EV
    EV --> GF
    AI --> GF
    AI --> LLM
    PX --> CMC
    PX --> ATL
```

| Component | Where | Responsibility |
| --- | --- | --- |
| `EscrowFactory` | `contracts/src/EscrowFactory.sol` | Checks rental parameters and clones one `RentalEscrow` per rental (EIP-1167). Indexes rentals by owner, renter and arbiter. Holds the protocol fee setting for future rentals (`Ownable2Step`). |
| `RentalEscrow` | `contracts/src/RentalEscrow.sol` | Holds the deposit and rent for one rental. Releases rent on a fixed 30-day schedule. Anchors evidence hashes. Settles the deposit by mutual agreement, arbiter ruling or timeout. Initialised once, never upgradeable. |
| `FleetVault` | `contracts/src/FleetVault.sol` | Minimal Fleet Vault (testnet prototype): investors deposit the stablecoin and get ERC-20 fleet shares 1:1 (`BKK-FLEET-1`). Rentals created with `createLeaseWithPayee(params, vault)` pay the owner's rent and any deposit claim straight into it; that income minus the operator's maintenance fee is shared pro rata and claimable. See §4. |
| `MockUSDT` | `contracts/src/mocks/MockUSDT.sol` | Testnet-only stablecoin: 6 decimals, faucet capped at 10,000 per call. Not a project token. |
| Web app | `web/` | Role-based UI with a wallet connection (RainbowKit). Shows amounts in THB and USD. Links every rental to the block explorer. |
| Server routes | `web/app/api/*` | Hold every secret: the AI inspection call, price lookups, evidence upload to Greenfield. Nothing secret uses a `NEXT_PUBLIC_` variable. |
| Evidence store | BNB Greenfield (fallback `web/.evidence/`, git-ignored) | Stores the rental agreement PDF, pickup and return photos, the inspection report and the arbiter's ruling. The chain stores only `bytes32` hashes. |

**Status:**

All on `main`: the three contracts and 80 Foundry tests (100 % line and branch coverage), the local anvil
deploy and seed scripts with a scripted chain end-to-end run, the server routes for AI, price and evidence, the
BSC testnet deploy path (prepared, see [DEPLOY.md](DEPLOY.md)), and the web app wired to the contracts:
owner, renter, dispute desk and rental pages on anvil (31337) or BSC testnet (97), with a Playwright
end-to-end test of the full rental flow.

## 2. Roles and trust model

| Role | Can do | Cannot do |
| --- | --- | --- |
| Owner | Create a rental offer, cancel it while unfunded, add evidence, propose or accept a split, raise a dispute | Take the deposit or prepaid rent alone |
| Renter | Fund, prepay rent, release rent early, add evidence, propose or accept a split, raise a dispute | Take back the deposit or rent alone (except through the owner-silence timeout) |
| Arbiter | Rule on a disputed rental (`resolve`) before its deadline | Act on a rental that is not disputed. Send funds anywhere except to owner and renter |
| Anyone (keeper) | Release rent that is due. Trigger a timeout once it has expired | Change any amount or recipient |
| Factory owner | Change the protocol fee for **future** rentals, up to a hard cap | Touch existing escrows. They copy their fee at creation and have no admin functions |

**Default arbiter.** The KeyEscrow dispute desk is the default arbiter. An owner may name another neutral
arbiter instead, such as a local scooter rental association or a mediator. The arbiter is part of the rental terms
(`terms().arbiter`). The renter sees it in the funding screen and agrees to it by funding. The factory
rejects a rental in which owner, renter and arbiter are not three different addresses.

## 3. Rental state machine

```mermaid
stateDiagram-v2
    [*] --> Created: factory.createLease()
    Created --> Active: fund() by renter (deposit + first rent)
    Created --> Cancelled: cancel() by owner
    Active --> MoveOut: propose(tenantRefund, reportHash)
    MoveOut --> MoveOut: propose() counter-offer (new nonce, clock restarts)
    MoveOut --> Settled: accept(nonce) by the other party
    MoveOut --> Settled: claimTimeout() after owner silence
    Active --> Disputed: dispute()
    MoveOut --> Disputed: dispute()
    Disputed --> Settled: resolve(tenantRefund, rulingHash) by arbiter
    Disputed --> Settled: claimArbiterTimeout() after deadline
    Settled --> [*]
    Cancelled --> [*]
```

Notes:

- `releaseRent()` and `addEvidence()` do not change the state. Rent can be released in `Active`, `MoveOut`
  and `Disputed`. Evidence can be added in any state except `Settled` and `Cancelled`.
- Every proposal increments a `nonce`. `accept(nonce)` reverts if the proposal changed after the caller
  reviewed it, so a last-second replacement cannot be accepted by mistake. The proposer cannot accept
  their own proposal.
- **Owner-silence timeout:** if the renter made the latest proposal and the owner does not accept,
  counter-propose or dispute within `responseWindow` (default **7 days**), anyone can call
  `claimTimeout()`. The **full deposit** then goes to the renter.
- **Arbiter deadline:** if the arbiter has not ruled within `arbiterWindow` (default **14 days**) of the
  dispute, `resolve()` stops working. Anyone can then call `claimArbiterTimeout()`, which returns the
  **full deposit** to the renter. The outcome cannot be raced, because the arbiter cannot rule after the
  deadline.
- The burden of proof is on the owner. The owner never holds the funds and must actively claim
  damages.

**Status:**

Implemented as described: both windows are set per rental (0 selects the 7-day / 14-day default;
`responseWindow` 1-60 days, `arbiterWindow` 1-90 days). The `Settled` event's `basis` is
`LANDLORD_TIMEOUT_BASIS` or `ARBITER_TIMEOUT_BASIS` for the two timeouts. To change the policy, edit the
amounts passed to `_settle` in `claimTimeout()` / `claimArbiterTimeout()`.

## 4. Money flows

All amounts are in the factory's stablecoin (MockUSDT on testnet, 6 decimals).

```mermaid
flowchart LR
    T[Renter] -->|"fund(): deposit + rent month 1"| E[(RentalEscrow)]
    T -->|"payRent(n): prepay n months"| E
    E -->|"releaseRent(): due rent<br/>(minus one-time protocol fee)"| L[Owner (rental shop)]
    E -->|protocol fee, once per rental| P[KeyEscrow fee recipient]
    E -->|"settle: tenantRefund<br/>+ prepaid rent not yet due"| T
    E -->|"settle: landlordClaim<br/>+ due rent not yet released"| L
```

| Flow | Trigger | Amount |
| --- | --- | --- |
| Funding | `fund()` by renter | `depositAmount + rentAmount`. Starts the 30-day rent clock (`startTime`). |
| Prepay | `payRent(months)` by renter | `months × rentAmount`, never more than the term. |
| Rent release | `releaseRent()`: anyone once a month is due, or the renter early | Funded months that are due go to the owner. The protocol fee is taken here. |
| Settlement | `accept`, `resolve`, or a timeout | Deposit: `tenantRefund` to the renter and `landlordClaim` to the owner (the two always add up to the deposit). Rent: funded months that are due go to the owner, and prepaid months that are not yet due go back to the renter. |
| Cancel | `cancel()` by owner, only while unfunded | Nothing moves. |

**Protocol fee (design):**

- The fee is **10 % of one month's rent**, charged **once per rental**.
- It is deducted from the **first rent release to the owner**. It is never taken from the deposit and
  never charged to the renter on top of the rent.
- The rate is owner-configurable for future rentals and hard-capped in the factory. Each escrow copies the
  rate at creation, so later changes do not affect existing rentals.
- Example: rent 750 mUSDT means a fee of 75 mUSDT, so the owner receives 675 for month 1 and 750 for
  every month after. See [BUSINESS.md](BUSINESS.md#fee-model) for a THB example.

Implemented as `feeBps` (default 1000, `MAX_FEE_BPS = 1000`) and `feeRecipient` on the factory, snapshotted
into each rental's terms; the escrow emits `ProtocolFeePaid` when it takes the fee, and rounds it down.

Safety properties enforced in code:

- **Checks-effects-interactions:** the escrow writes its state before any transfer, and every move of
  funds is wrapped in `ReentrancyGuardTransient`.
- **Exact pull:** `_pull` compares the balance before and after the transfer and reverts on any shortfall,
  so a fee-on-transfer token cannot under-fund an escrow.
- **Fixed recipients:** funds only ever go to the owner's payee, the renter or the fee recipient that were
  set at creation. No function takes a recipient address.

**Fleet Vault payee.** `createLeaseWithPayee(params, payee)` is `createLease` plus one address: every payout
that would go to the owner (released rent, rent due at settlement, the deposit claim) goes to `payee()`
instead, typically the `FleetVault`. The owner keeps every role (propose, accept, dispute, cancel); the
factory emits `PayeeSet(escrow, payee)`. Plain `createLease` sets `payee = owner`, so existing flows are
unchanged. The vault needs no callback: anything above `totalPrincipal + reservedIncome` is new income,
which `sync()` (also run by `deposit`, `redeem` and `claim`) splits into the operator fee (max 30 %) and a
per-share accumulator. Shares are 1:1 with deposited principal, redeemable 1:1; income credited before a
redeem stays claimable. Rounding dust stays reserved, so the vault is always solvent (fuzz-tested).

## 5. Return settlement sequence

```mermaid
sequenceDiagram
    autonumber
    actor T as Renter
    actor L as Owner
    participant W as Web app
    participant API as Server routes
    participant S as Greenfield / local store
    participant M as Vision LLM
    participant E as RentalEscrow

    Note over T,E: At pickup, scooter photos were uploaded and checkInHash anchored
    T->>W: Upload return photos (same angles)
    W->>API: POST evidence
    API->>S: Store files
    API-->>W: contentHash
    T->>E: addEvidence(CheckOut, contentHash)
    T->>W: Run AI inspection
    W->>API: POST inspection (rental, pickup and return refs)
    API->>S: Fetch photo sets
    API->>M: Compare pickup vs return
    M-->>API: tenantRefund, landlordClaim, reasons[]
    API->>S: Store report JSON (incl. price quote used)
    API-->>W: Proposal + reportHash
    T->>E: propose(tenantRefund, reportHash)
    E-->>L: SettlementProposed(nonce)
    alt Owner agrees
        L->>W: Review report and reasons
        L->>E: accept(nonce)
        E->>T: tenantRefund + unearned rent
        E->>L: landlordClaim + due rent
    else Owner counter-proposes
        L->>E: propose(otherSplit, reportHash2)
        Note over T,E: Renter may now accept or dispute
    else Owner disputes
        L->>E: dispute()
        Note over E: Arbiter has 14 days to resolve(), then full deposit to renter
    else Owner stays silent for 7 days
        T->>E: claimTimeout()
        E->>T: Full deposit + unearned rent
    end
```

The AI does not hold keys and does not sign transactions. It only drafts a proposal. A party has to
submit that proposal with their own wallet, and the other party has to accept it.

## 6. Off-chain services

| Service | Route | Inputs → outputs | Secrets (server env only) | Fallback |
| --- | --- | --- | --- | --- |
| Evidence | `POST /api/evidence`, `GET /api/evidence/<hash>` | Files → `contentHash` (bytes32) and a storage reference | `GREENFIELD_*` | Local `web/.evidence/` directory |
| AI inspection | `POST /api/settlement` | Pickup and return photo sets plus the deposit → `{tenantRefund, landlordClaim, reasons[]}` and `reportHash` | `ANTHROPIC_API_KEY`, `VISION_LLM_MODEL` | Deterministic demo inspector, labelled as such in the UI |
| Inspector agent | `agent/` ([AGENT.md](AGENT.md)) | The AI inspection as an A2A + MCP skill. Reports carry the ERC-8004 agent id inside `reportHash` and are signed by its `reportSigner` key | `INSPECTOR_PRIVATE_KEY` | Unsigned reports, demo inspector |
| Price | `GET /api/price` | → THB and USD per USDT and BNB, with source and timestamp | `CMC_API_KEY`; Atlas: `ATLAS_RPC_URL`, `ATLAS_FEED_*` | Last good live quote (marked stale), then static rates labelled "Demo rates" |

Design rules:

- **Hashes on-chain, data off-chain.** The hash of the rental agreement PDF is `leaseHash`. Evidence sets are stored
  as `checkInHash`, `checkOutHash` and `EvidenceAdded` events. The report or ruling behind a settlement is
  stored as `reportHash`, and it becomes the `basis` of the `Settled` event. Anyone holding the files can
  check them against these hashes.
- **The AI output is a proposal, not an oracle.** It follows a strict JSON schema, and its amounts never
  exceed the deposit. Its reasons cite the matching photo pairs. A human on each side still decides.
- **Prices for display and fair value only.** The contracts use token units and never read a price. See
  [WRITEUP.md](WRITEUP.md).
- **Secrets stay on the server.** Every key is read from the environment by server routes.
  `.env.example` lists the variable names only.

**Status:** on `main`. The request and response shapes are in [API.md](API.md); the variable names are in
`.env.example`.

## 7. Scalability

- **Factory and minimal proxies.** Each rental is an EIP-1167 clone of one implementation: a 45-byte proxy
  plus one `initialize` call, instead of a full contract deployment. This makes rental creation cheap, and
  every escrow is isolated, so a bug or a dispute in one rental cannot touch the funds of another.
- **No admin keys over funds.** Escrows are not upgradeable and copy their terms at creation. This keeps
  contracts small and audits simple: the full set of possible fund movements is in one short contract.
- **Indexing.**
  - For the MVP, the factory keeps on-chain indexes (`leasesByLandlord`, `leasesByTenant`,
    `leasesByArbiter`, and paginated `leases(offset, limit)`), so the frontend needs no backend to list a
    user's rentals.
  - At scale, every state change emits an event (`LeaseCreated`, `Funded`, `RentReleased`,
    `SettlementProposed`, `DisputeRaised`, `Settled`, and so on). A standard indexer such as a subgraph,
    or a small event-sourced worker, can serve dashboards, the dispute-desk queue and analytics. Nothing
    would change on-chain.
- **Keeper-friendly.** `releaseRent()`, `claimTimeout()` and `claimArbiterTimeout()` are permissionless and
  can only move funds to the parties. Rent and timeouts can therefore be automated by any keeper, or by a
  KeyEscrow cron, without trusting it.
- **opBNB path.** The contracts are plain Solidity with no BSC-specific opcodes, so the same bytecode
  deploys to opBNB, an L2 with lower fees. Monthly rent releases and evidence anchoring then cost very
  little, which matters at rental-fleet scale. The frontend already lists opBNB testnet (5611) next to
  BSC testnet (97). One factory per chain keeps the indexes local to that chain.
- **Greenfield for bulk data.** Photo sets are megabytes per rental. Greenfield keeps them in the BNB
  ecosystem with access control. Moving storage there leaves the on-chain footprint at 32 bytes per
  evidence set.

## 8. Testing

- `cd contracts && forge test` runs the unit tests and a fuzz test for the factory, the escrow lifecycle,
  rent schedule, fee, settlement, timeouts and access control, plus MockUSDT.
- `pnpm e2e:chain` starts a throwaway anvil (port 28545), deploys, seeds, and drives the happy path, a
  dispute, the owner timeout and the arbiter fallback with real transactions and anvil time travel,
  asserting every balance (exits non-zero on failure).
- `pnpm -C web test` runs the vitest suite for the server routes (offline, no keys).
- `pnpm -C web test:e2e` (Playwright) starts its own anvil (port 28546), deploys and seeds it, builds the app
  and drives owner create → renter fund → rent payout → AI proposal → owner accept in a real browser.
