# KeyScrow contracts

Foundry project with the on-chain part of KeyScrow.

| Contract | Purpose |
| --- | --- |
| `EscrowFactory` | Deploys one `RentalEscrow` per rental and indexes rentals by owner (`landlord`) / renter (`tenant`) / arbiter. |
| `RentalEscrow` | Holds deposit + rent in a stablecoin, releases rent monthly, settles the deposit by mutual agreement, arbiter ruling, or one of two timeouts. |
| `MockUSDT` | Testnet-only 6-decimal stablecoin with a capped faucet. |

```bash
forge build
forge test -vv
forge coverage --report summary --no-match-coverage "(test|script)/"
```

## Settlement rules

| Path | Who triggers | Deposit goes to |
| --- | --- | --- |
| Proposal accepted | the counterparty | split as proposed |
| Dispute resolved | the arbiter, before the arbiter deadline | split as ruled |
| Owner-response timeout | anyone, `responseWindow` (default 7 days) after an unanswered *renter* proposal | **renter, in full** |
| Arbiter-deadline fallback | anyone, `arbiterWindow` (default 14 days) after a dispute is opened | **renter, in full** |

Both timeouts put the burden of proof on the owner: a deposit claim that the owner never defended, or that the
arbiter never upheld, is not paid. A counter-proposal or dispute by the owner stops the response clock. Once the
arbiter deadline passes the arbiter can no longer rule, so the fallback cannot be raced. In every path, rent already
released stays released, funded rent that is due goes to the owner and prepaid rent that is not yet due goes back
to the renter.

This is a product choice, not a technical constraint. To change it, edit the amounts passed to `_settle` in
`RentalEscrow.claimTimeout` / `RentalEscrow.claimArbiterTimeout` (and the matching tests). Both windows are set per
lease at creation (`EscrowFactory.createLease`, 0 = default; response 1-60 days, arbiter 1-90 days).

## Platform roles and fee

- **Default arbiter.** `EscrowFactory.defaultArbiter` is the KeyScrow dispute desk (owner-settable). A rental created
  with `arbiter = address(0)` uses it; a owner may still name any other arbiter that is neither party.
- **Protocol fee.** Once per rental, `feeBps` of **one month's** rent (default 1000 = 10%, hard cap 1000) is deducted
  from the owner's first rent payout and sent to `feeRecipient` (KeyScrow treasury). It is never taken from the
  deposit or charged to the renter. Rate and recipient are snapshotted into each rental, so later changes only affect
  new rentals. Emits `ProtocolFeePaid`.

## Scripts

| Script | Purpose |
| --- | --- |
| `script/Deploy.s.sol` | Deploys MockUSDT (unless `TOKEN_ADDRESS`) + EscrowFactory, writes `deployments/<chainId>.json` (`<chainId>.dry-run.json` when only simulated). Chain guard: 31337 always; 97 / 5611 only with `ALLOW_NON_LOCAL_BROADCAST=true`; mainnets and any other chain refused. Off anvil the role addresses (`FACTORY_OWNER`, `FEE_RECIPIENT`, `DEFAULT_ARBITER`) are required and anvil dev accounts are refused. |
| `script/Seed.s.sol` | Anvil only. Mints demo balances and creates + funds one demo rental, writes `deployments/31337.demo.json`. |
| `script/testnet.sh` | BSC testnet (97) wrapper: `check` (preflight, never sends a tx), `deploy` (the one broadcast), `verify` (BscScan), `rehearse` (`testnet-rehearsal.sh`: full path against a local anvil with `--chain-id 97`). See [docs/DEPLOY.md](../docs/DEPLOY.md). |

The end-to-end runner (`pnpm e2e:chain`, source in `web/scripts/e2e-chain.mts`) uses both against a throwaway anvil.

### BSC testnet

```bash
pnpm deploy:testnet:rehearse                          # local only: anvil --chain-id 97 / 56, every refusal + a deploy
pnpm deploy:testnet:check                             # preflight against BSC_TESTNET_RPC_URL; sends nothing
ALLOW_NON_LOCAL_BROADCAST=true pnpm deploy:testnet    # ONLY AFTER OK: broadcast, post-check, verify
pnpm deploy:testnet:verify                            # re-run verification from deployments/97.json
```

Step by step (faucet, keystore, env, web config, opBNB): [docs/DEPLOY.md](../docs/DEPLOY.md).

Dependencies are git submodules under `lib/` (`git submodule update --init --recursive`).
