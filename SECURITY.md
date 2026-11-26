# Security policy

KeyScrow is a hackathon prototype on **BSC testnet only**: no mainnet contracts, no real funds. Please still
report anything that would let someone move a deposit, rent or vault income they should not, or leak a key.

## Reporting a vulnerability

- Report it privately through GitHub: **Security → Report a vulnerability**
  (<https://github.com/midego1/bnb-hackathon/security/advisories/new>). Please do not open a public issue.
- Include the contract or route, the steps (or a Foundry test) that reproduce it, and what an attacker gains.
- Fixes land with a regression test; contract fixes need a testnet redeploy.

## Scope and known issues

The contracts' internal pre-audit review, with every finding, invariant, the Slither triage and the known
limitations, is in [docs/SECURITY.md](docs/SECURITY.md). Issues listed there as acknowledged are known and need no
report. Third-party services (CoinMarketCap, Atlas, Cournot, Living Brain, Anthropic) are out of scope.

## Personal data (dispute memory)

The dispute desk's history per wallet stores **wallet addresses only** and **factual entries** written by code from
on-chain events (no names, no user free text, no AI opinion of a person). To have a wallet's entries deleted (Thai
PDPA), sign a message with that wallet and send it through the private report link above; the operator deletes every
Living Brain page and capture labelled `wallet:<address>`. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#dispute-memory-per-wallet).
