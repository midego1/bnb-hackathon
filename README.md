# KeyEscrow

Rental deposit and rent escrow on **BNB Chain**. Built for BNB Bangkok 2026 (Developer Track + CoinMarketCap x Atlas).

A landlord creates a lease. The tenant funds deposit + first month's rent in a stablecoin into a per-lease
`RentalEscrow` contract. Rent is released monthly. At move-out, an AI inspection compares check-in and check-out
photos and proposes a deposit split. One party submits it on-chain, the other accepts, and the deposit settles instantly.
If they disagree, the arbiter rules. If the landlord does not respond in time, the deposit goes back to the tenant.
**Neither party can move funds alone.**

## Repo layout

```
contracts/   Foundry project: EscrowFactory, RentalEscrow, MockUSDT + tests
web/         Next.js (App Router) + TypeScript + Tailwind + wagmi/viem + RainbowKit
web/app/api  Server routes: AI settlement, price (CMC/Atlas), evidence upload (Greenfield)
docs/        Architecture, write-up, business model, demo script
```

## Networks

| Network | Chain ID | Use |
| --- | --- | --- |
| Anvil (local) | 31337 | development and scripted end-to-end tests |
| BSC testnet | 97 | hackathon deployment |
| opBNB testnet | 5611 | supported in the frontend |

Testnet only. MockUSDT is a test stablecoin stand-in; KeyEscrow has no token of its own.

## Setup

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

## License

MIT
