# Deploying KeyEscrow to BSC testnet (chainId 97)

This deploys **MockUSDT + EscrowFactory** (the factory deploys the `RentalEscrow` implementation) to BSC testnet,
writes `contracts/deployments/97.json` (same shape as the local `31337.json`), verifies the contracts on BscScan
testnet and points the web app at chain 97. MockUSDT is the only token. KeyEscrow has no token of its own.

Everything goes through `contracts/script/testnet.sh`:

| Command | What it does | Sends a transaction? |
| --- | --- | --- |
| `pnpm deploy:testnet:check` | preflight: env, RPC chainId, simulated deploy, gas estimate in tBNB, deployer balance | **never** |
| `pnpm deploy:testnet` | the one broadcast: preflight again, typed confirmation, deploy, post-deploy checks, verify | **yes (only after OK)** |
| `pnpm deploy:testnet:verify` | (re)verify the three contracts from `deployments/97.json` | no (calls the BscScan API) |
| `pnpm deploy:testnet:rehearse` | the whole path against throwaway **local** anvil nodes with `--chain-id 97` / `56` | local only |

Safety rails, all enforced in `contracts/script/Deploy.s.sol` / `utils/ScriptBase.sol` and not only in the wrapper:

- Any chain other than local anvil (31337) needs `ALLOW_NON_LOCAL_BROADCAST=true`. Only 97 (BSC testnet) and 5611
  (opBNB testnet) are accepted with it. 1, 56 and 204 (mainnets) and every other chain id are always refused.
- Off anvil there are no default addresses: `FACTORY_OWNER`, `FEE_RECIPIENT` and `DEFAULT_ARBITER` must be set.
  None of them, and not the deployer either, may be one of anvil's public default accounts.
- `DEPLOYER_ADDRESS` must match the wallet that signs, so a wrong keystore is caught before anything is sent.
- A simulation (no `--broadcast`) writes `deployments/97.dry-run.json` (gitignored), never `97.json`.
- `pnpm deploy:testnet` refuses to overwrite an existing `deployments/97.json` unless `FORCE_REDEPLOY=true`.

Requirements: Foundry (`forge`, `cast`), Node 22, pnpm, `jq`.

## 1. Get test BNB from the faucet

1. Create or pick a fresh wallet that is used for nothing else (step 2 creates one if you like).
2. Request tBNB at the official faucet: <https://www.bnbchain.org/en/testnet-faucet>. One drip is plenty. The
   preflight prints the exact estimate, which is usually well under 0.01 tBNB.
3. Check that it arrived: `cast balance <address> --ether --rpc-url "$BSC_TESTNET_RPC_URL"`.

## 2. Put the deployer key in a Foundry keystore

Keep the key encrypted on disk instead of in `.env`:

```bash
cast wallet import keyescrow-deployer --interactive   # paste the private key, then choose a password
# or create a brand-new one: cast wallet new ~/.foundry/keystores keyescrow-deployer
cast wallet address --account keyescrow-deployer       # prints the address (asks for the password)
```

The keystore lives in `~/.foundry/keystores/keyescrow-deployer`, outside the repo. Forge asks for the password at
broadcast time. `DEPLOYER_PASSWORD_FILE` can point to a password file outside the repo, but the prompt is safer.
`PRIVATE_KEY` still works as a fallback, but set only one wallet option.

## 3. Set the environment

Copy `.env.example` to `.env` in the repo root (gitignored) and fill in:

```bash
BSC_TESTNET_RPC_URL=https://data-seed-prebsc-1-s1.bnbchain.org:8545   # or your own provider's testnet URL
DEPLOYER_ACCOUNT=keyescrow-deployer
DEPLOYER_ADDRESS=0x...            # output of `cast wallet address --account keyescrow-deployer`
FACTORY_OWNER=0x...               # owns the factory (fee rate, treasury, dispute desk); a wallet you control
FEE_RECIPIENT=0x...               # KeyEscrow treasury
DEFAULT_ARBITER=0x...             # KeyEscrow dispute desk (the default arbiter for rentals)
# FEE_BPS=1000                    # optional: 10% of ONE month's rent, once per rental (max 1000)
# FLEET_OPERATOR=0x...            # optional: Fleet Vault operator (maintenance fee); default FEE_RECIPIENT
# FLEET_OPERATOR_FEE_BPS=1000     # optional: operator fee in bps of vault income (max 3000)
BSCSCAN_API_KEY=...               # for verification, see step 7
```

Leave `ALLOW_NON_LOCAL_BROADCAST` unset in `.env`. Set it only on the one broadcast command (step 6).

Values in your shell take precedence over `.env`. The script only reads names that are not already set.

