# Server API

These are Next.js route handlers in `web/app/api`. Every integration has an offline fallback, so the app and the
tests run with no keys at all. Responses say when the fallback was used (`mock: true`). Keys are server-side env
vars only (see `.env.example`). None of them use the `NEXT_PUBLIC_` prefix.

| Route | Live backend | Fallback when unconfigured |
| --- | --- | --- |
| `POST /api/settlement` | Vision LLM (Anthropic Claude, `ANTHROPIC_API_KEY`) | Deterministic mock proposal |
| `GET /api/price` | Atlas on-chain feeds, then CoinMarketCap Pro (`CMC_API_KEY`) | Static demo rates |
| `POST /api/evidence`, `GET /api/evidence/<hash>` | BNB Greenfield (`GREENFIELD_*`) | Local disk (`web/.evidence`, gitignored) |
| `GET/POST /api/v1/<action>`, `GET /api/v1/openapi.json` | Chain RPC (read-only, `KEYESCROW_RPC_URL_<chainId>`) | Anvil / PublicNode defaults |

Amounts are integer strings in token base units. MockUSDT has 6 decimals, so `"500000000"` = 500 USDT. This matches
the `uint256` values the contracts take.

## POST /api/settlement

Runs the AI return inspection: it compares the pickup and return photos and proposes a deposit split.

```json
{
  "deposit": "200000000",
  "decimals": 6,
  "currency": "USDT",
  "checkIn":  [{ "hash": "0x9d9e…ab59", "label": "Left side" }],
  "checkOut": [{ "hash": "0x34be…3c72", "label": "Left side" }, { "url": "https://…/front-mirror.jpg" }],
  "notes": "Renter says the mirror was already scratched at pickup."
}
```

- Each photo needs a `hash` (from `POST /api/evidence`) or an `http(s)` `url`. Each set holds 1–20 photos. `decimals`
  defaults to 6 and `currency` to `"USDT"`. Unknown fields are rejected.
- In live mode, a photo given by hash is read from evidence storage and sent inline. A photo given by URL is passed
  to the model as a URL.

Response (200):

```json
{
  "tenantRefund": "184000000",
  "landlordClaim": "16000000",
  "reasons": ["Left side: deep scratches on the side panel not visible at pickup (est. panel respray)."],
  "confidence": 0.65,
  "deposit": "200000000", "decimals": 6, "currency": "USDT",
  "mock": true, "provider": "mock", "repairs": [],
  "checkIn": […], "checkOut": […],
  "createdAt": "2026-11-25T09:51:24.048Z",
  "reportHash": "0xe120a74f…4a68"
}
```

Guarantees:

- `tenantRefund + landlordClaim == deposit` always holds, and both values are ≥ 0.
- Model output is validated with zod and then repaired. The repair step strips code fences, clamps amounts into
  `[0, deposit]`, and parses numeric strings. If the two amounts disagree, `landlordClaim` is kept and `tenantRefund`
  is derived from it. A percentage confidence is scaled to 0..1, and reasons are capped at 10 × 300 characters.
  Every fix is listed in `repairs`. If the model returns no usable amount, the route returns 502.
- `reportHash` is the sha256 of the response's canonical JSON (keys sorted, `reportHash` and `inspectorSignature`
  excluded). Pass it to `RentalEscrow.propose(tenantRefund, reportHash)` so anyone can check the on-chain proposal
  against the report.
