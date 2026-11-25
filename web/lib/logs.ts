import type { PublicClient } from "viem";

/**
 * Runs a log query over [fromBlock, latest]. Anvil answers any range in one call; public BSC testnet RPCs cap the
 * range, so on other chains the query is split into windows (a few in parallel).
 */
export async function inBlockWindows<T>(
  client: PublicClient,
  fromBlock: bigint,
  query: (range: { fromBlock: bigint; toBlock: bigint }) => Promise<T[]>,
  windowSize = BigInt(5_000),
): Promise<T[]> {
  const latest = await client.getBlockNumber();
  if (client.chain?.id === 31337 || latest - fromBlock <= windowSize) return query({ fromBlock, toBlock: latest });
  const ranges: { fromBlock: bigint; toBlock: bigint }[] = [];
  for (let start = fromBlock; start <= latest; start += windowSize) {
    const end = start + windowSize - BigInt(1);
    ranges.push({ fromBlock: start, toBlock: end > latest ? latest : end });
  }
  const out: T[] = [];
  for (let i = 0; i < ranges.length; i += 4) {
    const batch = await Promise.all(ranges.slice(i, i + 4).map(query));
    for (const b of batch) out.push(...b);
  }
  return out;
}