## 4. Rehearse locally (optional, no network)

```bash
pnpm deploy:testnet:rehearse
```

This starts its own anvil nodes on 127.0.0.1 (ports 28550-28559) with `--chain-id 97` and `--chain-id 56`. It runs every
command below against them with a fresh temp keystore, checks the refusals (no flag, chain 56, anvil accounts, missing
roles, wrong `DEPLOYER_ADDRESS`, no confirmation, overwrite), deploys, checks the result, dry-runs verification, kills
the nodes and removes its temp files. It ignores `.env`, so it can never reach a real network.

## 5. Preflight (sends nothing)

```bash
pnpm deploy:testnet:check
```

It checks that every required name is set, that the RPC answers chainId 97, and that the keystore exists. It then
runs `forge script script/Deploy.s.sol` **without `--broadcast`** against a fork of the RPC state and prints the gas
estimate in tBNB. Finally it checks that the deployer balance covers the estimate. Exit codes: 0 passed, 1 a check
failed, 2 RPC not configured or not reachable, 3 the RPC is not chain 97.

Example (from the local rehearsal; real testnet gas prices are lower):

```
  ✓ RPC reachable, chainId 97
  ✓ deployer wallet: keystore account 'keyescrow-deployer'
  ...
  ✓ simulation OK: MockUSDT + EscrowFactory (+ RentalEscrow implementation)
  ✓ estimate: 0.00935608000467804 tBNB (4678040 gas at 2.000000001 gwei; includes forge's 130% gas margin)
  ✓ deployer balance 0.500000000000000000 tBNB >= estimate
Preflight passed. Nothing was sent. The broadcast is: pnpm deploy:testnet (only after OK).
```

## 6. Broadcast: ⚠️ ONLY AFTER OK ⚠️

> **Run this only after the preflight passes and the team has given the OK.** It is the only command that spends
> tBNB, and it creates the public testnet deployment that the demo uses.

```bash
ALLOW_NON_LOCAL_BROADCAST=true pnpm deploy:testnet
```

It reruns the preflight and asks you to type `deploy 97`. Then it runs
`forge script script/Deploy.s.sol --broadcast --slow --account keyescrow-deployer --sender $DEPLOYER_ADDRESS`, which
prompts for the keystore password. After that it checks on-chain that all three contracts have code and that the
factory's owner, fee recipient, dispute desk and token match `deployments/97.json`. It prints the `web/.env.local`
lines and verifies the contracts if `BSCSCAN_API_KEY` is set.

Commit the result:

```bash
git add contracts/deployments/97.json contracts/broadcast/Deploy.s.sol/97/run-latest.json
```

`broadcast/.../97/run-latest.json` holds the transaction hashes; it contains no secrets. Forge writes the
sensitive-values file to `contracts/cache/`, which is gitignored.

## 7. Verify on BscScan testnet

Verification runs automatically at the end of step 6 when `BSCSCAN_API_KEY` is set. To run it again (it is safe to
repeat):

```bash
pnpm deploy:testnet:verify
VERIFY_DRY_RUN=1 pnpm deploy:testnet:verify   # print the commands and build the inputs, submit nothing
```

It verifies `MockUSDT`, `EscrowFactory` (with ABI-encoded constructor arguments rebuilt from `97.json`) and the
`RentalEscrow` implementation using `forge verify-contract --chain 97 --verifier etherscan --watch`. The key is passed as
`ETHERSCAN_API_KEY` in the environment, never on the command line.

- BscScan API keys now go through **Etherscan API V2**: one etherscan.io key serves all chains via `chainid`, and forge
  uses V2 by default. If your key needs a different endpoint, set `VERIFIER_URL`.
- No key? Sourcify needs none:
  `forge verify-contract <address> src/EscrowFactory.sol:EscrowFactory --chain 97 --verifier sourcify --constructor-args <hex>`
  (`VERIFY_DRY_RUN=1` prints the hex).
- Rental escrows are EIP-1167 clones of the verified `RentalEscrow` implementation, so their code is the verified code.

Check the result at `https://testnet.bscscan.com/address/<escrowFactory>#code`.

## 8. Point the web app at chain 97

`contracts/deployments/97.json` has the same keys as `31337.json` (`chainId`, `token`, `escrowFactory`,
`rentalEscrowImplementation`, roles, `feeBps`, `startBlock`, `tokenSymbol`, `tokenDecimals`). In `web/.env.local`:

```bash
NEXT_PUBLIC_CHAIN_ID=97
NEXT_PUBLIC_ESCROW_FACTORY_ADDRESS=0x...   # printed by step 6 (= escrowFactory in 97.json)
NEXT_PUBLIC_MOCK_USDT_ADDRESS=0x...        # printed by step 6 (= token in 97.json)
# NEXT_PUBLIC_BSC_TESTNET_RPC_URL=...      # optional; default https://bsc-testnet-rpc.publicnode.com
```