- When `INSPECTOR_PRIVATE_KEY` is set, the report also carries `inspector` (`name`, signer `address`, ERC-8004
  `agentId` and `agentRegistry`), which is inside the hash, and `inspectorSignature`, an EIP-191 signature of
  `reportHash`. See [AGENT.md](AGENT.md#erc-8004-identity-and-signed-reports).
- Mock mode is deterministic. A return photo whose hash or URL also appears at pickup counts as unchanged, and
  every other return photo counts as one finding. The claim is 8% of the deposit per finding plus a small seeded
  jitter, capped at 60% and rounded to whole tokens. If nothing changed, the renter gets a full refund.

Provider config: `VISION_LLM_PROVIDER` (`anthropic` by default, or `mock`) and `VISION_LLM_MODEL` (default
`claude-opus-5-5`). The Anthropic provider uses structured JSON output and the server-side refusal fallback. To add
another provider, implement `VisionProvider` in `web/lib/server/settlement/vision.ts`.

Errors: 400 for invalid input (`details` lists the zod issues), 502 when the model fails or its output is unusable.

## GET /api/price

```json
{
  "rates": { "USDT": { "USD": 1, "THB": 33 }, "BNB": { "USD": 650, "THB": 21450 } },
  "source": "mock", "mock": true,
  "updatedAt": "2026-11-25T09:51:04.922Z", "fetchedAt": "2026-11-25T09:51:04.922Z",
  "cached": true
}
```

Sources are tried in this order:

1. **Atlas**: used when `ATLAS_RPC_URL`, `ATLAS_FEED_USDT_USD` and `ATLAS_FEED_BNB_USD` are all set. The feeds are
   read with the AggregatorV3 interface (`decimals()` + `latestRoundData()`). THB comes from `ATLAS_FEED_USD_THB` if
   set, otherwise from CMC, otherwise from the static rate.
2. **CoinMarketCap Pro**: used when `CMC_API_KEY` is set. It makes two `quotes/latest` calls (`convert=USD` and
   `convert=THB`) because the free plan allows one convert currency per call.
3. **Mock**: static rates, marked `mock: true`.

Results are cached in memory for `PRICE_CACHE_TTL_SECONDS` (default 60), and concurrent requests share one upstream
fetch. One CMC refresh costs 2 credits, so continuous use at the default TTL tops out at about 2,900 credits a day;
only requests trigger refreshes. If a live source fails after it has worked once, the route serves the last live
quote with a `warning`.

Client side: `usePrices()` (`web/lib/usePrices.ts`) returns `format(amount, "USDT")` → `"฿16,500 · $500.00"`. The pure
helpers `toFiat` / `formatFiat` / `formatTokenInFiat` are in `web/lib/fiat.ts`. Label the numbers as demo rates when
`isMock` is true.

## POST /api/evidence and GET /api/evidence/&lt;hash&gt;

Upload the rental agreement PDF and photos as `multipart/form-data`, one or more `file` fields (up to 20 per request):

```bash
curl -F file=@lease.pdf -F file=@left-side.png http://localhost:3000/api/evidence
```

```json
{
  "storage": "local", "mock": true, "maxBytes": 10485760,
  "items": [{
    "hash": "0xcfa3181c…6ec6", "size": 69, "contentType": "application/pdf",
    "filename": "lease.pdf", "storage": "local", "url": "/api/evidence/0xcfa3181c…6ec6"
  }]
}
```

- `hash` is the sha256 of the bytes as 0x-prefixed hex, so it fits directly into a `bytes32` (`leaseHash`,
  `addEvidence`, `checkInHash`, …). Storage is content-addressed, so uploading the same file twice is a no-op.
- Accepted types are PDF, JPEG, PNG and WebP. The type is detected from the file's magic bytes; the declared MIME type
  is ignored. Files over `EVIDENCE_MAX_BYTES` (default 10 MiB) get a 413, and other types get a 415.
- Storage goes to BNB Greenfield (official `@bnb-chain/greenfield-js-sdk`, private objects named `evidence/<sha256>`)
  when `GREENFIELD_RPC_URL`, `GREENFIELD_CHAIN_ID`, `GREENFIELD_BUCKET` and `GREENFIELD_PRIVATE_KEY` are all set.
  Otherwise files go to `EVIDENCE_DIR` (default `web/.evidence`). Both backends implement `EvidenceStore`.
- `GET /api/evidence/<hash>` returns the bytes with the sniffed content type, `nosniff`, a sandbox CSP and an immutable
  cache header. It returns 400 for a malformed hash and 404 for an unknown one.

## GET /api/risk

`?depositThb=3000&days=30`. Deposit risk buffer per payment token (USDT, BNB) from live CoinMarketCap quotes
(`quotes/latest`, USD for volatility, THB for conversion; cached `RISK_CACHE_TTL_SECONDS`, default 120 s) and the latest
stored Cournot probability. Returns `cmc` (`{configured: false, reason}` without `CMC_API_KEY`, never fake numbers),
`options.USDT` / `options.BNB` (`buffer`, `cmcBuffer`, `cournotBuffer`, `tier`, `depositThb`, `depositTokens`,
`explanation[]`), and `cournot` (`claim` for this rental, latest stored `result`, `live`). 400 on a bad amount or length.

## GET / POST /api/cournot

`GET` lists stored Cournot answers and the call log; it never calls Cournot. `POST {claim, confirm: true}` returns the
stored answer for that exact claim, or, only with `COURNOT_LIVE=1` and under `COURNOT_MAX_LIVE_CALLS`, calls
`/intelligence/v1/resolve` + `/intelligence/v1/probability` and stores the answer. 409 when live calls are off, 402
when Cournot asks for payment (never paid), 422 when no market matches. The claim must name BNB, a `$` threshold and
a `YYYY-MM-DD` date.

## GET /api/integrations

State of each sponsor integration (`live`, `not-configured`, `blocked`, `off`), the env var names it needs, and its
last calls (endpoint, time, status, duration, note). Never returns key values.

`POST /api/settlement` also takes an optional `scooterId`: the inspector then reads that scooter's earlier inspections
(Living Brain, or the local stand-in) before judging and returns them under `memory`. That is read-only. To also store
the inspection, send `lease` (the RentalEscrow address, optional `chainId`): the server checks on-chain that this
deployment's factory created it (`isLease`), then reads and writes memory under that rental's scooter (the catalogue
scooter linked to it whose owner is the on-chain landlord, else the rental address), ignoring `scooterId`. What is
stored: date, rental, findings, new damage yes/no and the report hash. `memoryStored` says whether it was written.
Writes are limited to 20 an hour per caller IP (over it the inspection still runs, read-only). The agent's
`inspect_move_out` (A2A, MCP, REST) takes no `lease` and never writes memory.

## GET /api/chain/index

`?chainId=97` (or 31337), optional `&minBlock=<n>`. Every factory (`LeaseCreated`, `PayeeSet`), rental escrow and
Fleet Vault event of the deployment, plus the stablecoin transfers from escrows into the vault, oldest first. This is
what the back office, Fleet owner, Renter, Shareholders and rental pages read instead of calling `eth_getLogs` from the
browser (`web/lib/server/chainIndex`).

- The server scans from the deployment's `fromBlock` in windows of `CHAIN_INDEX_BLOCK_RANGE` blocks (default 5,000;
  a window the node still refuses is split in half), at most `CHAIN_INDEX_CONCURRENCY` (2) queries at a time, each retried
  with exponential backoff on 429 / 403 / 5xx / timeouts. Later refreshes scan only the new blocks (plus a 12-block reorg
  tail). Local anvil (31337) is rescanned in full each time, so `evm_revert` cannot leave stale events behind.
