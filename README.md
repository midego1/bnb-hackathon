# KeyEscrow

**Rental deposits that neither side can run off with.**
The deposit and rent sit in a per-lease smart contract on BNB Chain, not with the landlord.
At move-out, an AI inspection proposes the split, the parties agree on-chain, and the money settles instantly.

Built for BNB Bangkok 2026 (Developer Track + CoinMarketCap x Atlas).

## How it works

A landlord creates a lease. The tenant funds the deposit plus the first month's rent in a stablecoin into a
per-lease `RentalEscrow` contract. Rent is released monthly. At move-out, an AI inspection compares check-in
and check-out photos and proposes a deposit split. One party submits it on-chain, the other accepts, and the
deposit settles instantly. If they disagree, the arbiter rules. If the landlord does not respond in time,
the deposit goes back to the tenant. **Neither party can move funds alone.**

## Features

- **One escrow per lease.** `EscrowFactory` clones a minimal, non-upgradeable `RentalEscrow` (EIP-1167) for
  each lease. Funds are isolated per lease, and the platform has no admin key over them.
- **Scheduled rent.** Rent is released on a fixed 30-day schedule. Anyone can trigger a release once it is
  due, and the tenant can release early. Prepaid rent that is not yet due goes back to the tenant at
  settlement.
- **AI move-out inspection.** A vision LLM compares check-in and check-out photos and returns
  `{tenantRefund, landlordClaim, reasons[]}`. When the other party accepts, settlement is instant.
- **Neutral arbitration.** The KeyEscrow dispute desk is the default arbiter. The landlord may name another
  neutral arbiter, and the tenant sees it before funding.
- **Tenant-protecting timeouts.** If the landlord stays silent on a proposal for 7 days, or the arbiter does
  not rule within 14 days, the full deposit goes back to the tenant.
- **Evidence off-chain, hashes on-chain.** The lease PDF and photos go to BNB Greenfield, with a local
  fallback. Only content hashes are stored on-chain.
- **Prices in baht.** Every amount is shown in THB and USD, using the Atlas on-chain feed or the
  CoinMarketCap Pro API. Both are called server-side only and cached.
- **Fair fee.** The protocol fee is 10 % of one month's rent, charged once per lease and taken from the
  landlord's first rent release, never from the deposit. Bangkok agents typically charge a full month.
- **No token.** KeyEscrow has no token of its own. MockUSDT stands in for a stablecoin on testnet.

> **Status:**
>
> - **Done:** the contracts and their tests (one-time fee, dispute desk as default arbiter, 7-day landlord
>   timeout and 14-day arbiter deadline), the local deploy / seed scripts and chain end-to-end checks, the
>   AI, price and evidence routes, and the web shell (wallet connect, chains, role pages).
> - **Being built:** the UI flows.
>
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) has the details.

## Quickstart

Requirements: [Foundry](https://book.getfoundry.sh/getting-started/installation), Node 22, pnpm.

```bash
git clone --recursive https://github.com/midego1/bnb-hackathon.git && cd bnb-hackathon && pnpm run setup
```

Then:

```bash
pnpm test          # forge test
pnpm -C web test   # API unit tests (vitest, offline)
pnpm dev           # web on http://localhost:3000
pnpm build         # forge build + next build
```

Configuration: copy `.env.example` to `.env` / `web/.env.local` and fill in what you need. Every integration
falls back to a local mock when its key is missing. See [docs/API.md](docs/API.md) for the server API.

For a full local walkthrough with anvil and seeded landlord, tenant and dispute-desk accounts, see
[docs/DEMO.md](docs/DEMO.md).

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
  src/EscrowFactory.sol    creates one RentalEscrow clone per lease, indexes leases, protocol fee config
  src/RentalEscrow.sol     per-lease escrow: deposit, rent schedule, evidence hashes, settlement
  src/mocks/MockUSDT.sol   testnet-only 6-decimal stablecoin with a capped faucet
  test/                    Foundry tests
web/                 Next.js (App Router) + TypeScript + Tailwind + wagmi/viem + RainbowKit
  app/                     pages: / /landlord /tenant /arbiter /lease/[address]
  app/api/                 server routes: AI settlement, price (CMC/Atlas), evidence upload (Greenfield)
  lib/                     chain + wallet config
docs/                Architecture, business model, CMC x Atlas write-up, demo script
```

## Docs

- [Architecture](docs/ARCHITECTURE.md): the components, the lease state machine, money flows, off-chain
  services and scalability.
- [Business model](docs/BUSINESS.md): the problem, users, the fee model with a THB example, the roadmap
  and risks.
- [CoinMarketCap x Atlas write-up](docs/WRITEUP.md): how price data is used, server-side caching and
  fallbacks.
- [Demo script](docs/DEMO.md): the 3-minute local demo.
- [Contracts README](contracts/README.md)

## Run locally

Everything runs against a local [anvil](https://book.getfoundry.sh/anvil/) node; no keys or accounts needed.

```bash
pnpm chain:anvil          # terminal 1: anvil on 127.0.0.1:8545 (ANVIL_PORT=... to change)
pnpm chain:deploy         # MockUSDT + EscrowFactory -> contracts/deployments/31337.json
pnpm chain:seed           # demo balances, a funded demo lease + a disputed one -> contracts/deployments/31337.demo.json
```

Point both at another local node with `RPC_URL=http://host:port pnpm chain:deploy`. The deploy script refuses any
chain other than 31337 unless `ALLOW_NON_LOCAL_BROADCAST=true` is set (and `PRIVATE_KEY` is then required);
known mainnets are always refused. On a fresh anvil the addresses are deterministic, see
`contracts/deployments/31337.example.json` and `31337.demo.example.json`.

Demo roles (anvil default accounts): #0 deployer / factory owner / KeyEscrow treasury (fee recipient), #1 landlord,
#2 tenant, #3 KeyEscrow dispute desk (default arbiter). The demo lease is a Bangkok condo at 15,000 THB/month
(441.18 mUSDT at ~34 THB/USDT) with a 2-month deposit over 12 months. Its on-chain content hashes are SHA-256 of
the placeholder files in `web/public/demo/` (lease PDF and check-in photo manifest).

End-to-end check of every settlement path against a throwaway anvil (port 28545, started and killed by the runner):

```bash
pnpm e2e:chain            # deploy, seed, happy path, dispute, landlord timeout, arbiter fallback
```

It needs `pnpm -C web install` (it uses viem) and exits non-zero if any path fails.

## License

[MIT](LICENSE)
