# Docs

| Document | What it covers |
| --- | --- |
| [PRODUCT.md](PRODUCT.md) | Product spec and case study: scooter rental in Thailand. Source of truth for scope. |
| [ACCEPTANCE.md](ACCEPTANCE.md) | Definition of done for every feature. |
| [SPONSORS.md](SPONSORS.md) | Sponsor tracks we enter and what each requires. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System, contracts, web app and demo runner, the action layer (REST, OpenAPI, MCP, A2A), the agent, Cloudflare, the state machine, data flows for funding, settlement, dispute and timeouts, scalability. Mermaid diagrams. |
| [BUSINESS.md](BUSINESS.md) | The problem, users, the fee model with a THB example, the dispute desk and Fleet Vault operator fee, the roadmap and risks. |
| [WRITEUP.md](WRITEUP.md) | The CoinMarketCap x Atlas track: how KeyEscrow uses price data (server-side, cached, with fallbacks). |
| [API.md](API.md) | The server routes (`/api/settlement`, `/api/price`, `/api/evidence`) and their mock fallbacks. |
| [DEPLOY.md](DEPLOY.md) | The BSC testnet (97) deploy path: preflight, guarded broadcast, verification, local rehearsal. |
| [CLOUDFLARE.md](CLOUDFLARE.md) | The public deploy on Cloudflare Workers (web app + agent): build, local preview, secrets, one-time setup, deploy. Live. |
| [SETUP.md](SETUP.md) | Setting API keys on paseo-box from the browser: the local-only, write-only `/settings/secrets` page, its passcode and guards. |
| [DEMO.md](DEMO.md) | The 3-minute pitch script on the live site, a 30-second local backup, the `/demo` controls, local setup with the seeded accounts. |
| [screenshots/](screenshots/) | Screenshots of the main pages at 1470×830, from a seeded local anvil, and the script that takes them. |
| [AGENT.md](AGENT.md) | KeyEscrow Inspector: the AI inspection as an ERC-8004 agent (BNB Agent SDK, A2A + MCP), signed reports, testnet registration. |
| [ASSISTANT.md](ASSISTANT.md) | Ask AI, the in-app assistant: what it does, the safety model (never signs, approval of exact steps, untrusted data, limits), demo model vs Claude, env names. |

Each document has **Status** lines that separate what is on `main` from what is on the roadmap.
