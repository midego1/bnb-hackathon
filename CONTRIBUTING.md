# Contributing to KeyEscrow

Thanks for helping. KeyEscrow is a scooter rental deposit and rent escrow on BNB Chain (BSC testnet only). Read
[docs/PRODUCT.md](docs/PRODUCT.md) first: it is the source of truth for the product, scope and engineering rules.
How the code fits together is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). By taking part you agree to the
[Code of Conduct](CODE_OF_CONDUCT.md). Security issues: [SECURITY.md](SECURITY.md), not a public issue.

## Setup

Requirements: [Foundry](https://book.getfoundry.sh/getting-started/installation) (v1.10), Node 22, pnpm (the
version in `package.json` `packageManager`; `corepack enable` picks it up).

```bash
git clone --recursive https://github.com/midego1/bnb-hackathon.git && cd bnb-hackathon
pnpm run setup        # submodules, web + agent installs, forge build
```

No keys are needed. Every sponsor integration (CoinMarketCap, Atlas, Cournot, Living Brain, the AI inspector, Ask
AI) falls back to a labelled mock when its key is missing. Keys only ever go in untracked env files
(`web/.env.local`); see [.env.example](.env.example).

## Run the local demo

```bash
pnpm chain:anvil                                     # terminal 1: anvil on 127.0.0.1:8545, chain id 31337
pnpm chain:deploy && pnpm chain:seed                 # terminal 2: contracts, demo accounts, three demo rentals
echo "NEXT_PUBLIC_DEV_ACCOUNTS=1" > web/.env.local   # the Demo accounts bar: act as owner / renter / dispute desk / shareholder
pnpm dev                                             # http://localhost:3000/app, then ▶ Play the demo
```

The seeded accounts are anvil's public dev keys, which only work on a local chain. Details, the seeded rentals and
the `/demo` controls: [docs/DEMO.md](docs/DEMO.md#local-setup). After deploying to an anvil that was not fresh, run
`pnpm -C web sync:contracts`.

## Tests

Run the gates for the parts you touched before you open a pull request; CI runs them all
([.github/workflows](.github/workflows)).

| What | Command |
| --- | --- |
| Contracts (unit, fuzz, invariants) | `cd contracts && forge build && forge test` |
| Web lint, unit tests, build | `pnpm -C web lint && pnpm -C web test && pnpm -C web build` |
| Agent | `pnpm agent:test` (starts its own anvil) |
| Every money path with real transactions | `pnpm e2e:chain` (own anvil on :28545) |
| Browser tests | `cd web && npx playwright install chromium && npx playwright test` (own anvil :28546 + server :3150) |
| Coverage | `pnpm coverage`: contracts, web and agent, lcov in `<part>/coverage/`, updates the README badges |

Playwright runs two workers: the specs that use the shared anvil form the `chain` project and run one at a time,
the front-end-only ones run beside them in `ui` (see `web/playwright.config.ts`). A new spec is in `chain` by
default; add it to `UI_SPECS` only if it sends no transaction and asserts nothing about chain state.

Tests never call a real API or a public chain: provider keys are blanked in the test setups, and the e2e web server
gets a complete, hermetic environment (`web/e2e/env.ts`).

## Branches and commits

- Branch from `main` with a short topic name (e.g. `kb/oss-quality`, `demo-scroll`). One topic per branch, merged
  into `main`.
- Small commits, each one building and passing its tests. The subject is `<area>: <what changed>` in lower case,
  without a trailing period, e.g. `contracts: invariant tests for vault solvency` or `web/e2e: back office read
  checks`. The area is the part you touched: `contracts`, `web`, `web/e2e`, `agent`, `docs`, `ci`, `deploy`, or a
  feature such as `eli5` or `ask-ai`.
- The pull request says what changed, why, and how it was tested (the template asks for it).

## Rules that matter here

- **BSC testnet and local anvil only.** Never send a transaction to mainnet.
- **No secrets in the repo.** The repo is public: no keys, `.env` content or personal data in commits, issues or
  frontend code. Server-only keys never get a `NEXT_PUBLIC_` name.
- **Small, readable Solidity**, a test for every new path, and `pnpm -C web sync:contracts` after an ABI change.
- **Amounts in baht first.** Roles in the UI are owner / renter / dispute desk / shareholders (on-chain they are
  `landlord` / `tenant` / `arbiter`).
- All CoinMarketCap calls go through the backend and are logged.

## Adding an Ask AI tool

Ask AI's tools are generated from the rental action registry, so a new tool is one definition in
[`web/lib/actions/definitions.ts`](web/lib/actions/definitions.ts). The same definition also becomes a REST route
(`/api/v1/<name>`), an OpenAPI operation and an MCP tool + A2A skill on the agent.

1. Write a `read({...})` with `run`, or a `prepare({...})` with `build` returning the contract calls and a
   `summary`. Give it `roles`, `statuses`, an input schema built from the helpers in `web/lib/actions/fields.ts` and
   a valid `example`, then add it to `ACTIONS`. Name it in snake_case; writes start with `prepare_`.
2. Never sign or send in an action. A `prepare_*` returns unsigned calls; Ask AI simulates them and shows an
   approval card, and the person signs with their own wallet. The server fills `from`, `viewer` and `chainId` from
   the connected wallet (`SERVER_FIELDS` in `web/lib/assistant/tools.ts`), so the model never chooses them.
3. Optional: an Ask AI-only hint for the model in `ASSISTANT_NOTE` (`web/lib/assistant/tools.ts`), or a step in
   the demo model's script (`web/lib/assistant/mock.ts`) if the demo should use it.
4. Run `pnpm -C web test` and `pnpm agent:test`: they fail unless the action is an MCP tool, an A2A skill, an
   OpenAPI operation and a route with the same description and fields, and its `example` matches its schema.

More: [docs/AGENT.md, "How to add an action"](docs/AGENT.md#how-to-add-an-action) and
[docs/ASSISTANT.md](docs/ASSISTANT.md) (the safety model).
