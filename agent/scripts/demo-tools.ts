/**
 * `pnpm agent:demo:tools`: the rental actions as an AI agent sees them, end to end on a LOCAL chain.
 *
 *   1. starts a throwaway anvil (31337, free port in 28660-28689), deploys + seeds it (forge scripts)
 *   2. starts KeyScrow Inspector in-process with the rental tools pointed at that anvil
 *   3. as an MCP client (Streamable HTTP, like Claude): lists the tools, explain_status on the seeded rental,
 *      prepare_create_lease from baht amounts, then prepare_fund for the renter
 *   4. signs the returned UNSIGNED steps with anvil's public dev keys and shows the rental created and funded
 *
 * LOCAL ONLY: it refuses to sign unless both the prepared steps and the node say chainId 31337. It never touches
 * BSC testnet or any other chain, and the tools themselves never see a key.
 */
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { loadConfig } from "../src/config.ts";
import { buildApp } from "../src/server.ts";
import { PriceService } from "../src/shared.ts";
import { ANVIL_DEV_KEYS, startLocalChain } from "./local-chain.ts";

type Prepared = { chainId: number; from: Hex; steps: { to: Hex; data: Hex; value: string; description: string }[]; summary: string; expected?: { lease?: Hex } };

const B = process.stdout.isTTY ? "\x1b[1m" : "";
const D = process.stdout.isTTY ? "\x1b[2m" : "";
const N = process.stdout.isTTY ? "\x1b[0m" : "";
const say = (s: string) => console.log(`\n${B}${s}${N}`);
const indent = (s: string) => s.split("\n").map((l) => `   ${D}|${N} ${l}`).join("\n");

const chain = await startLocalChain();
let server: Server | undefined;
try {
  console.log(`local anvil ${chain.rpc} (chainId 31337), seeded rental ${chain.seeded.lease}`);
  const prices = new PriceService({ env: {} }); // demo rates, no API keys
  const app = buildApp(loadConfig({ INSPECTOR_DEPLOYMENT: "/nonexistent" }), {
    provider: null,
    actions: { env: { KEYESCROW_CHAIN_ID: "31337", KEYESCROW_RPC_URL_31337: chain.rpc }, prices: () => prices.get() },
  });
  const url = await new Promise<string>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const a = server!.address();
      resolve(`http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`);
    });
  });

  const mcp = new Client({ name: "keyescrow-demo-tools", version: "0.1.0" });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));
  const call = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    console.log(`${D}> tools/call ${name} ${JSON.stringify(args)}${N}`);
    const res = await mcp.callTool({ name, arguments: args });
    if (res.isError) throw new Error(`${name}: ${JSON.stringify(res.structuredContent)}`);
    return res.structuredContent as T;
  };

  say(`MCP ${url}/mcp: tools/list`);
  const { tools } = await mcp.listTools();
  console.log(indent(tools.map((t) => `${t.name.padEnd(28)} ${t.title ?? ""}`).join("\n")));

  const renter = privateKeyToAccount(ANVIL_DEV_KEYS.renter);
  const owner = privateKeyToAccount(ANVIL_DEV_KEYS.owner);

  say(`"Where is my deposit?" (renter ${renter.address}, seeded rental)`);
  const ex = await call<{ text: string }>("explain_status", { lease: chain.seeded.lease, viewer: renter.address });
  console.log(indent(ex.text));

  say(`"Rent my scooter to ${renter.address} for 6 months, 3,500 baht a month, 2 months deposit"`);
  const create = await call<Prepared>("prepare_create_lease", {
    from: owner.address,
    renter: renter.address,
    rent: "3500",
    currency: "THB",
    depositMonths: 2,
    termPeriods: 6,
  });
  console.log(indent(`summary: ${create.summary}\nsteps:   ${create.steps.map((s) => s.description).join(" -> ")}\nexpected rental: ${create.expected?.lease}`));
  await sign(create, ANVIL_DEV_KEYS.owner);
  const lease = create.expected!.lease!;

  say("explain_status on the new rental");
  console.log(indent((await call<{ text: string }>("explain_status", { lease, viewer: renter.address })).text));

  say("Renter: prepare_fund (approve + fund, simulated as a pair)");
  const fund = await call<Prepared>("prepare_fund", { lease, from: renter.address });
  console.log(indent(`summary: ${fund.summary}\nsteps:   ${fund.steps.map((s) => s.description).join(" -> ")}`));
  await sign(fund, ANVIL_DEV_KEYS.renter);

  say("get_lease after signing");
  const after = await call<{ status: string; deposit: { display: string }; rent: { display: string }; escrowBalance: { display: string } }>("get_lease", { lease });
  console.log(indent(`status ${after.status} · deposit ${after.deposit.display} · rent ${after.rent.display}/month · escrow holds ${after.escrowBalance.display}`));

  say("A mistake comes back as a plain reason before anyone signs (the simulation reverts):");
  console.log(`${D}> tools/call prepare_create_lease (owner rents to themselves)${N}`);
  const bad = await mcp.callTool({ name: "prepare_create_lease", arguments: { from: owner.address, renter: owner.address, rent: "3500", depositMonths: 2, termPeriods: 6 } });
  console.log(indent(JSON.stringify(bad.structuredContent)));
  console.log(`${D}> tools/call prepare_fund (renter funds twice)${N}`);
  const again = await mcp.callTool({ name: "prepare_fund", arguments: { lease, from: renter.address } });
  console.log(indent(JSON.stringify(again.structuredContent)));

  await mcp.close();
  console.log("\ndone: every transaction was prepared by the tools unsigned and signed here with a LOCAL anvil dev key.");
} finally {
  server?.close();
  chain.stop();
}

/** Sign + send each step with an anvil dev key. Refuses anything but the local chain. */
async function sign(p: Prepared, key: Hex) {
  const account = privateKeyToAccount(key);
  if (p.chainId !== 31337) throw new Error(`refusing to sign for chain ${p.chainId}: this demo only signs on local anvil`);
  if (account.address.toLowerCase() !== p.from.toLowerCase()) throw new Error(`steps are for ${p.from}, not ${account.address}`);
  const wallet = createWalletClient({ account, chain: { ...foundry, rpcUrls: { default: { http: [chain.rpc] } } }, transport: http(chain.rpc) });
  if ((await wallet.getChainId()) !== 31337) throw new Error("the node is not a local anvil (31337); refusing to sign");
  for (const [i, s] of p.steps.entries()) {
    const hash = await wallet.sendTransaction({ to: s.to, data: s.data, value: BigInt(s.value) });
    const receipt = await createPublicClient({ transport: http(chain.rpc) }).waitForTransactionReceipt({ hash });
    console.log(indent(`signed step ${i + 1} (${s.description}) as ${account.address}: ${receipt.status}, block ${receipt.blockNumber}`));
    if (receipt.status !== "success") throw new Error(`step ${i + 1} reverted`);
  }
}
