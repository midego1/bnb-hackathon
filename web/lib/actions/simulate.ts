/**
 * Turns a list of contract calls into UNSIGNED transactions and dry-runs them before anyone signs:
 * eth_simulateV1 (anvil, BSC testnet via PublicNode) runs the steps in order on top of each other, so
 * "approve then fund" is checked as a pair. Nodes without eth_simulateV1 fall back to one eth_call per step.
 * A revert comes back as a plain reason (see explainRevert), never as hex.
 */
import {
  BaseError,
  decodeErrorResult,
  decodeFunctionResult,
  encodeFunctionData,
  toFunctionSignature,
  type Abi,
  type AbiFunction,
  type Address,
  type Hex,
} from "viem";
import { escrowFactoryAbi, mockUsdtAbi, rentalEscrowAbi } from "../contracts";
import { contractErrorReason } from "../errors";
import { ActionError, type ActionContext } from "./context";
import { formatToken, STATUS_NAMES } from "./fields";

/** One step an action wants signed. `abi` must contain `functionName`. */
export type Call = {
  to: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  description: string;
};

/** What every prepare_* action returns. */
export type Prepared = {
  chainId: number;
  from: Address;
  steps: { to: Address; data: Hex; value: string; description: string; function: string }[];
  summary: string;
  simulation: { method: "eth_simulateV1" | "eth_call"; ok: true; note?: string };
  /** Values the simulation returned that the caller may want (e.g. the new rental address). */
  expected?: Record<string, unknown>;
  unsigned: true;
};

const ERRORS_ABI = [...rentalEscrowAbi, ...escrowFactoryAbi, ...mockUsdtAbi].filter((i) => i.type === "error") as Abi;

const iso = (s: bigint) => new Date(Number(s) * 1000).toISOString();

/** Plain reason for a decoded custom error, with the numbers that matter. */
export function explainRevert(errorName: string, args: readonly unknown[] = []): string {
  const base = contractErrorReason(errorName) ?? `The contract rejected this (${errorName}).`;
  switch (errorName) {
    case "InvalidStatus":
      return `The rental is in status ${STATUS_NAMES[Number(args[0])] ?? String(args[0])}, which does not allow this.`;
    case "TimeoutNotReached":
      return `The deadline has not been reached yet: it opens at ${iso(args[0] as bigint)}.`;
    case "ArbiterDeadlinePassed":
      return `The dispute desk's deadline passed at ${iso(args[0] as bigint)}. Use prepare_claim_timeout: the full deposit goes back to the renter.`;
    case "InvalidNonce":
      return `The proposal changed: the current one is #${args[0]}, you reviewed #${args[1]}. Read it again (get_lease) before accepting.`;
    case "Unauthorized":
      return `${String(args[0])} is not allowed to do this on this rental.`;
    case "ERC20InsufficientBalance":
      return `Not enough mUSDT in ${String(args[0])}: it has ${formatToken(args[1] as bigint)}, this needs ${formatToken(args[2] as bigint)}.`;
    case "ERC20InsufficientAllowance":
      return `The escrow may only pull ${formatToken(args[1] as bigint)} but needs ${formatToken(args[2] as bigint)}: approve first.`;
    default:
      return base;
  }
}

/** Decode revert data (or a viem error carrying it) into {errorName, args, reason}. */
export function decodeRevert(data: Hex | undefined, fallback?: unknown): { errorName?: string; args?: readonly unknown[]; reason: string } {
  if (data && data !== "0x") {
    try {
      const d = decodeErrorResult({ abi: ERRORS_ABI, data });
      if (d.errorName === "Error") return { errorName: "Error", reason: `The contract rejected this: ${String(d.args?.[0])}` };
      return { errorName: d.errorName, args: d.args, reason: explainRevert(d.errorName, d.args ?? []) };
    } catch {
      /* unknown selector */
    }
  }
  const msg = fallback instanceof BaseError ? fallback.shortMessage : fallback instanceof Error ? fallback.message : undefined;
  return { reason: msg ? `The transaction would fail: ${msg}` : "The transaction would fail (no reason given)." };
}

/** Revert data from a viem error chain, if any. */
function revertData(err: unknown): Hex | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const found = err.walk((e) => typeof (e as { data?: unknown }).data === "string" && /^0x[0-9a-f]*$/i.test((e as { data: string }).data));
  if (found) return (found as unknown as { data: Hex }).data;
  const raw = err.walk((e) => typeof (e as { data?: { data?: unknown } }).data?.data === "string");
  return raw ? ((raw as unknown as { data: { data: Hex } }).data.data) : undefined;
}