Lease lists and timelines are built from events, which the server reads (`GET /api/chain/index`, through
`KEYESCROW_RPC_URL_97`); the browser RPC only serves `eth_call`s and the wallet. Both default to PublicNode, because
viem's default BSC testnet RPC (`data-seed-prebsc-1-s1.bnbchain.org`) answers every `eth_getLogs` with `limit exceeded`. Leave `NEXT_PUBLIC_DEV_ACCOUNTS` unset: testers connect their own wallet.

Then `pnpm -C web build` and deploy or run the web app as usual. `pnpm testnet:web` does both: a production build
into `web/.next-testnet` and a systemd user unit `keyescrow-web-testnet` running `next start` (env
`TESTNET_WEB_HOST`, default `127.0.0.1`, and `TESTNET_WEB_PORT`, default `3001`). Testers get MockUSDT from its capped
faucet (`MockUSDT.faucet(to, amount)`, see `contracts/src/mocks/MockUSDT.sol`) and need a little tBNB for gas.

`Seed.s.sol` is anvil-only and refuses chain 97. On testnet, use `pnpm testnet:seed` (below) or create rentals in the app.

## 9. Live checks on BSC testnet

`web/scripts/testnet.mts` drives the deployed contracts from `deployments/97.json` with real transactions. It only
talks to an RPC that answers chainId 97, signs for chain 97 only, and decrypts the deployer keystore
(`DEPLOYER_KEYSTORE` + `DEPLOYER_PASSWORD_FILE`) in memory. In a git worktree it reads the main checkout's `.env`.

| Command | What it does | Cost |
| --- | --- | --- |
| `pnpm testnet:status` | tBNB and mUSDT balances of the deployer and the test wallets | nothing sent |
| `pnpm e2e:testnet` | happy path (create, fund + prepay, rent release with the 10% one-time fee, return evidence, renter proposal, owner accepts) and dispute path (owner claims all, renter disputes, dispute desk rules); asserts every balance change and that token totals are conserved | ~0.002 tBNB |
| `pnpm testnet:seed` | leaves an unfunded offer, an active rental and a disputed rental (60-day arbiter window) for the web app | ~0.002 tBNB |
| `pnpm testnet:fund <address>` | sends 0.01 tBNB and 10,000 mUSDT from the deployer to a tester's wallet | 0.01 tBNB |

The owner and renter are throwaway wallets created on first use in `.orca/secrets/testnet-e2e-wallets.json`
(gitignored, mode 600) and topped up by the deployer to 0.004 tBNB each. The dispute desk is the deployer. Every
transaction uses an explicit 1 gwei legacy gas price (`TESTNET_GAS_PRICE_GWEI`) and waits for its receipt. Reads are
pinned to the latest receipt's block so a lagging RPC backend cannot serve stale balances. Each run writes a report
with a BscScan link per transaction to `.orca/reports/testnet-<e2e|seed>.md` (outside git).

The owner-response (7 days) and arbiter (14 days) timeouts need real time to pass, so they are not run on
testnet. `pnpm e2e:chain` covers both against anvil with time travel.

## 10. Live one-click demo on BSC testnet

On the `pnpm testnet:web` build, `/demo` ("Play the demo") plays the happy and dispute stories as real chain 97
transactions; every step on the timeline links to `testnet.bscscan.com`. The browser holds no key: it encodes each
step's call and posts it to `/api/demo-testnet/tx`, and the server signs it with its own demo wallets
(`web/lib/server/demoTestnet`, sharing the keystore and sending code of `testnet.mts` via `web/lib/server/chain97.mts`).

- **Off by default.** The routes answer 404 unless the server has `DEMO_TESTNET_RUNNER=1`, the build is chain 97
  and `DEMO_TESTNET_SECRETS_DIR` is set. `pnpm testnet:web` sets all three (plus `DEMO_TESTNET_ENV_FILE`, the root
  `.env`, for the RPC and the deployer keystore); `DEMO_TESTNET_RUNNER=0 pnpm testnet:web` switches it off. The unit
  gets paths only, never key material. The RPC must answer chainId 97 or nothing is signed.
- **Wallets.** Owner (`landlord`), renter (`tenant`) and a separate demo dispute desk (named per rental, so the deployer never signs a demo
  step) live in `<secrets>/testnet-demo-wallets.json` (mode 600), created on first use. A wallet below 0.002 tBNB is
  topped up by the deployer with 0.005 tBNB (hard cap); if that would leave the deployer under 0.05 tBNB the run is
  refused with a friendly message. Top-ups show on the demo timeline.
