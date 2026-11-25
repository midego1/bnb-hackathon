# KeyEscrow on Cloudflare Workers

Two Workers give the hackathon judges a public URL. Both are prepared and tested locally (wrangler dev / workerd).
**Nothing has been deployed yet:** deploying needs a Cloudflare account and an API token (one-time steps below).

| Worker | What it serves | Source | Public URL after deploy |
| --- | --- | --- | --- |
| `keyescrow-web` | The Next.js app (all pages, `/api/*`) on BSC testnet (97), via the OpenNext adapter | `web/` (`web/wrangler.jsonc`, `web/open-next.config.ts`, `web/cloudflare/`) | `https://keyescrow-web.<subdomain>.workers.dev` |
| `keyescrow-agent` | KeyEscrow Inspector, ERC-8004 agent #2921: agent card, A2A, MCP, REST | `agent/` (`agent/wrangler.jsonc`, `agent/src/worker.ts`) | `https://keyescrow-agent.<subdomain>.workers.dev` |

`<subdomain>` is the account's workers.dev subdomain, picked when the account is created. Only workers.dev routes are
used: no custom domain, no zone. Both Workers fit the **Workers Free plan** (see [Size](#size)); nothing here needs
a paid plan.

**Status:** on this branch, tested in local preview only. Not deployed.

## Commands

| Command | What it does | Talks to Cloudflare? |
| --- | --- | --- |
| `pnpm cf:build` | Chain 97 production build into `web/.open-next/` (runs `next build` through `web/scripts/cf.mjs`) | no |
| `pnpm cf:preview` | Serves that build locally at `http://127.0.0.1:8787` (`CF_PREVIEW_PORT`) in workerd | no |
| `pnpm cf:agent:preview` | Serves the agent Worker locally at `http://127.0.0.1:8788` (`CF_AGENT_PREVIEW_PORT`) | no |
| `pnpm cf:size` | Gzip size of the bundles the two previews built, against the Free (3 MiB) and Paid (10 MiB) limits | no |
| `pnpm cf:deploy` | Deploys `keyescrow-web` (needs a prior `pnpm cf:build`) | **yes, with a token** |
| `pnpm cf:agent:deploy` | Deploys `keyescrow-agent` | **yes, with a token** |

Both deploy commands print what they would deploy (worker, build commit, bindings, secrets, size) and **refuse with
exit 1** unless `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set, in the shell or in the repo-root `.env`
(only those two keys are read from it). Preview and build strip any Cloudflare credentials from their environment, and
wrangler's usage metrics are off (`send_metrics: false`, `WRANGLER_SEND_METRICS=false`).

Versions are pinned: `@opennextjs/cloudflare` 1.20.16 (supports Next `>=16.4.5`; the app runs 16.4.6) and
`wrangler` 4.159.0, in `web/` and `agent/`.

## The public build: chain 97 only

Anvil is not reachable from Cloudflare, so `pnpm cf:build` only builds for BSC testnet:

- Addresses come from `contracts/deployments/97.json`; `NEXT_PUBLIC_CHAIN_ID=97`. Every `NEXT_PUBLIC_*` variable is set
  explicitly, so a developer's `web/.env.local` cannot leak anvil addresses or dev accounts into the bundle.
- **`NEXT_PUBLIC_DEV_ACCOUNTS=1` fails the build**, checked three times: by `scripts/cf.mjs` before building, by
  `next.config.ts` (with `KEYESCROW_BUILD_TARGET=cloudflare`), and after the build by scanning the client bundle for the
  anvil dev-account connector. `NEXT_PUBLIC_CHAIN_ID` other than 97 fails it too.
- The local anvil `/demo` is not in this build. `/demo` is the **live testnet demo** (`NEXT_PUBLIC_DEMO_TESTNET=1`,
  `CF_DEMO_TESTNET=0 pnpm cf:build` hides it). Until its secrets are set it shows "The live testnet demo is switched off on this server".
- OpenNext copies `web/.env*` files into the Worker. `cf:build` empties that module
  (`.open-next/cloudflare/next-env.mjs`) and prints the names it dropped: the deployed Worker reads only its wrangler
  vars and secrets.
- Two Next settings differ from the Node build: `cacheComponents` / `partialPrefetching` are off (with them every page
  render hangs under workerd; nothing uses `"use cache"`), and the BNB Greenfield SDK is replaced by a stub (it adds
  ~5 MiB and evidence goes to R2 on Workers).

Wallet RPC: the browser talks to BSC testnet through `NEXT_PUBLIC_BSC_TESTNET_RPC_URL`, default
`https://bsc-testnet-rpc.publicnode.com` (answers `eth_getLogs` for the lease lists and timelines).

## Server routes on Workers

| Route | On Workers |
| --- | --- |
| `GET /api/price` | Same sources (Atlas, CoinMarketCap with `CMC_API_KEY`, else mock). The quote is cached in memory per isolate and, across isolates, in the KeyEscrowState Durable Object for `PRICE_CACHE_TTL_SECONDS` (300 in `wrangler.jsonc`). Mock answers are never shared. |
| `POST /api/settlement` | Same code. Mock without `ANTHROPIC_API_KEY`; signed as agent #2921 with `INSPECTOR_PRIVATE_KEY`. |
| `POST /api/evidence`, `GET /api/evidence/<hash>` | No disk on Workers. With the `EVIDENCE` R2 bucket bound: stored there as `evidence/<sha256>` (private). Without it: uploads answer **503 "evidence uploads are disabled on this deployment"**, the browser hashes the files itself (the hashes still go on-chain), and lookups 404. The demo's own lease PDF and photos are static files under `/demo/`, so the demo does not need the bucket. |
| `/api/demo-testnet/*` | The live testnet demo runner. Keys from secrets (`DEMO_TESTNET_KEYS`, ...), lock and rate limit in the Durable Object (`SharedRunStore`). 404 until `DEMO_TESTNET_KEYS` is set. |

Local development is unchanged: `next dev` / `next start` / `pnpm testnet:web` still use the local disk (or
Greenfield), the in-memory price cache and the in-memory run store.

### Shared state (the Durable Object)

Process memory is per isolate on Workers, so anything that must hold across requests goes through
`web/lib/server/state`: a `SharedState` interface (versioned compare-and-set) with two backends,

- `MemoryState` under Node (one process), and
- `DurableObjectState`, a client for the **`KeyEscrowState`** Durable Object (`web/cloudflare/state.ts`, binding
  `KEYESCROW_STATE`, one SQLite-backed instance). SQLite-backed Durable Objects are included in the Workers Free plan.

On top of it, `lib/server/state/index.ts` provides `update` (atomic read-modify-write), locks (`acquireLock`,
`renewLock`, `releaseLock`, `readLock`: one holder, heartbeat, idle expiry, takeover by the same owner), rate limits
(`hitRateLimit`, `peekRateLimit`: sliding window plus minimum gap) and small caches (`cacheGet`, `cachePut`).
`getSharedState()` picks the backend per request. The live testnet demo plugs in through
`lib/server/demoTestnet/store.ts` `SharedRunStore`, which runs the same `RunLock` / `RateLimiter` rules as
`MemoryRunStore` on one persisted record; `lib/server/demoTestnet/http.ts` passes it to `getDemoTestnetRunner` on
Workers. Tested in local preview: the lock, the 60 s gap and the hourly cap survive a Worker restart.

Known limit, to watch on the first live run: the runner serialises its own sends per isolate only (its in-memory
queue). One browser drives one run step by step, so two sends for the same wallet should not overlap; if requests of
one run ever land in two isolates at the same moment, their transactions could pick the same nonce. Not testable
locally without broadcasting, so it was not exercised here.

## Secrets and bindings (names only)

Set secrets with `wrangler secret put <NAME>` (web: run in `web/`; agent: `-c agent/wrangler.jsonc`). All are optional:
without them the app runs in mock / read-only mode. **Never** put them in `wrangler.jsonc`, `NEXT_PUBLIC_*` or git.

**keyescrow-web**

| Name | Kind | Purpose |
| --- | --- | --- |
| `ASSETS` | binding (static assets) | Pages and `/_next/static`, from `.open-next/assets` |
| `KEYESCROW_STATE` | binding (Durable Object `KeyEscrowState`, migration `v1`, SQLite) | Locks, rate limits, caches, the live demo run |
| `EVIDENCE` | binding (R2 bucket `keyescrow-evidence`), **optional, commented out** | Evidence uploads. R2 needs R2 enabled on the account (a payment method on file, even within the free 10 GB) |
| `NEXT_PUBLIC_CHAIN_ID`, `KEYESCROW_PLATFORM`, `VISION_LLM_PROVIDER`, `PRICE_CACHE_TTL_SECONDS`, `DEMO_TESTNET_RUNNER` | vars (in `wrangler.jsonc`) | `97`, `cloudflare`, `anthropic`, `300`, `1` |
| `ANTHROPIC_API_KEY` | secret | Live AI inspection (mock without it) |
| `INSPECTOR_PRIVATE_KEY` | secret | Signs settlement reports as agent #2921 (must be the registered `reportSigner`) |
| `CMC_API_KEY` | secret | CoinMarketCap prices (`ATLAS_RPC_URL`, `ATLAS_FEED_USDT_USD`, `ATLAS_FEED_BNB_USD`, `ATLAS_FEED_USD_THB` too, if used) |
| `DEMO_TESTNET_KEYS` | secret | JSON `{"landlord":"0x…","tenant":"0x…","arbiter":"0x…"}`: the three demo wallets' private keys |
| `DEMO_TESTNET_RPC_URL` | secret | BSC testnet RPC the runner signs against (a secret because a provider URL may embed an API key) |
| `DEMO_TESTNET_FUNDER_KEY` | secret | A **small dedicated** wallet that tops up demo wallets (never the deployer). Without it a low wallet refuses the run |

The demo limits (`DEMO_TESTNET_MIN_GAP_S`, `DEMO_TESTNET_RUNS_PER_HOUR`, `DEMO_TESTNET_MAX_GAS_PER_RUN`,
`DEMO_TESTNET_TX_TIMEOUT_S`, `DEMO_TESTNET_TOP_UP_TBNB`, `TESTNET_GAS_PRICE_GWEI`) are plain vars; defaults as in
[DEPLOY.md](DEPLOY.md).

**keyescrow-agent**

| Name | Kind | Purpose |
| --- | --- | --- |
| `INSPECTOR_CHAIN_ID`, `VISION_LLM_PROVIDER` | vars | `97` (reads the committed `agent/deployments/97.json`), `anthropic` |
| `AGENT_PUBLIC_URL` | var, optional | Base URL in the agent card / registration file; defaults to the URL the request came in on |
| `INSPECTOR_PRIVATE_KEY` | secret | Report signer; must match `reportSigner` of agent #2921 or the Worker answers 500 "agent misconfigured" |
| `ANTHROPIC_API_KEY` | secret | Live vision model (mock without it) |
| `EVIDENCE` | binding (R2), optional, commented out | Same bucket as the web app, to read photos by hash |

For local preview, put secrets in `web/.dev.vars` / `agent/.dev.vars` (gitignored; `web/.dev.vars.example` lists the
names).

## Size

Measured on the bundles wrangler built for the local previews (gzip level 9 of the uploaded modules):

| Worker | Raw | Gzip | Plan |
| --- | --- | --- | --- |
| `keyescrow-web` | 12.1 MiB | **2.41 MiB** | fits Free (3 MiB) |
| `keyescrow-agent` | 3.6 MiB | **0.62 MiB** | fits Free |

Before stubbing the Greenfield SDK the web Worker was 3.72 MiB gzip (Paid only). Cloudflare's own number at deploy
time (`Total Upload ... gzip`) may differ slightly; the margin to 3 MiB is about 0.6 MiB.

## One-time setup (Michiel)

1. **Account.** Sign up at <https://dash.cloudflare.com/sign-up> (Free plan is enough). Under *Workers & Pages* pick
   the workers.dev subdomain (it becomes part of both URLs).
2. **API token.** *My Profile → API Tokens → Create Token →* template **"Edit Cloudflare Workers"**. Scope it to the
   one account. If R2 evidence storage is wanted later, add *Account → Workers R2 Storage → Edit*.
3. **Account id.** On the Workers & Pages overview page (right column, "Account ID").
4. **Put both in the repo-root `.env`** (`/home/orcasrv/projects/bnb-hackathon/.env`, gitignored, never committed):

   ```bash
   CLOUDFLARE_API_TOKEN=...
   CLOUDFLARE_ACCOUNT_ID=...
   ```

5. Optional, for uploads: enable R2 (needs a payment method on file), `pnpm -C web exec wrangler r2 bucket create
   keyescrow-evidence`, then uncomment the `r2_buckets` line in `web/wrangler.jsonc` (and `agent/wrangler.jsonc`).

## Deploy

```bash
pnpm cf:build                                   # chain 97 build, ~2.5 min
pnpm cf:preview                                 # optional: check http://127.0.0.1:8787 first
pnpm cf:deploy                                  # keyescrow-web (first deploy also creates the Durable Object)
pnpm cf:agent:deploy                            # keyescrow-agent
# secrets, any time after the first deploy (each prompts for the value):
cd web && pnpm exec wrangler secret put ANTHROPIC_API_KEY
pnpm -C agent exec wrangler secret put INSPECTOR_PRIVATE_KEY
```

Secrets need the same `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` in the shell (`set -a; . ./.env; set +a`).

After the agent is live, its ERC-8004 registration still lists the GitHub URL as endpoint. Pointing agent #2921 at
`https://keyescrow-agent.<subdomain>.workers.dev` is an on-chain `setAgentURI` transaction (see [AGENT.md](AGENT.md),
`AGENT_PUBLIC_URL`); it is a separate, deliberate step and not part of `cf:agent:deploy`.

## Tested locally (this branch)

- `pnpm cf:preview`: home, landlord, tenant, dispute desk, `/demo` (live testnet gate) and a real chain 97 lease
  (`/lease/0x115bb93282F8928D64d7d29e3278D0B19dCAd57a`, settled, full timeline from PublicNode) render with no page
  errors. `/api/price` (mock), `/api/settlement` (mock), `/api/evidence` (503 disabled / 404) answer as above.
- Live demo runner with throwaway, unfunded keys in `web/.dev.vars`: status reads chain 97, a start is refused with
  "out of test BNB" (no funder, so nothing can be sent), the lock is freed, and the next start gets 429 from the rate
  limit, also after restarting the Worker (state lives in the Durable Object).
- `pnpm cf:agent:preview`: `/health`, `/.well-known/agent-card.json`, `/.well-known/agent-registration.json`,
  `POST /inspect`, A2A `message/send` and MCP `initialize` / `tools/list` all answer in mock mode.
- Unit tests: `web/tests/cloudflare.test.ts` (shared state on both backends, locks, rate limits, R2 / disabled
  evidence, shared price cache, `SharedRunStore` against `MemoryRunStore`), `agent/test/worker.test.ts`.