- Cached in the shared state (memory under Node, the `KEYESCROW_STATE` Durable Object on Workers) and served without
  any RPC call for `CHAIN_INDEX_TTL_MS` (default 4,000 on 97, 0 on anvil). `minBlock` (the block of a transaction the
  caller just sent) forces a refresh until the index reaches it.
- Bigints are encoded as `{"$n": "123"}` (`web/lib/chainIndex.ts` has the codec). Fields: `chainId`, `factory`,
  `vault`, `fromBlock`, `scannedTo`, `latestBlock`, `chainNow` (timestamp of `latestBlock`), `escrows`, `events`
  (`address`, `name`, `args`, `txHash`, `blockNumber`, `logIndex`, `timestamp`), `failed` (reverted escrow
  transactions, anvil only), `scannedFailures`, `updatedAt`.
- RPC failure: with an earlier snapshot the answer is still 200, with `stale: {error, since}` (the UI shows a "last good
  read" warning with a Retry button); without one it is 503 with `Retry-After: 5`. 400 for an unsupported `chainId` or a
  malformed `minBlock`, 404 when KeyEscrow is not deployed on that chain.

## /api/v1: rental actions (unsigned transactions)

One endpoint per rental action, generated from `web/lib/actions/definitions.ts` (the same definitions the agent serves
as MCP tools, see [AGENT.md](AGENT.md#rental-actions-as-agent-tools)). Reads are `GET` with query parameters;
`prepare_*` are `POST` with a JSON body and return **unsigned** transactions, simulated on the chain first. The
server never holds a key and never sends a transaction. The full list, with field tables and a curl example per
action, is on `/developers`; the machine-readable spec is `GET /api/v1/openapi.json` (OpenAPI 3.1).

```bash
curl -s "$BASE/api/v1/explain_status?lease=0x9f1ac54BEF0DD2f6f3462EA0fa94fC62300d3a8e&viewer=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
curl -s -X POST "$BASE/api/v1/prepare_create_lease" -H 'content-type: application/json' \
  -d '{"from":"0x70997970C51812dc3A010C7d01b50e0d17dc79C8","renter":"0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC","rent":"3500","currency":"THB","depositMonths":2,"termPeriods":6}'
```

A `prepare_*` answer:

```json
{
  "chainId": 31337,
  "from": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "steps": [{ "to": "0xe7f1…0512", "data": "0x6fecdb8a…", "value": "0", "description": "Create the rental offer", "function": "createLease((address,address,uint256,uint256,uint32,uint32,uint32,bytes32))" }],
  "summary": "Create a 6-month rental for renter 0x3C44…: rent 106.06 mUSDT a month (THB 3500 at 33.00 THB/USDT, demo rate), …",
  "simulation": { "method": "eth_simulateV1", "ok": true },
  "expected": { "lease": "0xA22D…70c3" },
  "unsigned": true
}
```

Errors are `{error, code, details?}` with a sentence in `error` that can be shown as is:

| Status | `code` | When |
| --- | --- | --- |
| 400 | `invalid_input`, `unsupported_chain` | Schema validation (`details` lists the fields), or a chain other than 31337 / 97 |
| 404 | `unknown_action`, `not_found` | No such action, or the address is not a KeyEscrow rental |
| 405 | `method_not_allowed` | `GET` on a `prepare_*` or `POST` on a read |
| 409 | `precondition_failed` | Wrong role for `from`, or the rental is in the wrong status |
| 422 | `simulation_reverted` | A step would revert; `details` has the step, function and decoded custom error |
| 502 | `rpc_unavailable` | The chain node (or price source) could not be reached |

## Tests

```bash
pnpm -C web test   # vitest, fully offline
```

`web/tests/setup.ts` unsets every provider key and replaces `fetch` with a stub that throws, so a test can never reach
a real API. The live settlement path is tested with a fake `VisionProvider`, and the CoinMarketCap path with a fake
`fetch`.
