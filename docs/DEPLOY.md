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
DEFAULT_ARBITER=0x...             # KeyEscrow dispute desk (the default arbiter for leases)
# FEE_BPS=1000                    # optional: 10% of ONE month's rent, once per lease (max 1000)
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
- Lease escrows are EIP-1167 clones of the verified `RentalEscrow` implementation, so their code is the verified code.

Check the result at `https://testnet.bscscan.com/address/<escrowFactory>#code`.

## 8. Point the web app at chain 97

`contracts/deployments/97.json` has the same keys as `31337.json` (`chainId`, `token`, `escrowFactory`,
`rentalEscrowImplementation`, roles, `feeBps`, `startBlock`, `tokenSymbol`, `tokenDecimals`). In `web/.env.local`:

```bash
NEXT_PUBLIC_CHAIN_ID=97
NEXT_PUBLIC_BSC_TESTNET_RPC_URL=https://data-seed-prebsc-1-s1.bnbchain.org:8545
NEXT_PUBLIC_ESCROW_FACTORY_ADDRESS=0x...   # printed by step 6 (= escrowFactory in 97.json)
NEXT_PUBLIC_MOCK_USDT_ADDRESS=0x...        # printed by step 6 (= token in 97.json)
```

Then `pnpm -C web build` and deploy or run the web app as usual. Testers get MockUSDT from its capped faucet
(`MockUSDT.faucet(to, amount)`, see `contracts/src/mocks/MockUSDT.sol`) and need a little tBNB from step 1 for gas.

`Seed.s.sol` is anvil-only and refuses chain 97. On testnet, demo leases are created through the app.

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