- **One run at a time.** The browser pings every 10 s while its run plays (or waits for a click); the lock is freed
  at the end, when the tab closes, or 45 s after the last ping (an error screen stops the pings). Start over from the
  same browser takes its own run over. A visitor who finds the demo busy sees "free in ~N s" and starts by itself
  (up to 10 minutes). A run whose lock lapsed mid-story resumes its demo rental. The stage's contract reads go through
  `/api/demo-testnet/read` (this run's factory, token and rental escrow only) on the server's RPC, at the run's latest
  receipt block, so a viewer's slow route to a public RPC cannot stall a step.
- **Limits.** At most one run per 60 s and 12 per hour (`DEMO_TESTNET_MIN_GAP_S`, `DEMO_TESTNET_RUNS_PER_HOUR`); 2.5M gas and 20 transactions per run
  (`DEMO_TESTNET_MAX_GAS_PER_RUN`); 1 gwei legacy gas price; a 45 s receipt timeout (`DEMO_TESTNET_TX_TIMEOUT_S`) after
  which Retry waits for the same transaction instead of sending it again. Only the story's own calls are signed: an
  allowlist checks the contract, function, role and arguments (`guards.ts`, unit-tested).
- **Two seams for other hosts (Cloudflare Workers).** Keys come from one loader, `lib/server/demoTestnet/keys.ts`
  `loadDemoSecrets`: with `DEMO_TESTNET_KEYS` set (JSON `{"landlord","tenant","arbiter"}` private keys for owner, renter and dispute desk, as Worker
  secrets) plus `DEMO_TESTNET_RPC_URL` and an optional `DEMO_TESTNET_FUNDER_KEY` (a small dedicated top-up wallet, not
  the deployer; without it a low wallet refuses the run), it uses env vars and touches no filesystem; otherwise the
  secrets dir as above, with the deployer keystore as funder. The lock, rate limit and run state sit behind
  `lib/server/demoTestnet/store.ts` `DemoRunStore` (in memory for `next start`); on Workers back it with one Durable
  Object (`begin` must be atomic, see the interface) and pass it to `getDemoTestnetRunner(env, { store })`. The node:fs
  key code lives in `lib/server/chain97-keys.mts`; `chain97.mts` is viem-only.
- **Dispute desk.** Rentals take an arbiter per rental, so the demo names its own desk wallet; the runner refuses to
  start if that wallet is the factory's default arbiter (the deployer and factory owner), the funder, or a party.
- **Cost.** About 0.0012 tBNB of gas per run. "Owner ignores it" is disabled on testnet (it needs 7 days of real
  time); play it on the local demo.

## opBNB testnet (chainId 5611)

The chain guard already accepts 5611 with `ALLOW_NON_LOCAL_BROADCAST=true`, and the web app lists opBNB testnet. The
wrapper targets chainId 97 only. For opBNB, run the same steps by hand with `OPBNB_TESTNET_RPC_URL`
(e.g. `https://opbnb-testnet-rpc.bnbchain.org`):

```bash
cd contracts
forge script script/Deploy.s.sol --rpc-url "$OPBNB_TESTNET_RPC_URL" --sender "$DEPLOYER_ADDRESS"   # simulate
ALLOW_NON_LOCAL_BROADCAST=true forge script script/Deploy.s.sol --rpc-url "$OPBNB_TESTNET_RPC_URL" \
  --sender "$DEPLOYER_ADDRESS" --account keyescrow-deployer --broadcast --slow     # ONLY AFTER OK
```

This writes `deployments/5611.json`. opBNB gas is much cheaper, and tBNB has to be bridged from BSC testnet first
(<https://opbnb-testnet-bridge.bnbchain.org>). Verification uses `--chain 5611` (opBNBScan via Etherscan V2, or
Sourcify). Making the wrapper chain-agnostic is a small change if opBNB becomes the main target.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `RefusingNonLocalChain(97)` | `ALLOW_NON_LOCAL_BROADCAST=true` missing on the broadcast |
| `RefusingMainnet(56)` | the RPC points at BSC mainnet: by design, never allowed |
| `MissingRoleAddress("…")` | a role address is not set (no defaults off anvil) |
| `RefusingAnvilAccount(…)` | a role or the deployer is an anvil dev account (public key) |
| `DeployerMismatch(expected, actual)` | `DEPLOYER_ADDRESS` is not the keystore or key that signs |
| `MissingDeployer()` | no `--sender` / wallet. Use the wrapper, which passes it |
| preflight exit 2 | `BSC_TESTNET_RPC_URL` unset or the endpoint is down or rate limited. Try another RPC |
