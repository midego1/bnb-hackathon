# Demo script (3 minutes)

A live walkthrough on a **local anvil chain**. No wallet extension, keys or paid APIs are needed: the app's
yellow **Demo accounts** bar lets you act as the owner, the renter or the KeyEscrow dispute desk.

The pitch starts with the **one-click demo**: one button plays the whole story (create, fund, pay out rent,
AI inspection, settle) with real transactions against the real contracts, switching accounts by itself, while
the real rental page updates live underneath. The manual click-through further down is the backup and the
answer to "can I try it myself?".

![The one-click demo's end screen: settled, final balances for renter, owner and treasury in THB, USD and USDT](screenshots/demo-summary.png)

## Setup (before the clock starts)

Requirements: [Foundry](https://book.getfoundry.sh/getting-started/installation), Node 22, pnpm, and a one-time
`pnpm run setup` from the repo root.

### 1. Chain, contracts and demo data

```bash
pnpm chain:anvil          # terminal 1: anvil on 127.0.0.1:8545, chain id 31337
pnpm chain:deploy         # terminal 2: MockUSDT + EscrowFactory -> contracts/deployments/31337.json
pnpm chain:seed           # demo balances + two demo rentals -> contracts/deployments/31337.demo.json
```

The seed uses **anvil's well-known default dev accounts**. Their keys are public and only work on a local
chain. Never use them anywhere else.

| Role | Anvil account | Address |
| --- | --- | --- |
| Deployer / factory owner / KeyEscrow treasury (fee recipient) | #0 | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` |
| Owner | #1 | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |
| Renter | #2 | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` |
| KeyEscrow dispute desk (default arbiter) | #3 | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` |

It creates two scooter rentals, both a Honda Click 125i from a shop in Chiang Mai at 3,400 THB/month (100 mUSDT
at ~34 THB/USDT), a 2-month deposit (200 mUSDT, held instead of the renter's passport) and a 3-month rental period,
with the demo rental agreement PDF and three pickup photos (front, left side, plate close-up) from
`web/public/demo/` attached:

| Rental | Key in `31337.demo.json` | State after seeding |
| --- | --- | --- |
| Active rental | `lease` | Funded by the renter. Month 1 is due and ready to pay out to the owner. |
| Disputed rental | `disputedLease` | Funded; the owner proposed keeping 50 mUSDT for a scratched side panel and the renter opened a dispute. It uses a 60-day dispute-desk deadline so it is still open after a +30 day time jump. |

It also mints 10,000 mUSDT to the renter and 1,000 to the owner. On a fresh anvil every address is
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

Have two small sets of scooter photos ready (JPEG, PNG or WebP), taken from the same angles: a clean pickup set
and a return set with a visible scratch. `docs/demo-assets/` has a ready-made pair. The seeded rentals already show three placeholder
pickup photos.

### 4. Time travel

Rent periods (30 days) and timeouts run on block time. Advance anvil's clock with:

```bash
cast rpc evm_increaseTime 2592000 && cast rpc evm_mine      # +30 days
```

## One-click demo

Landing page (`/`) → **Play the live demo**, or the app home (`/app`) → **▶ Play the demo** (or open `/demo`; the yellow Demo accounts bar links there too). It exists
only in local builds: `NEXT_PUBLIC_CHAIN_ID=31337` (the default) and `NEXT_PUBLIC_DEV_ACCOUNTS=1`. Production
and testnet builds compile it out and `/demo` returns 404.

| Control | What it does |
| --- | --- |
| **Story** | *Happy path* (renter proposes the AI split, owner accepts), *Dispute path* (owner disputes, the dispute desk rules on a split), *Owner ignores it* (7-day fast-forward, then the full deposit goes back to the renter). |
| **Speed** | *Guided* (the default) explains itself, no presenter needed: a short intro card (what KeyEscrow is, who is who), then three beats per step: **What happens now** (who acts, in plain words, up long enough to read at 200 words a minute, at least 6 s, with a thin bar until it moves on), **On-chain now** ("Signing as Renter → calling RentalEscrow.fund()" with a spinner, then the transaction hash) and **What just changed** (the money that moved, highlighted, and what the contract now guarantees). The acting card lights up amber, the receiving card green. About 3:10 for the happy path, 3:30 for the other two. *Normal* holds one short caption per step (about a minute). *Fast* runs the transactions back to back (about 10 s). |
| **Mode** | *Autoplay*, or *Step by step*: each step waits for **Next step →** (in Guided, every caption waits for **Next →**, and **← Back** shows earlier captions again). Best for a live pitch, you talk, then click. |
| **Pause / Restart** | Pause (or the space bar) works at any moment: it freezes the caption timer, or holds before the next transaction. **Next →** (or the → key; clickers send it) skips the current wait. Restart begins again with a fresh rental. |
| **Retry** | If a step fails (node down, AI route offline, …) the error is shown in plain words with **Retry this step** and **Start over**. Retried steps resume where they stopped: nothing is sent twice. |

What it does, step by step (each run creates a **new rental**, cycling through three monthly scooter rentals: a
Honda Click 125i in Chiang Mai at ฿3,400, a Honda Scoopy-i in Pai at ฿3,000, a Yamaha NMAX 155 in Patong, Phuket
at ฿5,500; deposit two months held in escrow instead of a passport, 3-month rental period, KeyEscrow dispute desk
as referee):

1. **Owner offers the rental.** The demo rental agreement PDF and two pickup photos (`web/public/demo/`) go through
   `POST /api/evidence`; their SHA-256 hashes go on-chain with `EscrowFactory.createLease`.
2. **Pickup photos on record:** one `addEvidence` per photo.
3. **Renter gets demo mUSDT** from the MockUSDT faucet, only if short.
4. **Renter funds** deposit + first month (approve, then `fund`).
5. **Month 1 paid out:** `releaseRent`; the owner gets the rent minus the one-time 10 % KeyEscrow fee, which goes to the treasury.
6. **Return: scooter photos** from the same angles (a scratched left side panel, a cracked mirror) uploaded and anchored. No clock is faked
   here: settling the deposit does not depend on time, so the happy path needs no fast-forward.
7. **AI inspection** (`POST /api/settlement`, the offline demo inspector without a key) shows its split, one
   reason per changed photo and the *KeyEscrow Inspector* agent line (signed with its ERC-8004 identity when
   `INSPECTOR_PRIVATE_KEY` is set; unsigned otherwise, and the page says so).
8. **Renter proposes** the split on-chain, with the inspection's report hash.
9. **Ending:** owner accepts → settled at once · or owner disputes → the desk rules (owner keeps half
   again the AI estimate, for the shop's repair quote) · or *fast-forward 7 days (demo only)* via anvil's `evm_increaseTime` + `evm_mine`,
   then the renter claims the timeout and gets the full deposit back.
10. **Final balances:** what the renter paid in, got back, what the owner and the KeyEscrow treasury
    received, and that the escrow holds nothing, in THB, USD and USDT, with a ✓ when the books add up.

Every transaction is listed under its step with a short hash linking to the rental page and its timeline. The end
screen offers **Run again**, **Try the dispute path** and **Try: owner ignores it**. It runs the same code as
the normal UI: the `useTx` hook (simulate, send, toast), `uploadEvidence`, `runInspection` and the
`LeaseDetail` page component, rendered live under the narration.

`/demo?autoplay=1` starts on load (the landing button uses it); add `&path=dispute` or `&path=timeout`,
`&speed=normal`, `&speed=fast` or `&step=1` to preset the controls (`&timescale=0.05` shortens every Guided wait, for tests).

| Start | Mid-run (step by step) | End |
| --- | --- | --- |
| ![Play the demo page before starting](screenshots/demo-start.png) | ![Mid-run: AI inspection step, narration, and the live rental page](screenshots/demo-mid-run.png) | ![End summary with final balances](screenshots/demo-summary.png) |

## Script (3 minutes)

Before the clock starts: chain and app running (Setup above), landing page open, **Step by step** if you want
to pace it by hand. Amounts show THB first; with no price key the badge reads **Demo rates** (1 USDT = 33 THB).

| Time | Who clicks | What happens on screen | What to say |
| --- | --- | --- | --- |
| **0:00-0:15** | Nobody. Landing page. | "Rent a scooter in Thailand without leaving your passport." | "In Thailand, a scooter rental shop usually keeps your passport as the deposit, and at return the shop alone decides what every scratch costs. KeyEscrow puts the deposit and the rent in a smart contract made for each rental, on BNB Chain, so neither side can move the money alone. Let me play the whole story." |
| **0:15-0:45** | **▶ Play the demo** | Steps 1-4: the shop's offer for a Honda Click 125i in Chiang Mai at ฿3,400 a month with a ฿6,800 deposit; pickup photos on record; the yellow bar flips to *Renter*; approve + fund. The rental page below goes *Awaiting funding* → **Active**. | "Every amount in baht, from CoinMarketCap or the Atlas feed, server-side. The rental agreement and scooter photos are stored off-chain; only fingerprints go on-chain. Funding moves the deposit and month one into this rental's own escrow, not to the owner." |
| **0:45-1:05** | (Next step) | Step 5: ฿3,060 to the owner, ฿340 KeyEscrow fee to the treasury, in the timeline. | "Month one is due at the start. Our fee is 10 % of one month's rent, once, from the owner's first payout. The deposit is never touched." |
| **1:05-1:50** | (Next step) | Steps 6-8: return photos with a scratched side panel and a cracked mirror; the AI inspection card with its split and reasons and the *KeyEscrow Inspector* line; the renter proposes on-chain. | "A vision-model agent compares pickup and return photos and drafts a split with reasons. It drafts; it never decides. Its signed report hash goes on-chain with the proposal." |
| **1:50-2:15** | (Next step) | Step 9-10: owner accepts → **Settled**. End screen: renter, owner and treasury balances in THB/USD/USDT, ✓ balances add up, escrow ฿0. | "One transaction pays everyone out: no haggling at the counter, no passport held back, no court. And the books add up to the satang." |
| **2:15-2:45** | **Try the dispute path** (switch Speed to *Fast*) | Same story in ~10 s, then the owner disputes and the dispute desk rules on a split. | "If they disagree, the KeyEscrow dispute desk rules. Two timeouts protect the renter: if the owner ignores a proposal for 7 days, or the desk misses its deadline, the full deposit goes back to the renter." (Optional: **Try: owner ignores it**, the only step that fast-forwards the local clock, clearly labelled *demo only*.) |
| **2:45-3:00** | Scroll to the rental page's *Timeline* | Every on-chain event with block numbers (BscScan links on testnet). | "It runs on BNB Chain today, opBNB is next for lower fees. One-time fee of 10 % of one month's rent, plus dispute-desk revenue. Next step: a testnet pilot with rental shops in Chiang Mai and Phuket." |

## Manual walkthrough (backup, or for Q&A)

The same story by hand, one role at a time.

Amounts show THB first, then USD and the exact mUSDT. With no price key the badge reads **Demo rates**
(1 USDT = 33 THB), so 100 mUSDT shows as ≈ ฿3,300.

| Time | Who clicks | What happens on screen | What to say |
| --- | --- | --- | --- |
| **0:00-0:20** | Nobody. Show the landing page. | "Rent a scooter in Thailand without leaving your passport." Three steps, the fee in one line. | "In Thailand, a scooter rental shop usually keeps your passport as the deposit, and at return the shop alone decides what every scratch costs. KeyEscrow puts the deposit and the rent in a smart contract made for each rental, on BNB Chain, so neither side can move the money alone." |
| **0:20-0:50** | Demo bar → **Owner** → *Owner* page | *New rental*: click *Use anvil renter*, rent 100, deposit 200 (the form shows ≈ ฿3,300 and "2 months of rent"), 3 months. *Use the KeyEscrow dispute desk* is ticked. Attach `web/public/demo/lease.pdf` and a pickup photo → *Create rental*. | "The owner sees every amount in baht, from CoinMarketCap or the Atlas feed, fetched on the server only. The rental agreement and scooter photos are stored off-chain; only their SHA-256 fingerprints go on-chain. Each rental is its own small contract, cloned by our factory: cheap and isolated." |
| **0:50-1:20** | Demo bar → **Renter** (same page) | Status *Awaiting funding*. *Fund the escrow* shows deposit, first month and total in THB. *Approve 300 USDT* → *Fund deposit + rent*. Status: **Active**. | "Before paying, the renter sees the terms and who would rule in a dispute. Funding moves the deposit and month one into escrow, not to the owner. Every disabled button says why." |
| **1:20-1:40** | Still Renter → *Pay out 1 month to owner* | Timeline: 90 mUSDT (≈ ฿2,970) to the owner and a 10 mUSDT (≈ ฿330) KeyEscrow fee, charged once. | "Month one is due at the start. Anyone can trigger a payout once rent is due, so a keeper can automate it. Our fee is 10 % of one month's rent, once, from the owner's first payout. The deposit is never touched." |
| **1:40-2:30** | **Renter** → open the seeded active rental (*Renter* page → card) → *Documents & photos*: add return photos → *Upload & record photos on-chain* → *Run AI inspection* → *Propose this split on-chain*. Then demo bar → **Owner** → *Accept & settle now*. | Pickup thumbnails next to the return ones. The proposal shows the split in THB and one reason per changed photo. Status: **Return proposal**, then **Settled** with *Final settlement*. | "A vision model compares pickup and return photos and proposes a split with reasons. It drafts; it never decides. The renter proposes on-chain and the owner accepts: one transaction, no haggling at the counter, no court." |
| **2:30-2:50** | Demo bar → **Dispute desk** → *Dispute desk* page → the *In dispute* card | *Rule on this dispute*: the owner's last proposal (keep 50 mUSDT), the split in THB, a deadline countdown. Write a short ruling → *Settle with this split*. Status: **Settled**. | "If they disagree, the KeyEscrow dispute desk rules; an owner may name another neutral reviewer. Two timeouts protect the renter: if the owner ignores a proposal for 7 days, or the desk misses its deadline, the full deposit goes back to the renter." |
| **2:50-3:00** | Scroll to the *Timeline* | Every on-chain event with block numbers (BscScan links on testnet). | "It runs on BNB Chain today, opBNB is next for lower fees. One-time fee of 10 % of one month's rent, plus dispute-desk revenue. Next step: a testnet pilot with rental shops in Chiang Mai and Phuket." |

## Fallbacks during the demo

- **AI route slow or offline:** without a key the proposal comes from the deterministic demo inspector,
  labelled *demo inspector (no AI key configured)*. Say "this is the offline fallback; the live model returns
  the same JSON".
- **Price source offline:** the badge shows *Demo rates* (or *stale* after a live source failed). The flow is
  unchanged, because the contracts never read prices.
- **Wallet nonce errors after a time jump** (real wallet only): reset the account's activity in the wallet
  extension, or reconnect.
- **Show the owner-silence timeout instead:** after the renter's proposal, run
  `cast rpc evm_increaseTime 604800 && cast rpc evm_mine` (+7 days), then have the renter click
  *Return full deposit to renter*. The full deposit goes back to the renter.
- **One-click demo stuck on a step:** it shows the error in plain words; press **Retry this step**, or
  **Start over with a fresh rental**. A role switch that times out usually means the Demo accounts bar is
  hidden (build without `NEXT_PUBLIC_DEV_ACCOUNTS=1`).
- **Rehearse without clicking:** `pnpm -C web test:e2e` plays the one-click demo (happy, dispute and
  owner-ignores-it paths, step by step with a failure + Retry) and the manual create → fund → pay out →
  AI proposal → accept flow, in a headless browser against its own throwaway anvil.
