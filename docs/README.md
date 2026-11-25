# Docs

| Document | What it covers |
| --- | --- |
| [PRODUCT.md](PRODUCT.md) | Product spec and case study: scooter rental in Thailand. Source of truth for scope. |
| [ACCEPTANCE.md](ACCEPTANCE.md) | Definition of done for every feature. |
| [SPONSORS.md](SPONSORS.md) | Sponsor tracks we enter and what each requires. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | The components, the rental state machine, money flows, off-chain services and scalability. Includes mermaid diagrams. |
| [BUSINESS.md](BUSINESS.md) | The problem, users, the fee model with a THB example, dispute-desk revenue, the roadmap and risks. |
| [WRITEUP.md](WRITEUP.md) | The CoinMarketCap x Atlas track: how KeyEscrow uses price data (server-side, cached, with fallbacks). |
| [API.md](API.md) | The server routes (`/api/settlement`, `/api/price`, `/api/evidence`) and their mock fallbacks. |
| [DEPLOY.md](DEPLOY.md) | The BSC testnet (97) deploy path: preflight, guarded broadcast, verification, local rehearsal. |
| [CLOUDFLARE.md](CLOUDFLARE.md) | The public deploy on Cloudflare Workers (web app + agent): build, local preview, secrets, one-time setup, deploy. Prepared, not deployed yet. |
| [SETUP.md](SETUP.md) | Setting API keys on paseo-box from the browser: the local-only, write-only `/settings/secrets` page, its passcode and guards. |
| [DEMO.md](DEMO.md) | The one-click demo and a 3-minute demo script on a local anvil chain, with the seeded accounts and rentals. |
| [screenshots/](screenshots/) | Screenshots of every page, taken from a seeded local anvil. |
| [SECURITY.md](SECURITY.md) | Pre-audit smart-contract security review: findings, fixes, invariants, known limitations, what needs a redeploy. |
| [AGENT.md](AGENT.md) | KeyEscrow Inspector: the AI inspection as an ERC-8004 agent (BNB Agent SDK, A2A + MCP), signed reports, testnet registration. |

Each document has **Status** lines that separate what is on `main` from what is on the roadmap.
