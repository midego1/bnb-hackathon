# Server API

These are Next.js route handlers in `web/app/api`. Every integration has an offline fallback, so the app and the
tests run with no keys at all. Responses say when the fallback was used (`mock: true`). Keys are server-side env
vars only (see `.env.example`). None of them use the `NEXT_PUBLIC_` prefix.

| Route | Live backend | Fallback when unconfigured |
| --- | --- | --- |
| `POST /api/settlement` | Vision LLM (Anthropic Claude, `ANTHROPIC_API_KEY`) | Deterministic mock proposal |
| `GET /api/price` | Atlas on-chain feeds, then CoinMarketCap Pro (`CMC_API_KEY`) | Static demo rates |
| `POST /api/evidence`, `GET /api/evidence/<hash>` | BNB Greenfield (`GREENFIELD_*`) | Local disk (`web/.evidence`, gitignored) |

Amounts are integer strings in token base units. MockUSDT has 6 decimals, so `"500000000"` = 500 USDT. This matches
the `uint256` values the contracts take.

## POST /api/settlement

Runs the AI move-out inspection: it compares the check-in and check-out photos and proposes a deposit split.

```json
{
  "deposit": "500000000",
  "decimals": 6,
  "currency": "USDT",
  "checkIn":  [{ "hash": "0x9d9e…ab59", "label": "Living room" }],
  "checkOut": [{ "hash": "0x34be…3c72", "label": "Living room" }, { "url": "https://…/oven.jpg" }],
  "notes": "Tenant says the hinge was already loose."
}
```

- Each photo needs a `hash` (from `POST /api/evidence`) or an `http(s)` `url`. Each set holds 1–20 photos. `decimals`
  defaults to 6 and `currency` to `"USDT"`. Unknown fields are rejected.
- In live mode, a photo given by hash is read from evidence storage and sent inline. A photo given by URL is passed
  to the model as a URL.

Response (200):

```json
{
  "tenantRefund": "460000000",
  "landlordClaim": "40000000",
  "reasons": ["Living room: cabinet door hinge loose; door does not close fully (est. repair)."],
  "confidence": 0.65,
  "deposit": "500000000", "decimals": 6, "currency": "USDT",
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
- `reportHash` is the sha256 of the response's canonical JSON (keys sorted, `reportHash` itself excluded). Pass it to
  `RentalEscrow.propose(tenantRefund, reportHash)` so anyone can check the on-chain proposal against the report.
- Mock mode is deterministic. A check-out photo whose hash or URL also appears at check-in counts as unchanged, and
  every other check-out photo counts as one finding. The claim is 8% of the deposit per finding plus a small seeded
  jitter, capped at 60% and rounded to whole tokens. If nothing changed, the tenant gets a full refund.

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

Upload the lease PDF and photos as `multipart/form-data`, one or more `file` fields (up to 20 per request):

```bash
curl -F file=@lease.pdf -F file=@kitchen.png http://localhost:3000/api/evidence
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

## Tests

```bash
pnpm -C web test   # vitest, fully offline
```

`web/tests/setup.ts` unsets every provider key and replaces `fetch` with a stub that throws, so a test can never reach
a real API. The live settlement path is tested with a fake `VisionProvider`, and the CoinMarketCap path with a fake
`fetch`.
