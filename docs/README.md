# Docs

| Document | What it covers |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | The components, the lease state machine, money flows, off-chain services and scalability. Includes mermaid diagrams. |
| [BUSINESS.md](BUSINESS.md) | The problem, users, the fee model with a THB example, dispute-desk revenue, the roadmap and risks. |
| [WRITEUP.md](WRITEUP.md) | The CoinMarketCap x Atlas track: how KeyEscrow uses price data (server-side, cached, with fallbacks). |
| [API.md](API.md) | The server routes (`/api/settlement`, `/api/price`, `/api/evidence`) and their mock fallbacks. |
| [DEPLOY.md](DEPLOY.md) | The BSC testnet (97) deploy path: preflight, guarded broadcast, verification, local rehearsal. |
| [DEMO.md](DEMO.md) | The one-click demo and a 3-minute demo script on a local anvil chain, with the seeded accounts and leases. |
| [screenshots/](screenshots/) | Screenshots of every page, taken from a seeded local anvil. |
| [AGENT.md](AGENT.md) | KeyEscrow Inspector: the AI inspection as an ERC-8004 agent (BNB Agent SDK, A2A + MCP), signed reports, testnet registration. |

Each document has **Status** lines that separate what is on `main` from what is on the roadmap.
