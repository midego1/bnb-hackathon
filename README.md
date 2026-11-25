# KeyEscrow

**Rent a scooter in Thailand without leaving your passport.**
Tourists renting a scooter in Thailand usually leave their passport with the shop as the deposit, and bogus damage
claims at return are common. KeyEscrow keeps the deposit and rent in a per-rental smart contract on BNB Chain, not
with the shop. At return, an AI inspection compares pickup and return photos of the scooter and proposes the split,
the two sides agree on-chain, and the money settles instantly.

Built for BNB Bangkok 2026 (Developer Track + CoinMarketCap x Atlas). Open source (MIT), testnet only, no token.
The product spec and case study are in [docs/PRODUCT.md](docs/PRODUCT.md).

![Rental page: rent schedule, pickup and return photos, on-chain timeline, amounts in THB first](docs/screenshots/lease-detail.png)

## How it works

1. **The shop offers the scooter:** monthly rent, deposit and rental period, priced in THB. The rental agreement
   and guided pickup photos (front, back, left, right, plate close-up) stay off-chain; only their SHA-256
   fingerprints go on-chain.
2. **The renter funds the escrow:** deposit plus the first month's rent go into that rental's own contract instead
   of a passport at the counter. Rent is paid out to the shop owner month by month.
3. **Return the scooter, settle in minutes:** an AI inspection compares pickup and return photos and proposes a
   split. One side proposes, the other accepts, and the money moves at once. If they disagree, the dispute desk
   rules.

**Fee:** 10 % of one month's rent, once per rental, paid by the owner from the first payout. A scooter at
3,400 THB a month pays ฿340 once.

In more detail: a rental shop owner creates a rental for the renter's wallet. The renter funds the deposit plus the
first month's rent in a stablecoin into a per-rental `RentalEscrow` contract. Rent is released monthly. At return,
an AI inspection compares pickup and return photos and proposes a deposit split. One party submits it on-chain,
the other accepts, and the deposit settles instantly. If they disagree, the arbiter (dispute desk) rules. If the
owner does not respond in time, the deposit goes back to the renter. **Neither party can move funds alone.**

> **Naming:** the UI and docs speak of the rental shop *owner*, the *renter*, the *scooter rental* and the
> *pickup* / *return* photos. The contracts, ABIs and APIs keep their original identifiers: `landlord` = owner,
> `tenant` = renter, `lease` = rental, `CheckIn` / `CheckOut` = pickup / return, `MoveOut` = return proposal.

## Features

- **One escrow per rental.** `EscrowFactory` clones a minimal, non-upgradeable `RentalEscrow` (EIP-1167) for
  each scooter rental. Funds are isolated per rental, and the platform has no admin key over them.
- **Scheduled rent.** Rent is released on a fixed 30-day schedule. Anyone can trigger a release once it is
  due, and the renter can release early. Prepaid rent that is not yet due goes back to the renter at
  settlement.
- **AI return inspection.** A vision LLM compares pickup and return photos of the scooter and returns
  `{tenantRefund, landlordClaim, reasons[]}`. When the other party accepts, settlement is instant.
- **Neutral arbitration.** The KeyEscrow dispute desk is the default arbiter. The owner may name another
  neutral arbiter, and the renter sees it before funding.
- **Renter-protecting timeouts.** If the owner stays silent on a proposal for 7 days, or the arbiter does
  not rule within 14 days, the full deposit goes back to the renter.
- **Evidence off-chain, hashes on-chain.** The rental agreement and photos go to BNB Greenfield, with a local
  fallback. Only content hashes are stored on-chain.
- **Prices in baht.** Every amount is shown THB first, then USD and the exact USDT, using the Atlas on-chain
  feed or the CoinMarketCap Pro API, both called server-side only and cached. A badge always says where the
  rate comes from: *Atlas feed*, *Live CoinMarketCap* or *Demo rates*.
- **Fair fee.** The protocol fee is 10 % of one month's rent, charged once per rental and taken from the
  owner's first rent release, never from the deposit.
- **No token.** KeyEscrow has no token of its own. MockUSDT stands in for a stablecoin on testnet.

> **Status:** everything above is on `main`: contracts with 80 Foundry tests, the AI / price / evidence
> routes, the full UI for owner, renter and dispute desk, local deploy + seed scripts, a scripted chain
> end-to-end run, a Playwright browser test of the whole rental flow, and a prepared (not yet broadcast) BSC
> testnet deploy path. The roadmap is in [docs/BUSINESS.md](docs/BUSINESS.md).

## Screenshots

| Owner: new rental | Renter: fund the escrow | AI return proposal |
| --- | --- | --- |
| ![New rental form with THB hints and the fee note](docs/screenshots/landlord-create.png) | ![Funding panel with deposit, first month and total in THB](docs/screenshots/tenant-fund.png) | ![AI inspection proposal with reasons](docs/screenshots/ai-proposal.png) |

| Dispute desk | Ruling | Mobile (390 px) |
| --- | --- | --- |
| ![Dispute desk queue](docs/screenshots/dispute-desk.png) | ![Dispute desk ruling form](docs/screenshots/arbiter-resolve.png) | ![Settled rental on a phone](docs/screenshots/lease-mobile.png) |

More in [docs/screenshots](docs/screenshots/README.md).

## Quickstart

