import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import deployment from "../deployments/97.json" with { type: "json" };
import { SAMPLE_REQUEST } from "../scripts/sample.ts";
import worker from "../src/worker.ts";

/** The Cloudflare Worker entry (src/worker.ts), driven with plain Web Requests like workerd would. */
const call = (path: string, init?: RequestInit, env: Record<string, unknown> = {}, origin = "https://keyescrow-agent.example.workers.dev") =>
  worker.fetch(new Request(origin + path, init), env);
const post = (path: string, body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

describe("agent on Cloudflare Workers", () => {
  it("serves the agent card and registration file for the URL it is reached on", async () => {
    const card = await (await call("/.well-known/agent-card.json")).json();
    expect(card).toMatchObject({ name: "KeyEscrow Inspector", url: "https://keyescrow-agent.example.workers.dev/a2a" });
    const reg = await (await call("/.well-known/agent-registration.json")).json();
    expect(JSON.stringify(reg)).toContain("https://keyescrow-agent.example.workers.dev/mcp");
    const pinned = await (await call("/.well-known/agent-card.json", undefined, { AGENT_PUBLIC_URL: "https://agent.keyescrow.test/" })).json();
    expect(pinned.url).toBe("https://agent.keyescrow.test/a2a");
  });

  it("answers REST, A2A and MCP in mock mode", async () => {
    const rest = await call("/inspect", post("/inspect", SAMPLE_REQUEST));
    expect(rest.status).toBe(200);
    const report = await rest.json();
    expect(BigInt(report.tenantRefund) + BigInt(report.landlordClaim)).toBe(BigInt(SAMPLE_REQUEST.deposit));

    const a2a = await (
      await call("/a2a", post("/a2a", { jsonrpc: "2.0", id: 1, method: "message/send", params: { message: { kind: "message", role: "user", messageId: "m1", parts: [{ kind: "data", data: SAMPLE_REQUEST }] } } }))
    ).json();
    expect(a2a.result.parts[0].data.reportHash).toMatch(/^0x[0-9a-f]{64}$/);

    const accept = { accept: "application/json, text/event-stream" };
    const list = await (await call("/mcp", post("/mcp", { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, accept))).json();
    const tools = list.result.tools.map((t: { name: string }) => t.name);
    expect(tools).toContain("inspect_move_out");
    // The rental-action tools from web/lib/actions come along (fetch-based RPC; not called here: no network in tests).
    expect(tools).toEqual(expect.arrayContaining(["get_lease", "prepare_fund"]));
    expect((await call("/mcp")).status).toBe(405);
    const batch = [1, 2].map((id) => ({ jsonrpc: "2.0", id, method: "tools/list", params: {} }));
    expect((await call("/mcp", post("/mcp", batch, accept))).status).toBe(400);
    expect((await call("/inspect", post("/inspect", { deposit: "x" }))).status).toBe(400);
    expect((await call("/nope")).status).toBe(404);
  });

  it("signs as agent #2921 only with the registered key, and says so when the key does not match", async () => {
    const env = { INSPECTOR_PRIVATE_KEY: generatePrivateKey() };
    const res = await call("/health", undefined, env, "https://mismatch.example");
    expect(res.status).toBe(500);
    expect((await res.json()).detail).toMatch(new RegExp(`agent #${deployment.agentId}`));
    const key = generatePrivateKey();
    const ok = await (await call("/health", undefined, { INSPECTOR_PRIVATE_KEY: key, INSPECTOR_AGENT_ID: "5", INSPECTOR_AGENT_REGISTRY: deployment.agentRegistry }, "https://env-ids.example")).json();
    expect(ok.inspector).toMatchObject({ agentId: "5", address: privateKeyToAccount(key).address });
  });
});
