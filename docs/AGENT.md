# KeyEscrow Inspector: the AI inspection as a BNB Chain agent

KeyEscrow Inspector is the return inspection from `POST /api/settlement`, run as an agent that other software can
find and call. It has an on-chain identity on BNB Chain (ERC-8004), it exposes the inspection skill over A2A and MCP (plus every rental action as a tool, [below](#rental-actions-as-agent-tools)), and it
signs every report it produces. The on-chain proposal therefore names the agent that made it: the renter or
owner (`landlord`) passes `reportHash` to `RentalEscrow.propose()`, and that hash covers the inspector's ERC-8004 agent id.
The UI shows this as "Signed by KeyEscrow Inspector, ERC-8004 agent #N".

It is built on the [BNB Agent SDK](https://github.com/bnb-chain/bnbagent-sdk) (`@bnbagent/sdk`, MIT), the same SDK
that [BNB Agent Studio](https://www.bnbchain.org/en/bnb-agent-studio) generates agents from. Its two faces use the
same libraries a Studio-generated agent uses: `@a2a-js/sdk` for A2A and `@modelcontextprotocol/sdk` for MCP.

**Status:** live. The agent is registered on BSC testnet as ERC-8004 agent **#2921** in the Identity Registry
`0x8004A818BFB912233c491871b3d84c89A494BD9e`
([registration tx](https://testnet.bscscan.com/tx/0x40c7cf2008857eabb197df1453e33b3b45760fdec8e7f846ac23a4c2e73328c0),
record in `agent/deployments/97.json`) and runs at <https://keyescrow-agent.mdgooijer.workers.dev>
([agent card](https://keyescrow-agent.mdgooijer.workers.dev/.well-known/agent-card.json), MCP at `POST /mcp`).
Reports are signed only where `INSPECTOR_PRIVATE_KEY` is set; otherwise they say they are unsigned. Payments per
inspection (ERC-8183 / x402) are on the [roadmap](#roadmap-pay-per-inspection-erc-8183--x402) and are not built.

## Contents

- [How it fits together](#how-it-fits-together)
- [Run it locally](#run-it-locally)
- [The skill](#the-skill)
- [Rental actions as agent tools](#rental-actions-as-agent-tools)
- [ERC-8004 identity and signed reports](#erc-8004-identity-and-signed-reports)
- [Register on BSC testnet](#register-on-bsc-testnet)
- [Local rehearsal](#local-rehearsal)
- [Why the SDK rather than a generated Studio project](#why-the-sdk-rather-than-a-generated-studio-project)
- [Roadmap: pay per inspection (ERC-8183 / x402)](#roadmap-pay-per-inspection-erc-8183--x402)
- [Tests](#tests)

## How it fits together

```mermaid
flowchart LR
  subgraph agent["agent/ (KeyEscrow Inspector)"]
    A2A["A2A: /.well-known/agent-card.json, POST /a2a"] --> S
    MCP["MCP: POST /mcp"] --> S
    REST["REST: POST /inspect"] --> S
    S["inspect_move_out"]
  end
  WEB["web/ POST /api/settlement"] --> CORE
  S --> CORE["web/lib/server/settlement<br/>proposeSettlement() + signer"]
  CORE -->|"report incl. inspector {agentId, registry, address}<br/>reportHash + inspectorSignature"| P["renter / owner"]
  P -->|"propose(tenantRefund, reportHash)"| E["RentalEscrow"]
  REG["ERC-8004 Identity Registry (BSC)<br/>agent #N: tokenURI = registration file,<br/>metadata reportSigner = signer address"]
  V["anyone"] -->|"recompute hash, recover signer,<br/>compare with reportSigner"| REG
```

- **One implementation.** The agent imports `proposeSettlement` and the schema from `web/lib/server/settlement`
  instead of copying them. The agent and the web app return the same JSON with the same `reportHash` for the same
  input; a test checks this.
- **Provider-agnostic, offline by default.** The same `VISION_LLM_PROVIDER` / `ANTHROPIC_API_KEY` /
  `VISION_LLM_MODEL` switches apply. Without a key, the deterministic mock runs. The agent never calls Pieverse or
  any paid LLM gateway.
- **Off-chain link, no contract change.** The identity goes into the hashed report, so `RentalEscrow` stays as it
  is. The only Solidity added is a test-only registry stand-in for the rehearsal
  (`contracts/test/mocks/MockIdentityRegistry.sol`).

## Run it locally

Needs `pnpm -C web install` (the agent loads the settlement code and its dependencies from `web/`) and
`pnpm -C agent install`. `pnpm setup` installs both.

```bash
pnpm agent:dev                # A2A + MCP + REST on http://127.0.0.1:8790 (AGENT_HOST / AGENT_PORT to change)
pnpm agent:call:mcp           # sample MCP client: tools/list, inspect_move_out, verify_report
pnpm agent:call:a2a           # sample A2A client: resolve the card, message/send with a data part
pnpm agent:card               # print the agent card and the ERC-8004 registration file
```

Output in mock mode, without a signer key (trimmed):

```text
$ pnpm agent:dev
KeyEscrow Inspector listening on http://127.0.0.1:8790
  A2A card      http://127.0.0.1:8790/.well-known/agent-card.json  (JSON-RPC http://127.0.0.1:8790/a2a)
  MCP           http://127.0.0.1:8790/mcp
  REST          http://127.0.0.1:8790/inspect
  ERC-8004 file http://127.0.0.1:8790/.well-known/agent-registration.json
  provider      mock (deterministic, no key)
  identity      none: reports are unsigned (set INSPECTOR_PRIVATE_KEY, see docs/AGENT.md)

$ pnpm agent:call:mcp
MCP http://127.0.0.1:8790/mcp tools: inspect_move_out, verify_report, inspector_identity
{
  "tenantRefund": "450000000",
  "landlordClaim": "50000000",
  "reasons": ["Kitchen: appliance not cleaned; grease build-up visible (est. cleaning)."],
  "confidence": 0.62,
  "deposit": "500000000", "decimals": 6, "currency": "USDT",
  "mock": true, "provider": "mock", "repairs": [],
  "checkIn": […], "checkOut": […],
  "createdAt": "2026-11-25T10:49:41.513Z",
  "reportHash": "0x…"
}
verify_report: {"hashValid":true,"signer":null,"signatureValid":false}
```

With a signer and an ERC-8004 identity set (here from the [local rehearsal](#local-rehearsal), agent #0 on a
chainId-97 anvil), every result also carries:

```json
"inspector": {
  "name": "KeyEscrow Inspector",
  "address": "0x738A4b557D1d41AA56D74d7B573fD68826b3B4C2",
  "agentId": "0",
  "agentRegistry": "eip155:97:0x8004A818BFB912233c491871b3d84c89A494BD9e"
},
"reportHash": "0x86bb56ce…f0e1",
"inspectorSignature": "0x79c7668f…5381b"
```

Agent env (all server-side; names are also in `.env.example`):

| Variable | Meaning |
| --- | --- |
| `AGENT_HOST`, `AGENT_PORT` | Listen address, default `127.0.0.1:8790` |
| `AGENT_PUBLIC_URL` | Base URL in the agent card and registration file (default `http://<host>:<port>`) |
| `INSPECTOR_PRIVATE_KEY` | Report-signing key. Unset: reports are unsigned. Never `NEXT_PUBLIC_`. |
| `INSPECTOR_AGENT_ID`, `INSPECTOR_AGENT_REGISTRY` | ERC-8004 agent id and `eip155:97:<registry>`. If unset, they are read from `agent/deployments/97.json` (`INSPECTOR_DEPLOYMENT` overrides the path). The agent refuses to start when the key is not that record's `reportSigner`. |
| `VISION_LLM_PROVIDER`, `ANTHROPIC_API_KEY`, `VISION_LLM_MODEL` | Same as the web app; mock without a key |
| `EVIDENCE_DIR` | Evidence store for photos given by hash in live mode (default `web/.evidence`, shared with the web app) |

The web app signs too: set the same `INSPECTOR_PRIVATE_KEY`, `INSPECTOR_AGENT_ID` and `INSPECTOR_AGENT_REGISTRY`
in `web/.env.local`, and `POST /api/settlement` returns signed reports. The return panel then shows "Signed by
KeyEscrow Inspector, ERC-8004 agent #N" under the inspector's suggestion.

## The skill

`inspect_move_out` takes the same body as [`POST /api/settlement`](API.md#post-apisettlement) and returns the same
result. The input is validated with the same zod schema, and `tenantRefund + landlordClaim == deposit` always holds.

| Face | How to call it |
| --- | --- |
| A2A (protocol 0.3.0, JSON-RPC) | Card at `/.well-known/agent-card.json`. Send `message/send` to `/a2a` with one data part: the request object. An optional `"skill": "inspect_move_out"` key is accepted. The reply is one agent message with a data part: the result, or `{error, details?, status}`. |
| MCP (Streamable HTTP, stateless) | `POST /mcp`. Tools: `inspect_move_out` (result in `structuredContent`), `verify_report` (recompute the hash, recover the signer), `inspector_identity`. Errors come back as `isError: true` with `{error, details?}`. |
| REST | `POST /inspect`: 200 with the result, 400 for invalid input, 502 when the model fails. |

## Rental actions as agent tools

Besides the inspection, the agent serves every KeyEscrow rental action as a tool, so an AI assistant can run a scooter
rental for a person: read where the deposit is, create a rental from baht amounts, fund it, propose the deposit split,
accept, dispute, rule, claim a missed deadline. **Each action is defined once** in
[`web/lib/actions/definitions.ts`](../web/lib/actions/definitions.ts) and served from that one definition as:

| Face | Where | Generated from the definition |
| --- | --- | --- |
| MCP tool | agent `POST /mcp` (next to `inspect_move_out`) | name, title, description, JSON Schema of the input, validation |
| A2A skill | agent card `/.well-known/agent-card.json`, `message/send` with `{"skill": "<name>", ...input}` | id, name, description, example |
| REST | web app `GET /api/v1/<read>?…`, `POST /api/v1/<prepare_*>` | route table, validation, errors |
| OpenAPI 3.1 | web app `GET /api/v1/openapi.json`, docs page `/developers` (curl per action) | operation, parameters / request body, roles, statuses |
| Web forms | create rental, propose split, rule on a dispute | the same field schemas and messages (`fieldError`) |

**Non-custodial.** Reads return JSON. Every `prepare_*` returns `{chainId, from, steps: [{to, data, value,
description}], summary}` with **unsigned** transactions, after dry-running all steps in order on the chain
(`eth_simulateV1`, so "approve, then fund" is checked as a pair). A step that would revert comes back as a plain
reason (`"Step 1 (Create the rental offer) would fail: Owner, renter and arbiter must be three different
addresses."`) before anyone signs. Nothing in this layer holds or uses a private key: the person signs the steps with
their own wallet. Roles and status are checked first (`409 precondition_failed`), so a renter who asks to accept their
own proposal is told why instead of getting a revert.

| Action | Kind | Who | Needs status | What it does |
| --- | --- | --- | --- | --- |
| `get_lease` | read | anyone | | Terms, status, months paid, current proposal and deadlines, mUSDT with baht/dollar equivalents |
| `list_leases` | read | anyone | | A wallet's rentals (as owner, renter or dispute desk) from the factory's on-chain index |
| `explain_status` | read | anyone | | Plain language: where the deposit is, what can happen next, who must act by when |
| `quote` | read | anyone | | THB / USD / mUSDT at the price API's rate (Atlas, CMC, else marked demo rates) |
| `prepare_create_lease` | prepare | owner | | `createLease` (or `createLeaseWithPayee` with `payee`, e.g. a Fleet Vault); rent and deposit in THB, USD or mUSDT |
| `prepare_fund` | prepare | renter | Created | `approve` (only if needed) + `fund` |
| `prepare_release_rent` | prepare | anyone | Active, MoveOut, Disputed | `releaseRent` for due months (the renter may release early) |
| `prepare_add_evidence` | prepare | owner, renter | not closed | `addEvidence(kind, sha256)` for pickup / return photos or a report |
| `prepare_propose_settlement` | prepare | owner, renter | Active, MoveOut | `propose`, from an amount or straight from an `inspect_move_out` result |
| `prepare_accept` | prepare | the other side | MoveOut | `accept(nonce)`, pinned to the proposal that was reviewed |
| `prepare_dispute` | prepare | owner, renter | Active, MoveOut | `dispute` |
| `prepare_resolve` | prepare | dispute desk | Disputed | `resolve(toRenter, sha256(ruling))` |
| `prepare_claim_timeout` | prepare | anyone | MoveOut, Disputed | `claimTimeout` or `claimArbiterTimeout`, whichever deadline was missed |
| `prepare_cancel` | prepare | owner | Created | `cancel` an unfunded offer |

On-chain names: owner = `landlord`, renter = `tenant`, dispute desk = `arbiter`. Amounts in: human mUSDT strings
(`"441.18"`) or baht/dollars where a `currency` field says so. Amounts out: `{units, display}` (base units and
`"441.18 mUSDT"`).

**Chains.** 31337 (local anvil) and 97 (BSC testnet), addresses from `contracts/deployments/*.json` (via
`web/lib/contracts`). Each call may pass `chainId`; the default is `KEYESCROW_CHAIN_ID`, else `NEXT_PUBLIC_CHAIN_ID`,
else 31337. Reads and simulations go through a server RPC: `KEYESCROW_RPC_URL_<chainId>`, defaulting to the web app's
anvil URL for 31337 and to PublicNode for 97 (the bnbchain.org data-seed nodes refuse `eth_getLogs`; PublicNode also
answers `eth_simulateV1`). The code is Worker-friendly: fetch-based RPC, env passed in, no fs, no module state.

### One definition, every face

```ts
export const prepareDispute = prepare({
  name: "prepare_dispute",                    // MCP tool name, A2A skill id, POST /api/v1/prepare_dispute
  title: "Open a dispute",
  description: "Prepare the transaction that sends the rental to the dispute desk. …",   // what the LLM reads
  roles: ["owner", "renter"],                 // checked against `from` before simulating
  statuses: ["Active", "MoveOut"],            // checked against the chain before simulating
  input: z.object({ lease: leaseField(), from: fromField("the owner or the renter"), chainId: chainId() }).strict(),
  example: { lease: EX.lease, from: EX.renter },   // curl example on /developers, checked by the tests
  build: async ({ lease }, { lease: l }) => ({ calls: [{ to: lease, abi: rentalEscrowAbi, functionName: "dispute", description: "Open a dispute" }], summary: `…` }),
});
```

`ACTIONS` lists the definitions. `agent/src/mcp.ts` loops over it to register the tools, `agent/src/card.ts` to
build the A2A skills, `web/lib/actions/rest.ts` to build the route table behind `web/app/api/v1/[action]/route.ts`,
and `web/lib/actions/openapi.ts` to write the OpenAPI document. The tool description every face shows is the
definition's text plus the generated "Who / Needs rental status / Returns unsigned transactions" lines.

### Connect Claude

Run the agent (`pnpm agent:dev`, MCP at `http://127.0.0.1:8790/mcp`; set `KEYESCROW_CHAIN_ID=97` for BSC testnet),
then point Claude at it. Replace the URL with the agent's public URL once it is hosted.

Claude Code:

```bash
claude mcp add --transport http keyescrow http://127.0.0.1:8790/mcp
```

or in a project's `.mcp.json`:

```json
{ "mcpServers": { "keyescrow": { "type": "http", "url": "http://127.0.0.1:8790/mcp" } } }
```

Claude Desktop (`claude_desktop_config.json`; the `mcp-remote` bridge turns the HTTP server into a local stdio one,
or add the URL under Settings, Connectors when the agent has a public https URL):

```json
{ "mcpServers": { "keyescrow": { "command": "npx", "args": ["-y", "mcp-remote", "http://127.0.0.1:8790/mcp"] } } }
```

Example chat (what Claude does with the tools, abridged):

> **Owner:** Rent my scooter to 0x3C44…93BC for 6 months, 3,500 baht a month, 2 months deposit. My wallet is 0x7099…79C8.
>
> **Claude** (calls `prepare_create_lease` with `rent: "3500", currency: "THB", depositMonths: 2, termMonths: 6`):
> Here is the rental, ready to sign: rent 106.06 mUSDT a month (3,500 THB at 33 THB/USDT, demo rate), deposit
> 212.12 mUSDT (2 months). You have 7 days to answer the renter's return proposal; the KeyEscrow dispute desk has 14
> days to rule on a dispute. One transaction to sign with your wallet: *Create the rental offer*. Next, the renter
> funds 318.18 mUSDT.
>
> **Renter:** Where is my deposit?
>
> **Claude** (calls `list_leases` for the renter's wallet, then `explain_status` with `viewer`): It is held in the
> escrow contract 0xA22D…70c3, not by the owner: it only moves when you both agree, the dispute desk rules, or a
> deadline passes. Rent: 1 of 6 months paid in. When you return the scooter you can propose how the deposit is split
> (`prepare_propose_settlement`); if the owner does not answer within 7 days, the full deposit comes back to you
> (`prepare_claim_timeout`).

### Demo

`pnpm agent:demo:tools` runs all of this on a throwaway local anvil (free port in 28660-28689, deployed and seeded
with the forge scripts), as an MCP client over HTTP: it lists the tools, asks `explain_status` about the seeded
rental, prepares a rental from baht amounts, signs the returned steps with anvil's public dev keys, has the renter
fund it (approve + fund), and shows a simulated revert coming back as a plain reason. It refuses to sign unless the
steps and the node both say chainId 31337; it never signs on BSC testnet. Output (trimmed):

```text
local anvil http://127.0.0.1:28660 (chainId 31337), seeded rental 0x9f1ac54BEF0DD2f6f3462EA0fa94fC62300d3a8e

MCP http://127.0.0.1:40147/mcp: tools/list
   | inspect_move_out             Move-out inspection
   | verify_report                Verify an inspection report
   | inspector_identity           Inspector identity
   | get_lease                    Get a rental
   | list_leases                  List rentals of a wallet
   | explain_status               Explain where the deposit is
   | quote                        Convert baht / dollars / mUSDT
   | prepare_create_lease         Create a rental
   | prepare_fund                 Fund the rental (renter)
   | …                            (release rent, evidence, propose, accept, dispute, resolve, claim timeout, cancel)

"Where is my deposit?" (renter 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC, seeded rental)
> tools/call explain_status {"lease":"0x9f1a…3a8e","viewer":"0x3C44…93BC"}
   | You are the renter. Rental running.
   | Deposit (200.00 mUSDT): Held in the escrow contract 0x9f1a…3a8e. Neither side can take it alone: it only moves
   | on agreement, a dispute-desk ruling or a timeout.
   | Rent 100.00 mUSDT a month: 1 of 3 month(s) paid into escrow, 0 paid out to the owner, 1 still held. …
   | What can happen next:
   | - anyone: Pay 1 due month(s) of rent out to the owner. [prepare_release_rent]
   | - the renter: At return, propose how the deposit is split (e.g. from the AI inspection). [prepare_propose_settlement]
   | …

"Rent my scooter to 0x3C44…93BC for 6 months, 3,500 baht a month, 2 months deposit"
> tools/call prepare_create_lease {"from":"0x7099…79C8","renter":"0x3C44…93BC","rent":"3500","currency":"THB","depositMonths":2,"termMonths":6}
   | summary: Create a 6-month rental for renter 0x3C44…93BC: rent 106.06 mUSDT a month (THB 3500 at 33.00 THB/USDT,
   | demo rate), deposit 212.12 mUSDT (2 months of rent). … Next: the renter funds 318.18 mUSDT with prepare_fund.
   | steps:   Create the rental offer
   | expected rental: 0xA22D78bc37cE77FeE1c44F0C2C0d2524318570c3
   | signed step 1 (Create the rental offer) as 0x70997970C51812dc3A010C7d01b50e0d17dc79C8: success, block 24

Renter: prepare_fund (approve + fund, simulated as a pair)
   | steps:   Approve 318.18 mUSDT for the escrow -> Pay the deposit and first month's rent into escrow
   | signed step 1 (Approve 318.18 mUSDT for the escrow) as 0x3C44…93BC: success, block 25
   | signed step 2 (Pay the deposit and first month's rent into escrow) as 0x3C44…93BC: success, block 26

get_lease after signing
   | status Active · deposit 212.12 mUSDT · rent 106.06 mUSDT/month · escrow holds 318.18 mUSDT

A mistake comes back as a plain reason before anyone signs (the simulation reverts):
   | {"error":"Step 1 (Create the rental offer) would fail: Owner, renter and arbiter must be three different addresses.",
   |  "code":"simulation_reverted","details":{"step":1,"function":"createLease((address,…))","errorName":"RolesNotDistinct"}}
```

### How to add an action

Adding a field or an action is one edit in `web/lib/actions/definitions.ts`; every face picks it up.

1. **A field:** add it to the action's `input` with a helper from `web/lib/actions/fields.ts` (`field.address`,
   `field.tokenAmount`, `field.money` + `field.currency`, `field.int(min, max, …)`, `field.bytes32`, `field.text`)
   and a `title` and `description` written for a person and an LLM (`"x-unit"` for units). Use it in `build`.
   Example: `payee` on `prepare_create_lease` (switches to `createLeaseWithPayee`) was added this way.
2. **An action:** write a `read({...})` (with `run`) or `prepare({...})` (with `build` returning the contract calls
   and a `summary`), give it `roles`, `statuses` and a valid `example`, and add it to `ACTIONS`. Name it in
   snake_case; writes start with `prepare_`. Never sign or send in an action: return calls, the runner encodes and
   simulates them.
3. Run `pnpm -C web test` and `pnpm agent:test`. `agent/test/actions.test.ts` iterates every definition and fails
   unless it is an MCP tool, an A2A skill, an OpenAPI operation and a route, all with the same description and
   fields; `web/tests/actions.test.ts` checks every `example` against its own schema. No other file needs to change
   (the `/developers` page, the OpenAPI document and the tool list are generated).

Agent env for the tools: `KEYESCROW_CHAIN_ID`, `KEYESCROW_RPC_URL_31337`, `KEYESCROW_RPC_URL_97` (all optional, see
above). The price source for baht conversions is the same `PriceService` as `GET /api/price`.

## ERC-8004 identity and signed reports

[ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) gives an agent an on-chain identity: an NFT in an Identity
Registry whose `tokenURI` is a registration file listing the agent's name and endpoints. The BNB Agent SDK ships the
BSC registry addresses (testnet `0x8004A818BFB912233c491871b3d84c89A494BD9e`).

KeyEscrow ties a settlement report to that identity in three steps:

1. **Registration.** `pnpm agent:register` calls the SDK's `ERC8004Agent.registerAgent` with a data-URI
   registration file (built by the SDK's `AgentURIGenerator`). The file lists the A2A card and the MCP endpoint and
   points back at `eip155:97:<registry>` with the new agent id. The registration also stores one metadata entry,
   `reportSigner`, the 20-byte address of the server key that signs reports. The owner key (the deployer) is kept
   apart from the signing key, which is the only key the server holds.
2. **Report.** `proposeSettlement` adds `inspector: {name, address, agentId, agentRegistry}` to the report
   *before* hashing. `reportHash` is still the sha256 of the canonical JSON (sorted keys), now without
   `reportHash` and `inspectorSignature`. The signer then signs `reportHash` (EIP-191 `personal_sign` over the 32
   bytes) as `inspectorSignature`. A report for another agent id gives another hash, so the hash submitted on-chain
   pins the agent.
3. **Verification.** Anyone holding the report recomputes the hash, recovers the signer from
   `inspectorSignature`, and checks that the signer equals `getMetadata(agentId, "reportSigner")` on the registry
   named in the report. `pnpm agent:verify` does all of this. `verifyInspectorReport()` in
   `web/lib/server/settlement/inspector.ts` and the MCP tool `verify_report` do the offline half.

```text
$ BSC_TESTNET_RPC_URL=http://127.0.0.1:28560 AGENT_URL=http://127.0.0.1:28563 pnpm agent:verify
report 0x3afa…76dd: tenantRefund 450000000, landlordClaim 50000000
  ✓ reportHash = sha256(canonical JSON of the report)
  ✓ inspectorSignature recovers to the report's inspector 0x738A…B4C2
  ✓ report names ERC-8004 agent #0 in eip155:97:0x8004A818BFB912233c491871b3d84c89A494BD9e
  ✓ RPC chainId 97 matches the registry reference
  ✓ agent #0 exists, owner 0xA7CE…D59E
  ✓ on-chain reportSigner 0x738A…B4C2 signed this report
  ✓ tokenURI registration file names "KeyEscrow Inspector"
  ✓ registered endpoints are on http://127.0.0.1:28563
  ✓ registration file points back at this agent id and registry
VERIFIED: signed by KeyEscrow Inspector, ERC-8004 agent #0
```

When no signer is configured, reports have no `inspector` field and hash exactly as before, so nothing changes for
existing leases or tests.

## Register on BSC testnet

This step is for the coordinator. It runs together with the contracts' testnet deploy ([DEPLOY.md](DEPLOY.md)) and
uses the same env and keystore approach as `contracts/script/testnet.sh`. It is never run automatically.

```bash
# names in .env (values never committed): BSC_TESTNET_RPC_URL, DEPLOYER_ADDRESS, DEPLOYER_ACCOUNT (or
# DEPLOYER_KEYSTORE / PRIVATE_KEY), DEPLOYER_PASSWORD_FILE, INSPECTOR_SIGNER_ADDRESS, AGENT_PUBLIC_URL
pnpm agent:register:check                                   # preflight, sends nothing
ALLOW_NON_LOCAL_BROADCAST=true pnpm agent:register          # asks you to type "register"; `-- --yes` skips it
```

- **Preflight** checks that the RPC answers chainId 97 (chainId 56 is refused outright, exit 2), that the registry
  has code, that exactly one wallet is configured and matches `DEPLOYER_ADDRESS`, that the balance covers
  `register` + `setAgentURI` (1.5M gas at the current gas price, with headroom), and that `AGENT_PUBLIC_URL` is set. Anvil's public dev
  accounts are refused as deployer or signer, and so is a second registration while `agent/deployments/97.json`
  exists (`FORCE_REREGISTER=true` overrides).
- **Wallet.** The keystore is decrypted in memory and handed to the SDK's `EVMWalletProvider` with a throwaway
  wallets dir in the OS temp dir, removed afterwards. Nothing is written to `~/.bnbagent`. MegaFuel sponsorship is
  off: the deployer pays its own gas, and no third-party relay is contacted.
- **Result.** `agent/deployments/97.json` holds the agent id, registry, owner, `reportSigner`, `agentURI` and tx
  hash. Commit it. The script then prints the server env to set: `INSPECTOR_AGENT_ID`,
  `INSPECTOR_AGENT_REGISTRY` and `INSPECTOR_PRIVATE_KEY` (the key of `INSPECTOR_SIGNER_ADDRESS`).
- **Endpoint.** The registration file lists `AGENT_PUBLIC_URL` as the A2A and MCP endpoint. Until the agent runs
  somewhere public, other agents cannot reach that URL, but the identity, the `reportSigner` and the signed reports
  still verify. If the URL changes later, point the identity at it with `pnpm agent:set-uri` (below).

## Point the registered agent at its public URL (`setAgentURI`)

Agent #2921 was registered with GitHub tree pages as its A2A and MCP endpoints. The live agent is the Worker
([CLOUDFLARE.md](CLOUDFLARE.md)), so the owner replaces the registration file:

```bash
# same .env names as above (INSPECTOR_SIGNER_ADDRESS not needed); AGENT_PUBLIC_URL = the live Worker
AGENT_PUBLIC_URL=https://keyescrow-agent.mdgooijer.workers.dev pnpm agent:set-uri:check   # preflight, sends nothing
AGENT_PUBLIC_URL=https://keyescrow-agent.mdgooijer.workers.dev ALLOW_NON_LOCAL_BROADCAST=true pnpm agent:set-uri
# asks you to type "set-uri"; `-- --yes` skips it
```

- It reads `agentId` and the registry from `agent/deployments/97.json` and rebuilds the file with the SDK's
  `AgentURIGenerator` (same as `registerAgent`, including `registrations[]`): A2A at
  `<AGENT_PUBLIC_URL>/.well-known/agent-card.json`, MCP at `<AGENT_PUBLIC_URL>/mcp`.
- Preflight runs the same checks as registration (chainId 97 only, 56 refused; one wallet; anvil accounts refused;
  gas for about 600k). It also checks that `ownerOf(agentId)` is `DEPLOYER_ADDRESS`, refuses a loopback
  `AGENT_PUBLIC_URL`, and prints the endpoints on-chain now and the new ones. If the file on-chain is already the new
  one, nothing is sent.
- The broadcast needs `ALLOW_NON_LOCAL_BROADCAST=true` and the typed confirmation. It calls the SDK's
  `setAgentUri`, reads `tokenURI` back, and must find the new file. Then it updates `agent/deployments/97.json`:
  `agentURI`, `publicUrl`, `setUriTx`, `updatedAt` (`registerTx` and `registeredAt` stay). Commit the file.
- Check with `BSC_TESTNET_RPC_URL=… AGENT_URL=https://keyescrow-agent.mdgooijer.workers.dev pnpm agent:verify`.
  With `--report <file>`, set `AGENT_PUBLIC_URL` to get the endpoint check.

## Local rehearsal

```bash
pnpm agent:rehearse
```

`agent/scripts/rehearse.sh` runs the whole registration path against throwaway anvil nodes on 127.0.0.1 (ports
28560-28569): one started with `--chain-id 97` and one with `--chain-id 56`. The SDK has no local registry, so the
script compiles `contracts/test/mocks/MockIdentityRegistry.sol` (the subset of the reference IdentityRegistry ABI
the SDK uses, with the same events; 6 forge tests) and places it with `anvil_setCode` at the canonical testnet
registry address. `register.ts` then runs unchanged: same chainId, same registry address, only the RPC URL differs.
The deployer is a fresh keystore in a temp dir, funded with `anvil_setBalance`.

It checks 33 things: preflight failures (nothing set, unreachable RPC, chainId 56, anvil account, two wallets,
unfunded), that preflight sends nothing, refusal without `ALLOW_NON_LOCAL_BROADCAST` and without confirmation, the
registration itself (agent #0, `97.json`, an on-chain `tokenURI` with `registrations[]`), refusal to register twice,
the agent starting with that identity, the MCP and A2A calls, `pnpm agent:verify` against the registry, the agent
refusing a key that is not the registered `reportSigner`, `set-uri` (verify flagging the old endpoints, a non-owner
refused, check / no flag / no confirmation sending nothing, the update with `97.json` and `tokenURI` matching, verify
passing on the new URL, a repeat sending nothing), and an unchanged git status. Everything is removed on exit.

## Why the SDK rather than a generated Studio project

We spent a timeboxed spike on BNB Agent Studio first, with every tool project-local (no global install, no
`bag skills install`, HOME pointed at a scratch dir):

- `pnpm dlx @bnbagent/studio-cli@0.0.16 init inspector --llm-provider none --protocols A2A,MCP --rails 8183
  --seller-price-usd 0 --destination self --storage-provider local --no-onboard --no-install` scaffolds offline
  with no sign-up. It writes `~/.bnbagent-studio/projects.toml`, which is why HOME has to be redirected.
- The generated agent is an ERC-8183 seller. Its A2A/MCP skills are `negotiate` (signed quote) and
  `notify_funded`, and its work hook runs only after a buyer has funded an ERC-8183 job on BSC testnet or mainnet.
  It also carries AgentCore/Azure deploy descriptors, x402/B402 rails and Pieverse LLM wiring. A local demo of our
  skill would need a funded testnet job, which this project does not do, and `bag dev`/`bag deploy` lead towards
  the managed trial or a cloud account.
- `@bnbagent/sdk` itself runs fully locally. It accepts an explicit `NetworkConfig` (our RPC, our registry, paymaster
  off) and a `walletsDir` override. Its ERC-8004 module (`ERC8004Agent`, `AgentURIGenerator`, `AgentEndpoint`) is
  everything the identity needs.

So the agent uses the SDK directly for identity, and the same A2A and MCP libraries as a Studio project for its
faces, with our own skill. A generated Studio project can be added later for paid jobs (next section) without
changing the identity: ERC-8183 jobs reference the same ERC-8004 agent.

SDK rough edges we hit: metadata values are encoded with viem `toBytes`, so an address string is stored as raw 20
bytes and the SDK's `getMetadata` (UTF-8 decode) reads it back as garbage. We read `reportSigner` ourselves
(`decodeReportSigner`). The bsc-testnet preset also turns MegaFuel sponsorship on by default, so we pass an explicit
`NetworkConfig` with `usePaymaster: false`.

## Roadmap: pay per inspection (ERC-8183 / x402)

Not built. This is how payments would plug in without changing the identity or the escrow:

- **ERC-8183 (escrowed job), for rental shops and fleet operators.** The owner (or renter) creates a job for
  KeyEscrow Inspector's agent id and funds a fixed price, for example 2 USDT, into the ERC-8183 escrow. The agent
  checks the funded job, runs `inspect_move_out`, and submits the signed report as the deliverable. The job settles
  after the dispute window. The `negotiate` + `notify_funded` skills from a Studio-generated seller wrap our skill
  unchanged. A rejected job (for example, a report that ignores the photos) refunds the payer, which gives the
  agent an on-chain track record that ERC-8004 reputation can build on.
- **x402 (pay per HTTP request), for integrations.** `POST /inspect` returns `402 Payment Required` with a quote. A
  client such as a scooter-fleet management system pays per call over x402 and retries. This suits high-volume
  partners that do not need escrow.
- **Who pays.** By default the fee is folded into the KeyEscrow rental fee ([BUSINESS.md](BUSINESS.md)), so renters
  and owners never pay the agent directly. Pay-per-inspection is for third parties that use the inspector
  outside KeyEscrow rentals.
- **Prerequisites.** The agent must be hosted at its registered public endpoint. Pricing must stay in fixed code,
  never chosen by the model. Mainnet needs a funded payout wallet. None of this is part of the hackathon build: no
  live payments, no Pieverse, no managed trial.

## Tests

```bash
pnpm agent:test                          # vitest: card + registration file, config, the skill, A2A/MCP/REST over HTTP,
                                         # rental-action parity (MCP/A2A/OpenAPI/routes) + an anvil integration run
pnpm agent:demo:tools                    # the rental tools as an MCP client on a throwaway local anvil
pnpm -C web test                         # includes web/tests/inspector.test.ts (signing, hash binding, tamper checks)
cd contracts && forge test --match-contract MockIdentityRegistry
pnpm agent:rehearse                      # the ERC-8004 registration path on local anvil (23 checks)
```

Agent tests run offline. Provider keys are unset, `fetch` can only reach 127.0.0.1, and the HTTP tests start the
agent on a free port in 3170-3199. The rental-action integration test starts its own anvil on a free port in
28660-28689 and signs only with anvil's public dev keys.
