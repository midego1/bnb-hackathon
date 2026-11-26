/**
 * The rental actions on the agent: parity of every definition across MCP, A2A, OpenAPI and the REST route table,
 * and an integration run against a throwaway LOCAL anvil (prepare -> sign with a dev key -> state changes).
 */
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createPublicClient, createTestClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildOpenApi, inputJsonSchema } from "../../web/lib/actions/openapi.ts";
import { handleActionRequest, ROUTES } from "../../web/lib/actions/rest.ts";
import { ANVIL_DEV_KEYS, startLocalChain, type LocalChain } from "../scripts/local-chain.ts";
import { buildAgentCard } from "../src/card.ts";
import { loadConfig } from "../src/config.ts";
import { buildApp } from "../src/server.ts";
import { ACTIONS, PriceService, toolDescription, type ActionHost } from "../src/shared.ts";
import { listen } from "./helpers.ts";

type Prepared = { chainId: number; from: Address; steps: { to: Address; data: Hex; value: string; description: string }[]; summary: string; expected?: { lease?: Address } };

async function mcpClient(url: string) {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));
  return client;
}

describe("one definition per action -> MCP, A2A, OpenAPI and REST", () => {
  let url: string;
  let close: () => Promise<void>;
  beforeAll(async () => {
    // RPC on a closed local port: the parity checks never need a chain.
    const host: ActionHost = { env: { KEYESCROW_RPC_URL_31337: "http://127.0.0.1:9" } };
    ({ url, close } = await listen(buildApp(loadConfig({ INSPECTOR_DEPLOYMENT: "/nonexistent" }), { provider: null, actions: host }), 3180));
  });
  afterAll(() => close());

  it("every action is an MCP tool, an A2A skill, an OpenAPI operation and a route, described the same way", async () => {
    const client = await mcpClient(url);
    const { tools } = await client.listTools();
    await client.close();
    const card = buildAgentCard("http://localhost:8790", null);
    const doc = buildOpenApi();

    for (const a of ACTIONS) {
      const tool = tools.find((t) => t.name === a.name);
      expect(tool, `MCP tool ${a.name}`).toBeDefined();
      expect(tool!.title).toBe(a.title);
      expect(tool!.description).toBe(toolDescription(a));
      expect(tool!.annotations).toMatchObject({ readOnlyHint: true });
      const schema = inputJsonSchema(a.input);
      expect(Object.keys(tool!.inputSchema.properties ?? {}).sort(), `${a.name} MCP fields`).toEqual(Object.keys(schema.properties ?? {}).sort());
      expect([...(tool!.inputSchema.required ?? [])].sort()).toEqual([...(schema.required ?? [])].sort());

      const skill = card.skills.find((s) => s.id === a.name);
      expect(skill?.description, `A2A skill ${a.name}`).toBe(toolDescription(a));

      const method = a.kind === "read" ? "get" : "post";
      expect((doc.paths[`/api/v1/${a.name}`] as Record<string, { operationId: string }>)?.[method]?.operationId, `OpenAPI ${a.name}`).toBe(a.name);
      expect(ROUTES.find((r) => r.action === a.name)).toEqual({ action: a.name, method: method.toUpperCase(), path: `/api/v1/${a.name}` });
    }
    // Nothing extra either: the only non-action tools are the inspector's own three.
    expect(tools.map((t) => t.name).filter((n) => !ACTIONS.some((a) => a.name === n)).sort()).toEqual(["inspect_move_out", "inspector_identity", "verify_report"]);
    expect(ROUTES).toHaveLength(ACTIONS.length);
  });

  it("MCP validates with the definition's schema and returns errors as isError + {error, code}", async () => {
    const client = await mcpClient(url);
    const bad = await client.callTool({ name: "prepare_fund", arguments: { lease: "0x1", from: "0x2" } });
    expect(bad.isError).toBe(true);
    const down = await client.callTool({ name: "get_lease", arguments: { lease: "0x9f1ac54BEF0DD2f6f3462EA0fa94fC62300d3a8e" } });
    expect(down.isError).toBe(true);
    expect(down.structuredContent).toMatchObject({ code: "rpc_unavailable", error: expect.stringMatching(/Could not reach/) });
    await client.close();
  });
});

