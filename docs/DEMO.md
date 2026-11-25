# Demo script (3 minutes)

A live walkthrough on a **local anvil chain**. No wallet extension, keys or paid APIs are needed: the app's
yellow **Demo accounts** bar lets you act as the landlord, the tenant or the KeyEscrow dispute desk.

## Setup (before the clock starts)

Requirements: [Foundry](https://book.getfoundry.sh/getting-started/installation), Node 22, pnpm, and a one-time
`pnpm run setup` from the repo root.

### 1. Chain, contracts and demo data

```bash
pnpm chain:anvil          # terminal 1: anvil on 127.0.0.1:8545, chain id 31337
pnpm chain:deploy         # terminal 2: MockUSDT + EscrowFactory -> contracts/deployments/31337.json
pnpm chain:seed           # demo balances + two demo leases -> contracts/deployments/31337.demo.json
```

The seed uses **anvil's well-known default dev accounts**. Their keys are public and only work on a local
chain. Never use them anywhere else.

| Role | Anvil account | Address |
| --- | --- | --- |
| Deployer / factory owner / KeyEscrow treasury (fee recipient) | #0 | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` |
| Landlord | #1 | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |
| Tenant | #2 | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` |
| KeyEscrow dispute desk (default arbiter) | #3 | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` |

It creates two leases, both a Bangkok condo at 15,000 THB/month (441.18 mUSDT at ~34 THB/USDT), a 2-month
deposit (882.36 mUSDT) and a 12-month term, with the demo lease PDF and three check-in photos from
`web/public/demo/` attached:

| Lease | Key in `31337.demo.json` | State after seeding |
| --- | --- | --- |
| Active lease | `lease` | Funded by the tenant. Month 1 is due and ready to pay out to the landlord. |
| Disputed lease | `disputedLease` | Funded; the landlord proposed keeping 100 mUSDT for a wall repaint and the tenant opened a dispute. It uses a 60-day dispute-desk deadline so it is still open after a +30 day time jump. |

It also mints 10,000 mUSDT to the tenant and 1,000 to the landlord. On a fresh anvil every address is
deterministic (MockUSDT `0x5FbDB2315678afecb367f032d93F642f64180aa3`, EscrowFactory
`0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`, see `contracts/deployments/31337.example.json`), and the app
already has them baked in. If you deployed to an anvil that was not fresh, regenerate the app's addresses:

```bash
pnpm -C web sync:contracts   # contracts/deployments/31337.json -> web/lib/contracts/deployments.generated.json
```

### 2. Web app

```bash
echo "NEXT_PUBLIC_DEV_ACCOUNTS=1" > web/.env.local   # turns on the Demo accounts bar (local chain only)
pnpm dev                                            # http://localhost:3000
```

The app talks to `http://127.0.0.1:8545` by default; set `NEXT_PUBLIC_RPC_URL` in `web/.env.local` for another
node. Leave the AI, CoinMarketCap, Atlas and Greenfield variables empty: the app then uses its labelled
fallbacks (a deterministic demo inspector, **Demo rates** for THB/USD, evidence on local disk) and calls no
paid API.

Prefer a real wallet? Import anvil accounts #1-#3 into a wallet extension and add the network *Anvil, RPC
`http://127.0.0.1:8545`, chain id 31337*. The Demo accounts bar is not needed then.

### 3. Photos

Have two small sets of room photos ready (JPEG, PNG or WebP): a clean check-in set and a check-out set with a
visible mark. `docs/demo-assets/` has a ready-made pair. The seeded leases already show three placeholder
check-in photos.

### 4. Time travel

Rent periods (30 days) and timeouts run on block time. Advance anvil's clock with:

```bash
cast rpc evm_increaseTime 2592000 && cast rpc evm_mine      # +30 days
```

## Script

Amounts show THB first, then USD and the exact mUSDT. With no price key the badge reads **Demo rates**
(1 USDT = 33 THB), so 441.18 mUSDT shows as ≈ ฿14,559.

| Time | Who clicks | What happens on screen | What to say |
| --- | --- | --- | --- |
| **0:00-0:20** | Nobody. Show the landing page. | "Rental deposits that neither side can run off with." Three steps, the fee in one line. | "In Bangkok, a deposit is usually two months' rent, and at move-out the landlord holds all of it. KeyEscrow puts the deposit and the rent in a smart contract made for each lease, on BNB Chain, so neither side can move the money alone." |
| **0:20-0:50** | Demo bar → **Landlord** → *Landlord* page | *New lease*: click *Use anvil tenant*, rent 441.18, deposit 882.36 (the form shows ≈ ฿14,559 and "2 months of rent"), 12 months. *Use the KeyEscrow dispute desk* is ticked. Attach `web/public/demo/lease.pdf` and a check-in photo → *Create lease*. | "The landlord sees every amount in baht, from CoinMarketCap or the Atlas feed, fetched on the server only. The PDF and photos are stored off-chain; only their SHA-256 fingerprints go on-chain. Each lease is its own small contract, cloned by our factory: cheap and isolated." |
| **0:50-1:20** | Demo bar → **Tenant** (same page) | Status *Awaiting funding*. *Fund the escrow* shows deposit, first month and total in THB. *Approve 1,323.54 USDT* → *Fund deposit + rent*. Status: **Active**. | "Before paying, the tenant sees the terms and who would rule in a dispute. Funding moves the deposit and month one into escrow, not to the landlord. Every disabled button says why." |
| **1:20-1:40** | Still Tenant → *Pay out 1 month to landlord* | Timeline: 397.06 mUSDT (≈ ฿13,103) to the landlord and a 44.12 mUSDT (≈ ฿1,456) KeyEscrow fee, charged once. | "Month one is due at the start. Anyone can trigger a payout once rent is due, so a keeper can automate it. Our fee is 10 % of one month's rent, once, from the landlord's first payout. A Bangkok agent charges a full month. The deposit is never touched." |
| **1:40-2:30** | **Tenant** → open the seeded active lease (*Tenant* page → card) → *Documents & photos*: add check-out photos → *Upload & record photos on-chain* → *Run AI inspection* → *Propose this split on-chain*. Then demo bar → **Landlord** → *Accept & settle now*. | Check-in thumbnails next to the check-out ones. The proposal shows the split in THB and one reason per changed photo. Status: **Move-out proposal**, then **Settled** with *Final settlement*. | "A vision model compares check-in and check-out photos and proposes a split with reasons. It drafts; it never decides. The tenant proposes on-chain and the landlord accepts: one transaction, no agent, no court, no weeks of waiting." |
| **2:30-2:50** | Demo bar → **Dispute desk** → *Dispute desk* page → the *In dispute* card | *Rule on this dispute*: the landlord's last proposal (keep 100 mUSDT), the split in THB, a deadline countdown. Write a short ruling → *Settle with this split*. Status: **Settled**. | "If they disagree, the KeyEscrow dispute desk rules; a landlord may name another neutral reviewer. Two timeouts protect the tenant: if the landlord ignores a proposal for 7 days, or the desk misses its deadline, the full deposit goes back to the tenant." |
| **2:50-3:00** | Scroll to the *Timeline* | Every on-chain event with block numbers (BscScan links on testnet). | "It runs on BNB Chain today, opBNB is next for lower fees. One-time fee at a tenth of an agent's commission, plus dispute-desk revenue. Next step: a testnet pilot with Bangkok landlords." |

## Fallbacks during the demo

- **AI route slow or offline:** without a key the proposal comes from the deterministic demo inspector,
  labelled *demo inspector (no AI key configured)*. Say "this is the offline fallback; the live model returns
  the same JSON".
- **Price source offline:** the badge shows *Demo rates* (or *stale* after a live source failed). The flow is
  unchanged, because the contracts never read prices.
- **Wallet nonce errors after a time jump** (real wallet only): reset the account's activity in the wallet
  extension, or reconnect.
- **Show the landlord-silence timeout instead:** after the tenant's proposal, run
  `cast rpc evm_increaseTime 604800 && cast rpc evm_mine` (+7 days), then have the tenant click
  *Return full deposit to tenant*. The full deposit goes back to the tenant.
- **Rehearse without clicking:** `pnpm -C web test:e2e` runs create → fund → pay out → AI proposal → accept
  in a headless browser against its own throwaway anvil.
