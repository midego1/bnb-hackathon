# Test fixtures

JSON captured from the live API (`https://keyescrow-web.mdgooijer.workers.dev`, BSC testnet, contract v2) on
2026-11-26: `get_lease`, `list_leases`, `explain_status`, `prepare_fund`, `/api/price`,
`/api/stage/mystery-box`, `/api/chain/index` (trimmed to two contracts) and `/api/settlement` (demo inspector).
Only public on-chain addresses; no keys.

`listings.json` is `GET /api/listings` from a local `next start` of this repo's web app (http://127.0.0.1:3997, so
the photo URLs point there) on 2026-11-26, after the one-catalogue change; the live Worker answers the same shape.

The signer vectors in `SignerTests.swift` come from viem 2.58.6:

```js
import { privateKeyToAccount } from "viem/accounts";
import { encodeFunctionData, parseAbi, parseGwei, parseEther } from "viem";
const acct = privateKeyToAccount("0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318"); // public test key
const data = encodeFunctionData({ abi: parseAbi(["function approve(address,uint256)"]), functionName: "approve",
  args: ["0xcCC2a45748Cd1F9F97e9108101D2d1e3d329A99C", 300000000n] });
await acct.signTransaction({ type: "legacy", chainId: 97, nonce: 0, gasPrice: parseGwei("0.1"), gas: 60000n,
  to: "0x7aF0035c254bC760231BCcFF3403A714611c35B1", value: 0n, data });
await acct.signTransaction({ type: "legacy", chainId: 97, nonce: 7, gasPrice: parseGwei("1"), gas: 21000n,
  to: "0x8Ef4090Ac400622c2fE32a7244AA65Bbd1A6933C", value: parseEther("0.0004"), data: "0x" });
```
