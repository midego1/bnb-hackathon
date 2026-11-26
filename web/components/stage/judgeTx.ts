"use client";

import { parseGwei, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { EvidenceKind, LeaseStatus, mockUsdtAbi, rentalEscrowAbi } from "@/lib/contracts";

/**
 * The judge's own transactions (signed on the phone: guest key or their wallet). Each one first reads the chain and
 * skips what is already done, so a double tap or a reload never pays twice.
 */

/**
 * BSC mainnet has no base fee and accepts 0.05-0.1 gwei; a default 1 gwei tip would make the judge's ~8 transactions
 * cost more than the 0.0003 BNB the drip sends. So: the node's price, never above the 0.1 gwei the server signs at.
 */
const MAINNET_MAX_GAS_PRICE = parseGwei("0.1");
async function mainnetGasPrice(pub: PublicClient) {
  const p = await pub.getGasPrice();
  return p < MAINNET_MAX_GAS_PRICE ? p : MAINNET_MAX_GAS_PRICE;
}

/**
 * BSC testnet: type-2 transactions at the node's 0.1 gwei tip can sit in the public RPC's pool for minutes (seen
 * 26 Nov), while legacy 1 gwei ones land in the next block. The server's drip signs at 1 gwei and sends enough for that.
 */
const TESTNET_GAS_PRICE = parseGwei("1");

async function send(wc: WalletClient, pub: PublicClient, call: { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[] }): Promise<Hex> {
  const id = wc.chain?.id;
  // On testnet the nonce comes from the last mined block, so a stuck low-tip transaction is replaced, not queued behind.
  const fees =
    id === 56
      ? { type: "legacy", gasPrice: await mainnetGasPrice(pub) }
      : id === 97
        ? { type: "legacy", gasPrice: TESTNET_GAS_PRICE, nonce: await pub.getTransactionCount({ address: wc.account!.address, blockTag: "latest" }) }
        : {};
  const hash = await wc.writeContract({ ...call, ...fees, account: wc.account!, chain: wc.chain } as never);
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (r.status !== "success") throw new Error("The transaction was reverted on-chain. Try again.");
  return hash;
}

/** approve (if the allowance is short) + fund (if still unfunded). */
export async function fundLease(wc: WalletClient, pub: PublicClient, lease: Address) {
  const me = wc.account!.address;
  const read = <T>(functionName: string) => pub.readContract({ address: lease, abi: rentalEscrowAbi, functionName: functionName as never }) as Promise<T>;
  const [status, terms] = await Promise.all([read<number>("status"), read<{ token: Address; rentAmount: bigint; depositAmount: bigint }>("terms")]);
  if (status !== LeaseStatus.Created) return;
  const need = terms.rentAmount + terms.depositAmount;
  const allowance = await pub.readContract({ address: terms.token, abi: mockUsdtAbi, functionName: "allowance", args: [me, lease] });
  if (allowance < need) await send(wc, pub, { address: terms.token, abi: mockUsdtAbi, functionName: "approve", args: [lease, need] });
  await send(wc, pub, { address: lease, abi: rentalEscrowAbi, functionName: "fund", args: [] });
}

/** addEvidence for each photo hash not anchored yet. */
export async function anchorPhotos(wc: WalletClient, pub: PublicClient, lease: Address, kind: "pickup" | "return", hashes: Hex[], anchored: string[]) {
  const k = kind === "pickup" ? EvidenceKind.CheckIn : EvidenceKind.CheckOut;
  for (const h of hashes) {
    if (anchored.includes(h.toLowerCase())) continue;
    await send(wc, pub, { address: lease, abi: rentalEscrowAbi, functionName: "addEvidence", args: [k, h] });
  }
}

/** propose(tenantRefund, reportHash), unless this exact proposal is already on the table. */
export async function proposeSplit(wc: WalletClient, pub: PublicClient, lease: Address, tenantRefund: bigint, reportHash: Hex) {
  const p = (await pub.readContract({ address: lease, abi: rentalEscrowAbi, functionName: "proposal" })) as { tenantRefund: bigint; reportHash: Hex; proposer: Address };
  const status = (await pub.readContract({ address: lease, abi: rentalEscrowAbi, functionName: "status" })) as number;
  if (status === LeaseStatus.MoveOut && p.reportHash === reportHash && p.tenantRefund === tenantRefund) return;
  await send(wc, pub, { address: lease, abi: rentalEscrowAbi, functionName: "propose", args: [tenantRefund, reportHash] });
}
