# Demo script (3 minutes)

A live walkthrough on a **local anvil chain**. You need three wallets: Landlord, Tenant and the KeyEscrow
dispute desk.

> **Status:** the local seed script (M3) and the AI, price and evidence routes (M5) are merged; the wired-up
> pages (M4) are being built. This script describes the target demo. Before recording, check the button labels
> and the commands below against the merged code, and update this file if they differ.

## Setup (before the clock starts)

### 1. Chain and contracts

Start anvil and run the local seed:

```bash
pnpm chain:anvil          # local chain on 127.0.0.1:8545, chain id 31337, prints the 10 default dev accounts
# in a second terminal, from the repo root:
pnpm chain:deploy         # MockUSDT + EscrowFactory -> contracts/deployments/31337.json
pnpm chain:seed           # demo balances, a funded demo lease and a disputed one -> contracts/deployments/31337.demo.json
```

On a fresh anvil the addresses are always the same: MockUSDT `0x5FbDB2315678afecb367f032d93F642f64180aa3`,
EscrowFactory `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` (see `contracts/deployments/31337.example.json`).

The seed uses **anvil's well-known default dev accounts**. Their keys are public and only work on a local
chain. Never use them anywhere else.

| Role | Anvil account | Address |
| --- | --- | --- |
| Deployer / factory owner / fee recipient | #0 | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` |
| Landlord | #1 | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |
| Tenant | #2 | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` |
| KeyEscrow dispute desk (default arbiter) | #3 | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` |

*If the seed script prints a different role mapping, follow its output.*

### 2. Web app

Set `NEXT_PUBLIC_ESCROW_FACTORY_ADDRESS` and `NEXT_PUBLIC_MOCK_USDT_ADDRESS` in `web/.env.local` to the
addresses in `contracts/deployments/31337.json`. Then run `pnpm dev`. Leave the AI, CMC and Greenfield keys empty: the app then
uses its labelled mocks and the local evidence folder, and no paid API is called.

### 3. Browsers

Use three browser profiles, or one wallet extension with three accounts, so you can switch quickly:

- Import anvil accounts #1, #2 and #3. Their private keys are printed by `anvil` at start-up.
- Add the network *Anvil, RPC `http://127.0.0.1:8545`, chain id 31337*.
- Have the demo photos ready: `docs/demo-assets/` once it exists (later in M7), or any two sets of room photos: a clean check-in set and a check-out set
  with one visible mark).

### 4. Time travel

Rent periods (30 days) and timeouts run on block time. Advance anvil's clock with:

```bash
cast rpc evm_increaseTime 2592000 && cast rpc evm_mine      # +30 days
```

### 5. Pre-seeded disputed lease (for scene 6)

`pnpm chain:seed` also creates a second lease already in the `Disputed` state (landlord claims 100 mUSDT,
tenant disputed), listed as `disputedLease` in `contracts/deployments/31337.demo.json`. It uses a 60-day
arbiter window, so it is still open after the +30 day jump in scene 4.

## Script

| Time | Who clicks | What happens on screen | What to say |
| --- | --- | --- | --- |
| **0:00–0:20** | Nobody. Show the landing page. | Hero: "Rental deposits that neither side can run off with." Three role cards. | "In Bangkok, a deposit is usually two months' rent, and at move-out the landlord holds all of it. KeyEscrow puts the deposit and the rent in a per-lease smart contract on BNB Chain, so neither side can move the money alone." |
| **0:20–0:50** | **Landlord** (#1) → *Landlord* → *New lease* | Enter tenant address #2, rent **฿25,500**, which converts to ≈ 750 mUSDT; deposit 2 months; 12-month term. The arbiter is pre-filled as **KeyEscrow dispute desk**. Upload the lease PDF and check-in photos → *Create lease*. | "The landlord prices in baht. We convert it with CoinMarketCap or Atlas data, on the server only. The lease PDF and check-in photos go to BNB Greenfield, and only their hashes go on-chain. Each lease is its own small contract, cloned by our factory, which keeps it cheap and isolated." |
| **0:50–1:20** | **Tenant** (#2) → *Tenant* → open the lease | The tenant sees the terms, the arbiter (the dispute desk) and the total **≈ ฿76,500** → *Approve* → *Fund*. Status: **Active**. | "Before paying anything, the tenant sees exactly who would rule in a dispute. Funding moves the deposit and month one into escrow, not to the landlord." |
| **1:20–1:40** | Presenter runs the `+30 days` command. **Landlord** → *Release rent* | The month-1 release shows **675 mUSDT to the landlord** and **75 to KeyEscrow**. | "Rent flows on schedule. Anyone can trigger a release once it is due, so a keeper can automate it. Our fee is 10 % of one month's rent, taken once, from the landlord's first rent release. A Bangkok agent typically charges a full month. The deposit is never touched." |
| **1:40–2:30** | **Tenant** → *Move out* → upload check-out photos → *Run AI inspection* | The AI proposes, for example, refund 1,400 / claim 100 mUSDT, with reasons such as "scuff on living-room wall (photo 3 vs 3′), ≈ ฿3,400 repaint". *Submit proposal*. Then **Landlord** → reviews the reasons → *Accept*. Status: **Settled**. Balances update instantly. | "A vision model compares check-in and check-out photos and proposes a split with reasons. It drafts; it never decides. The tenant submits it on-chain and the landlord accepts. The deposit settles in one transaction. No agent, no court, no waiting weeks." |
| **2:30–2:50** | **Dispute desk** (#3) → *Arbiter* → open the disputed lease | Shows both proposals and the evidence hashes. Enter the ruling → *Resolve*. Status: **Settled**. | "If they disagree, the KeyEscrow dispute desk rules. The landlord may name another neutral arbiter instead. Two timeouts protect the tenant: if the landlord ignores a proposal for 7 days, or the arbiter does not rule within 14, the full deposit goes back to the tenant." |
| **2:50–3:00** | Show the lease page with the explorer link | Timeline of all on-chain events. | "It runs on BNB Chain today, and opBNB is next for lower fees. We take a one-time fee of a tenth of an agent's commission, plus dispute-desk revenue. Our next step is a testnet pilot with Bangkok landlords." |

## Fallbacks during the demo

- **AI route slow or offline:** the mock proposal returns instantly and is labelled *mock*. Say "this is
  the offline fallback; the live model returns the same JSON".
- **Price source offline:** the UI shows an *indicative rate* badge. The flow is unchanged, because the
  contracts never read prices.
- **Wallet nonce errors after a time jump:** reset the account's activity in the wallet extension, or
  reconnect.
- **Need to show the landlord-silence timeout instead:** after the tenant's proposal, run
  `cast rpc evm_increaseTime 604800 && cast rpc evm_mine` (+7 days), then have the Tenant click
  *Claim timeout*. The full deposit goes back to the tenant.
