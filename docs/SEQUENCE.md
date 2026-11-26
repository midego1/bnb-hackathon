# KeyScrow: one rental as a UML sequence diagram

Renter, owner, the contracts on BNB Chain, the price feeds, the AI inspector and the dispute desk, from choosing a motorbike to the payout. Function names are the real ones in `contracts/src/`.

```mermaid
sequenceDiagram
    autonumber
    actor R as Renter (phone / guest wallet)
    participant W as KeyScrow app + API (Cloudflare)
    actor O as Owner (rental shop)
    participant F as EscrowFactory (BNB Chain)
    participant E as RentalEscrow (this rental's clone)
    participant T as mUSDT / BSC-USD
    participant P as Atlas + CoinMarketCap
    participant AI as AI inspector (ERC-8004 #2921)
    actor A as Dispute desk (arbiter)

    R->>W: Choose a motorbike (Honda Click, ฿250/day, ฿6,800 deposit)
    W->>P: Price: THB → USDT (Atlas BNB/USD + USD/THB)
    P-->>W: rate (signed report, consensus HEALTHY)
    O->>F: createLease(terms, renter, arbiter, leaseHash)
    F->>E: deploy EIP-1167 clone
    F-->>W: LeaseCreated(escrow)
    R->>T: approve(escrow, rent + deposit)
    R->>E: fund()
    E->>T: transferFrom(renter → escrow)
    Note over E: Funded: deposit + rent locked.<br/>Nobody can move it alone.
    R->>E: addEvidence(CheckIn, sha256 of pickup photos)
    Note over R,O: Rental period: rent released to the owner per period (fee 10% once)
    R->>E: addEvidence(CheckOut, sha256 of return photos)
    R->>W: Inspect my return
    W->>AI: pickup vs return photos
    AI-->>W: {tenantRefund, landlordClaim, reasons[]} + reportHash
    R->>E: propose(tenantRefund, reportHash)
    alt Owner agrees
        O->>E: accept(nonce)
        E->>T: refund → renter, claim + rent − fee → owner, fee → KeyScrow
        Note over E: Settled in one transaction
    else Owner disagrees
        O->>E: dispute()
        A->>E: resolve(tenantRefund, rulingHash) within arbiterWindow
        E->>T: pay out per the ruling
    else Owner silent for responseWindow (7 days)
        R->>E: claimTimeout()
        E->>T: full deposit → renter
    end
    E-->>W: events (index, timeline, BscScan links)
```