function signature(c: Call): string {
  const fn = c.abi.find((i): i is AbiFunction => i.type === "function" && i.name === c.functionName);
  return fn ? toFunctionSignature(fn) : c.functionName;
}

function isUnsupported(err: unknown): boolean {
  const msg = err instanceof BaseError ? `${err.shortMessage} ${err.details ?? ""}` : String(err);
  return /eth_simulateV1|method not found|does not exist|not supported|unsupported|-32601/i.test(msg);
}

/**
 * Encode + simulate `calls` as `from`. Throws ActionError(422) with a plain reason when a step would revert,
 * and ActionError(502) when the node cannot be reached.
 */
export async function prepareCalls(
  ctx: ActionContext,
  from: Address,
  calls: Call[],
  summary: string,
  pick?: (results: { data: Hex; result?: unknown }[]) => Record<string, unknown> | undefined,
): Promise<Prepared> {
  const steps = calls.map((c) => ({
    to: c.to,
    data: encodeFunctionData({ abi: c.abi, functionName: c.functionName, args: c.args ?? [] } as never),
    value: (c.value ?? BigInt(0)).toString(),
    description: c.description,
    function: signature(c),
  }));

  const fail = (i: number, data: Hex | undefined, err?: unknown): never => {
    const d = decodeRevert(data, err);
    throw new ActionError(422, "simulation_reverted", `Step ${i + 1} (${calls[i].description}) would fail: ${d.reason}`, {
      step: i + 1,
      function: steps[i].function,
      ...(d.errorName ? { errorName: d.errorName } : {}),
      ...(d.args ? { args: d.args.map((a) => (typeof a === "bigint" ? a.toString() : a)) } : {}),
    });
  };

  let method: Prepared["simulation"]["method"] = "eth_simulateV1";
  let note: string | undefined;
  let outputs: { data: Hex; result?: unknown }[] = [];
  try {
    const [block] = await ctx.client.simulateBlocks({
      blocks: [{ calls: steps.map((s) => ({ account: from, to: s.to, data: s.data, value: BigInt(s.value) })) }],
    });
    block.calls.forEach((r, i) => {
      if (r.status !== "success") fail(i, r.data, r.error);
    });
    outputs = block.calls.map((r, i) => ({ data: r.data, result: decodeResult(calls[i], r.data) }));
  } catch (err) {
    if (err instanceof ActionError) throw err;
    if (!isUnsupported(err)) {
      const data = revertData(err);
      if (data) fail(0, data, err);
      throw new ActionError(502, "rpc_unavailable", "Could not simulate on the blockchain node. Try again in a moment.", {
        cause: err instanceof BaseError ? err.shortMessage : String(err),
      });
    }
    // No eth_simulateV1: eth_call each step on its own. A later step that only fails because an earlier one has not
    // been mined yet (e.g. fund before approve) is reported in `note` instead of as an error.
    method = "eth_call";
    outputs = [];
    for (const [i, s] of steps.entries()) {
      try {
        const r = await ctx.client.call({ account: from, to: s.to, data: s.data, value: BigInt(s.value) });
        outputs.push({ data: r.data ?? "0x", result: decodeResult(calls[i], r.data ?? "0x") });
      } catch (e) {
        if (i === 0) fail(i, revertData(e), e);
        note = `This node has no eth_simulateV1; steps after step 1 were checked one by one and step ${i + 1} depends on the earlier steps being mined first.`;
        outputs.push({ data: "0x" });
      }
    }
  }

  const expected = pick?.(outputs);
  return {
    chainId: ctx.chainId,
    from,
    steps,
    summary,
    simulation: { method, ok: true, ...(note ? { note } : {}) },
    ...(expected ? { expected } : {}),
    unsigned: true,
  };
}

function decodeResult(c: Call, data: Hex): unknown {
  if (!data || data === "0x") return undefined;
  try {
    const fn = c.abi.find((i): i is AbiFunction => i.type === "function" && i.name === c.functionName);
    if (!fn || fn.outputs.length === 0) return undefined;
    // Single output only; that's all the actions need (createLease -> address).
    return decodeFunctionResult({ abi: [fn], functionName: fn.name, data });
  } catch {
    return undefined;
  }
}
