# KeyEscrow contracts

Foundry project with the on-chain part of KeyEscrow.

| Contract | Purpose |
| --- | --- |
| `EscrowFactory` | Deploys one `RentalEscrow` per lease and indexes leases by landlord / tenant / arbiter. |
| `RentalEscrow` | Holds deposit + rent in a stablecoin, releases rent monthly, settles the deposit by mutual agreement, arbiter ruling, or timeout. |
| `MockUSDT` | Testnet-only 6-decimal stablecoin with a capped faucet. |

```bash
forge build
forge test -vv
forge coverage --report summary
```

Dependencies are git submodules under `lib/` (`git submodule update --init --recursive`).