describe("integration: prepare -> sign with an anvil dev key -> state changes (local anvil only)", () => {
  let chain: LocalChain;
  let url: string;
  let close: () => Promise<void>;
  let host: ActionHost;
  const owner = privateKeyToAccount(ANVIL_DEV_KEYS.owner);
  const renter = privateKeyToAccount(ANVIL_DEV_KEYS.renter);
  const desk = privateKeyToAccount(ANVIL_DEV_KEYS.arbiter);

  beforeAll(async () => {
    chain = await startLocalChain();
    const prices = new PriceService({ env: {} });
    host = { env: { KEYESCROW_CHAIN_ID: "31337", KEYESCROW_RPC_URL_31337: chain.rpc }, prices: () => prices.get() };
    ({ url, close } = await listen(buildApp(loadConfig({ INSPECTOR_DEPLOYMENT: "/nonexistent" }), { provider: null, actions: host }), 3185));
  }, 120_000);
  afterAll(async () => {
    await close?.();
    chain?.stop();
  });

  const pub = () => createPublicClient({ transport: http(chain.rpc) });
  async function sign(p: Prepared, key: Hex) {
    expect(p.chainId).toBe(31337);
    const account = privateKeyToAccount(key);
    expect(p.from).toBe(account.address);
    const wallet = createWalletClient({ account, chain: { ...foundry, rpcUrls: { default: { http: [chain.rpc] } } }, transport: http(chain.rpc) });
    for (const s of p.steps) {
      const receipt = await pub().waitForTransactionReceipt({ hash: await wallet.sendTransaction({ to: s.to, data: s.data, value: BigInt(s.value) }) });
      expect(receipt.status, s.description).toBe("success");
    }
  }
  const tool = async <T>(client: Client, name: string, args: Record<string, unknown>) => {
    const res = await client.callTool({ name, arguments: args });
    return { ok: !res.isError, data: res.structuredContent as T };
  };

  it("creates, funds, proposes and settles a rental through the MCP tools", async () => {
    const client = await mcpClient(url);
    const create = await tool<Prepared>(client, "prepare_create_lease", { from: owner.address, renter: renter.address, rent: "3300", currency: "THB", depositMonths: 2, termPeriods: 3 });
    expect(create.ok).toBe(true);
    expect(create.data.summary).toMatch(/rent 100.00 mUSDT per month/);
    await sign(create.data, ANVIL_DEV_KEYS.owner);
    const lease = create.data.expected!.lease!;

    const created = await tool<{ status: string; owner: string; deposit: { units: string } }>(client, "get_lease", { lease });
    expect(created.data).toMatchObject({ status: "Created", owner: owner.address, deposit: { units: "200000000" } });
    expect((await tool<{ leases: { address: string }[] }>(client, "list_leases", { party: renter.address, role: "renter" })).data.leases[0].address).toBe(lease);

    const fund = await tool<Prepared>(client, "prepare_fund", { lease, from: renter.address });
    expect(fund.data.steps.map((s) => s.description)).toEqual([expect.stringMatching(/^Approve 300.00 mUSDT/), expect.stringMatching(/^Pay the deposit/)]);
    await sign(fund.data, ANVIL_DEV_KEYS.renter);
    expect((await tool<{ status: string }>(client, "get_lease", { lease })).data.status).toBe("Active");

    const propose = await tool<Prepared>(client, "prepare_propose_settlement", { lease, from: renter.address, toRenter: "180", note: "Scratch on the left side panel" });
    await sign(propose.data, ANVIL_DEV_KEYS.renter);
    const explained = await tool<{ status: string; next: { who: string; action: string }[] }>(client, "explain_status", { lease, viewer: owner.address });
    expect(explained.data.status).toBe("MoveOut");
    expect(explained.data.next[0]).toMatchObject({ who: "owner", action: "prepare_accept" });

    // The proposer cannot accept their own proposal: refused before simulating.
    expect((await tool(client, "prepare_accept", { lease, from: renter.address })).data).toMatchObject({ code: "precondition_failed" });

    const token = (await tool<{ token: Address }>(client, "get_lease", { lease })).data.token;
    const erc20 = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }] as const;
    const renterBalance = () => pub().readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [renter.address] });
    const before = await renterBalance();
    const accept = await tool<Prepared>(client, "prepare_accept", { lease, from: owner.address, nonce: 1 });
    await sign(accept.data, ANVIL_DEV_KEYS.owner);
    const settled = await tool<{ status: string; escrowBalance: { units: string } }>(client, "get_lease", { lease });
    expect(settled.data).toMatchObject({ status: "Settled", escrowBalance: { units: "0" } });
    expect((await renterBalance()) - before).toBe(BigInt(180_000_000)); // the agreed refund; the due month's rent went to the owner
    await client.close();
  }, 60_000);

  it("simulation refuses a premature timeout with the deadline, then the dispute desk path works after a time jump", async () => {
    const disputed = chain.seeded.disputedLease;
    const early = await handleActionRequest(
      new Request("http://x/api/v1/prepare_claim_timeout", { method: "POST", body: JSON.stringify({ lease: disputed, from: renter.address }) }),
      "prepare_claim_timeout",
      host,
    );
    expect(early.status).toBe(422);
    expect(await early.json()).toMatchObject({ code: "simulation_reverted", error: expect.stringMatching(/deadline has not been reached yet: it opens at 20\d\d-/), details: { errorName: "TimeoutNotReached" } });

    // Only the dispute desk can rule.
    const client = await mcpClient(url);
    const info = (await tool<{ arbiterDeadline: string; chainTime: string }>(client, "get_lease", { lease: disputed })).data;
    expect((await tool(client, "prepare_resolve", { lease: disputed, from: owner.address, toRenter: "1", ruling: "x" })).data).toMatchObject({ code: "precondition_failed" });
    const resolve = await tool<Prepared>(client, "prepare_resolve", { lease: disputed, from: desk.address, toRenter: "1", ruling: "Damage claim partly upheld." });
    expect(resolve.data).toMatchObject({ unsigned: true });

    // Past the arbiter deadline: resolve would now revert, the fallback goes through.
    const wait = (Date.parse(info.arbiterDeadline) - Date.parse(info.chainTime)) / 1000 + 3600;
    await createTestClient({ mode: "anvil", transport: http(chain.rpc) }).increaseTime({ seconds: wait });
    await createTestClient({ mode: "anvil", transport: http(chain.rpc) }).mine({ blocks: 1 });
    const late = await tool(client, "prepare_resolve", { lease: disputed, from: desk.address, toRenter: "1", ruling: "late" });
    expect(late.data).toMatchObject({ code: "simulation_reverted", details: { errorName: "ArbiterDeadlinePassed" } });
    const claim = await tool<Prepared>(client, "prepare_claim_timeout", { lease: disputed, from: renter.address });
    await sign(claim.data, ANVIL_DEV_KEYS.renter);
    expect((await tool<{ status: string }>(client, "get_lease", { lease: disputed })).data.status).toBe("Settled");
    await client.close();

    // A2A (JSON-RPC message/send) carries the same actions.
    const rpc = await fetch(`${url}/a2a`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: { message: { kind: "message", role: "user", messageId: randomUUID(), parts: [{ kind: "data", data: { skill: "explain_status", lease: disputed } }] } },
      }),
    });
    const { result } = (await rpc.json()) as { result: { parts: { kind: string; data: unknown }[] } };
    expect(result.parts[0].data).toMatchObject({ status: "Settled", headline: expect.stringMatching(/Closed/) });
  }, 60_000);
});