Requirements: [Foundry](https://book.getfoundry.sh/getting-started/installation), Node 22, pnpm.

```bash
git clone --recursive https://github.com/midego1/bnb-hackathon.git && cd bnb-hackathon && pnpm run setup
```

Then run the whole thing locally, with no wallet or keys:

```bash
pnpm chain:anvil                                     # terminal 1: anvil on 127.0.0.1:8545
pnpm chain:deploy && pnpm chain:seed                 # terminal 2: contracts + demo accounts and rentals
echo "NEXT_PUBLIC_DEV_ACCOUNTS=1" > web/.env.local   # "Demo accounts" bar: act as owner / renter / dispute desk
pnpm dev                                             # http://localhost:3000
```

[docs/DEMO.md](docs/DEMO.md) has the seeded accounts and rentals and a 3-minute demo script. In a local build the
landing page has a **▶ Play the demo** button that plays the whole story in one click (`/demo`).

Configuration: copy `.env.example` to `.env` / `web/.env.local` and fill in what you need. Every integration
falls back to a labelled local mock when its key is missing. See [docs/API.md](docs/API.md) for the server API
and [docs/DEPLOY.md](docs/DEPLOY.md) for the BSC testnet deploy.

## Tests

```bash
cd contracts && forge build && forge test   # 80 contract tests (unit + fuzz)
pnpm -C web lint && pnpm -C web test        # eslint + vitest (server routes, offline)
pnpm -C web build                           # production build
pnpm -C web test:e2e                        # Playwright: create -> fund -> pay out -> AI proposal -> accept, own anvil :28546
pnpm e2e:chain                              # every settlement path with real txs + time travel, own anvil :28545
```

## Networks

| Network | Chain ID | Use |
| --- | --- | --- |
| Anvil (local) | 31337 | development and scripted end-to-end tests |
| BSC testnet | 97 | hackathon deployment |
| opBNB testnet | 5611 | supported in the frontend |

Testnet only. MockUSDT is a test stablecoin stand-in; KeyEscrow has no token of its own.

## Repo layout

```
contracts/           Foundry project
  src/EscrowFactory.sol    creates one RentalEscrow clone per rental, indexes rentals, protocol fee config
  src/RentalEscrow.sol     per-rental escrow: deposit, rent schedule, evidence hashes, settlement
  src/mocks/MockUSDT.sol   testnet-only 6-decimal stablecoin with a capped faucet
  test/                    Foundry tests
web/                 Next.js (App Router) + TypeScript + Tailwind + wagmi/viem + RainbowKit
  app/                     pages: / /landlord (owner) /tenant (renter) /arbiter /lease/[address] (one rental)
  app/api/                 server routes: AI settlement, price (CMC/Atlas), evidence upload (Greenfield)
  components/              UI: role pages, rental detail panels (rent, return, evidence, ruling, timeline)
  lib/                     chain + wallet config, generated contract bindings, server services
  e2e/                     Playwright browser test
agent/               KeyEscrow Inspector: the AI inspection as a BNB Chain agent (ERC-8004 identity, A2A + MCP)
docs/                Architecture, business model, CMC x Atlas write-up, API, deploy, demo script, screenshots
```

## Docs

- [Architecture](docs/ARCHITECTURE.md): the components, the rental state machine, money flows, off-chain
  services and scalability.
- [Business model](docs/BUSINESS.md): the problem, users, the fee model with a THB example, the roadmap
  and risks.
- [CoinMarketCap x Atlas write-up](docs/WRITEUP.md): how price data is used, server-side caching and
  fallbacks.
- [API](docs/API.md): the server routes (`/api/settlement`, `/api/price`, `/api/evidence`) and their fallbacks.
- [Deploy](docs/DEPLOY.md): the BSC testnet path: preflight, guarded broadcast, verification, rehearsal.
- [Demo script](docs/DEMO.md): the 3-minute local demo with the seeded accounts and rentals.
- [Screenshots](docs/screenshots/README.md)
- [KeyEscrow Inspector agent](docs/AGENT.md): the AI inspection as an ERC-8004 agent on BNB Chain (BNB Agent
  SDK), with A2A and MCP faces and signed reports.
- [Contracts README](contracts/README.md)

## Run locally

Everything runs against a local [anvil](https://book.getfoundry.sh/anvil/) node; no keys or accounts needed.

```bash
pnpm chain:anvil          # terminal 1: anvil on 127.0.0.1:8545 (ANVIL_PORT=... to change)
pnpm chain:deploy         # MockUSDT + EscrowFactory -> contracts/deployments/31337.json
pnpm chain:seed           # demo balances, a funded demo rental + a disputed one -> contracts/deployments/31337.demo.json
```

Point both at another local node with `RPC_URL=http://host:port pnpm chain:deploy`. The deploy script refuses any
chain other than 31337 unless `ALLOW_NON_LOCAL_BROADCAST=true` is set (and `PRIVATE_KEY` is then required);
known mainnets are always refused. On a fresh anvil the addresses are deterministic, see
`contracts/deployments/31337.example.json` and `31337.demo.example.json`.

Demo roles (anvil default accounts): #0 deployer / factory owner / KeyEscrow treasury (fee recipient), #1 owner
(`landlord`), #2 renter (`tenant`), #3 KeyEscrow dispute desk (default arbiter). The demo rental is a Honda Click 125i
from a shop in Chiang Mai at 3,400 THB/month (100 mUSDT at ~34 THB/USDT) with a 2-month deposit over a 3-month
rental period. Its on-chain content hashes are SHA-256 of the placeholder files in `web/public/demo/` (rental
agreement `lease.pdf` and the pickup photo manifest).

End-to-end check of every settlement path against a throwaway anvil (port 28545, started and killed by the runner):

```bash
pnpm e2e:chain            # deploy, seed, happy path, dispute, owner timeout, arbiter fallback
```

It needs `pnpm -C web install` (it uses viem) and exits non-zero if any path fails.

## License

[MIT](LICENSE)
