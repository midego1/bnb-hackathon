# Agent instructions

Before starting any task, read docs/PRODUCT.md, docs/SPONSORS.md and docs/ACCEPTANCE.md.
If existing code conflicts with these docs, flag the conflict instead of silently rewriting.

| Read | For |
| --- | --- |
| [docs/PRODUCT.md](docs/PRODUCT.md) | The product and the case study (scooter rental in Thailand), scope, priorities and engineering rules. Source of truth. |
| [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) | Definition of done. |
| [docs/SPONSORS.md](docs/SPONSORS.md) | Sponsor track requirements. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the current code is built (contracts, web, agent). |
| [docs/README.md](docs/README.md) | Index of the other docs (API, deploy, demo, agent, business). |

Conventions (details in PRODUCT.md "Engineering rules"): BSC testnet only, no keys or `.env`
content in commits or frontend code, small readable Solidity.
Build and test: `pnpm build`, `pnpm test` (forge), `pnpm -C web test`, `pnpm agent:test`.
