import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { A2AClient } from "@a2a-js/sdk/client";
import { AgentURIGenerator } from "@bnbagent/sdk/erc8004";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requestFromParts } from "../src/a2a.ts";
import { buildAgentCard, buildRegistrationFile, parseAgentRegistry, SKILL_ID } from "../src/card.ts";
import { loadConfig, type AgentDeployment } from "../src/config.ts";
import { inspectMoveOut, InspectionInputError } from "../src/inspect.ts";
import { INSPECT_INPUT } from "../src/mcp.ts";
import { buildApp } from "../src/server.ts";
import { ACTIONS, inspectorSignerFromKey, proposeSettlement, SettlementRequestSchema, verifyInspectorReport } from "../src/shared.ts";
import { decodeReportSigner } from "../scripts/registry.ts";
import { SAMPLE_REQUEST } from "../scripts/sample.ts";
import { listen } from "./helpers.ts";

// Throwaway test key, not used anywhere else.
const KEY = `0x${"22".repeat(32)}` as const;
const SIGNER = privateKeyToAccount(KEY).address;
const REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const AGENT_REGISTRY = `eip155:97:${REGISTRY}`;
const NOW = new Date("2026-11-25T09:00:00Z");

describe("agent card and ERC-8004 registration file", () => {
  it("advertises the inspection plus one A2A skill per rental action at /a2a", () => {
    const card = buildAgentCard("http://localhost:8790", { name: "KeyEscrow Inspector", address: SIGNER, agentId: "4", agentRegistry: AGENT_REGISTRY });
    expect(card.url).toBe("http://localhost:8790/a2a");
    expect(card.skills.map((s) => s.id)).toEqual([SKILL_ID, ...ACTIONS.map((a) => a.name)]);
    expect(card.description).toContain("ERC-8004 agent #4");
  });

  it("builds the SDK registration file with A2A + MCP services and the registry back-reference", () => {
    const file = buildRegistrationFile("https://inspector.example", { agentId: "4", identityRegistry: REGISTRY, chainId: 97 });
    expect(file.type).toBe("https://eips.ethereum.org/EIPS/eip-8004#registration-v1");
    expect(file.name).toBe("KeyEscrow Inspector");
    expect(file.services).toEqual([
      expect.objectContaining({ name: "A2A", endpoint: "https://inspector.example/.well-known/agent-card.json" }),
      expect.objectContaining({ name: "MCP", endpoint: "https://inspector.example/mcp" }),
    ]);
    expect(file.registrations).toEqual([{ agentId: 4, agentRegistry: AGENT_REGISTRY }]);
    expect(buildRegistrationFile("https://inspector.example").registrations).toEqual([]);
    // Round-trips through the SDK's data: URI encoding (what goes on chain as tokenURI).
    const b64 = AgentURIGenerator.encodeRegistrationFileToBase64(file);
    expect(AgentURIGenerator.decodeRegistrationFileFromBase64(b64)).toEqual(file);
  });

  it("MCP inspect_move_out takes every field of POST /api/settlement (zod drops unknown keys silently)", () => {
    expect(Object.keys(INSPECT_INPUT).sort()).toEqual(Object.keys(SettlementRequestSchema.shape).sort());
  });

  it("parses CAIP-10 registry references", () => {
    expect(parseAgentRegistry(AGENT_REGISTRY)).toEqual({ chainId: 97, identityRegistry: REGISTRY });
    expect(parseAgentRegistry("eip155:97:0x123")).toBeNull();
    expect(parseAgentRegistry(undefined)).toBeNull();
  });

  it("decodes reportSigner metadata as raw 20 bytes or a UTF-8 address string", () => {
    expect(decodeReportSigner(SIGNER.toLowerCase() as `0x${string}`)).toBe(SIGNER);
    expect(decodeReportSigner(`0x${Buffer.from(SIGNER).toString("hex")}`)).toBe(SIGNER);
    expect(decodeReportSigner("0x")).toBeNull();
  });
});

describe("config", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "keyescrow-agent-cfg-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const deployment = (reportSigner: string): string => {
    const file = path.join(dir, `${randomUUID()}.json`);
    const rec: Partial<AgentDeployment> = { chainId: 97, agentId: "9", agentRegistry: AGENT_REGISTRY, reportSigner: reportSigner as `0x${string}` };
    writeFileSync(file, JSON.stringify(rec));
    return file;
  };

  it("is unsigned without a key, and reads ids from env first", () => {
    expect(loadConfig({ INSPECTOR_DEPLOYMENT: "/nonexistent" }).inspector).toBeNull();
    const cfg = loadConfig({ INSPECTOR_PRIVATE_KEY: KEY, INSPECTOR_AGENT_ID: "5", INSPECTOR_AGENT_REGISTRY: AGENT_REGISTRY, AGENT_PORT: "3199" });
    expect(cfg.identitySource).toBe("env");
    expect(cfg.inspector?.identity).toMatchObject({ address: SIGNER, agentId: "5" });
    expect(cfg.publicUrl).toBe("http://127.0.0.1:3199");
  });

  it("falls back to the registration record and refuses a key that is not its reportSigner", () => {
    const cfg = loadConfig({ INSPECTOR_PRIVATE_KEY: KEY, INSPECTOR_DEPLOYMENT: deployment(SIGNER) });
    expect(cfg.identitySource).toBe("deployment");
    expect(cfg.inspector?.identity).toMatchObject({ agentId: "9", agentRegistry: AGENT_REGISTRY });
    expect(() => loadConfig({ INSPECTOR_PRIVATE_KEY: KEY, INSPECTOR_DEPLOYMENT: deployment("0x000000000000000000000000000000000000dEaD") })).toThrow(
      /lists reportSigner/,
    );
    expect(() => loadConfig({ AGENT_PORT: "99999" })).toThrow(/AGENT_PORT/);
  });
});

describe("inspect_move_out skill", () => {
  const inspector = inspectorSignerFromKey(KEY, { agentId: "4", agentRegistry: AGENT_REGISTRY });

  it("returns exactly what the web app's POST /api/settlement computes, signed by the inspector", async () => {
    const viaAgent = await inspectMoveOut(SAMPLE_REQUEST, { inspector, provider: null, now: NOW });
    const viaWeb = await proposeSettlement(SettlementRequestSchema.parse(SAMPLE_REQUEST), { inspector, now: NOW });
    expect(viaAgent).toEqual(viaWeb);
    expect(BigInt(viaAgent.tenantRefund) + BigInt(viaAgent.landlordClaim)).toBe(BigInt(SAMPLE_REQUEST.deposit));
    expect(viaAgent.reasons[0]).toMatch(/^Left side: /);
    expect((await verifyInspectorReport({ ...viaAgent })).signatureValid).toBe(true);
  });

  it("rejects invalid input with the schema's issues", async () => {
    await expect(inspectMoveOut({ deposit: "0", checkIn: [], checkOut: [] }, { inspector, provider: null })).rejects.toBeInstanceOf(InspectionInputError);
    const err = await inspectMoveOut({ ...SAMPLE_REQUEST, extra: 1 }, { inspector, provider: null }).catch((e) => e);
    expect(err.details.join(" ")).toMatch(/extra/);
  });

  it("extracts the request from A2A parts", () => {
    expect(requestFromParts([{ kind: "data", data: { skill: SKILL_ID, deposit: "1" } }])).toEqual({ ok: true, skill: SKILL_ID, body: { deposit: "1" } });
    expect(requestFromParts([{ kind: "text", text: '{"deposit":"1"}' }])).toEqual({ ok: true, skill: SKILL_ID, body: { deposit: "1" } });
    expect(requestFromParts([{ kind: "data", data: { skill: "get_lease", lease: "0x1" } }])).toEqual({ ok: true, skill: "get_lease", body: { lease: "0x1" } });
    expect(requestFromParts([{ kind: "data", data: { skill: "negotiate" } }])).toMatchObject({ ok: false });
    expect(requestFromParts([{ kind: "text", text: "inspect my flat" }])).toMatchObject({ ok: false });
    expect(requestFromParts([])).toMatchObject({ ok: false });
  });
});

describe("HTTP faces (A2A, MCP, REST) against a local server", () => {
  let url: string;
  let close: () => Promise<void>;
  let expected: Awaited<ReturnType<typeof proposeSettlement>>;

  beforeAll(async () => {
    const cfg = loadConfig({
      AGENT_PORT: "3170",
      INSPECTOR_PRIVATE_KEY: KEY,
      INSPECTOR_AGENT_ID: "4",
      INSPECTOR_AGENT_REGISTRY: AGENT_REGISTRY,
      INSPECTOR_DEPLOYMENT: "/nonexistent",
    });
    ({ url, close } = await listen(buildApp({ ...cfg }, { provider: null, now: () => NOW })));
    expected = await proposeSettlement(SettlementRequestSchema.parse(SAMPLE_REQUEST), { inspector: cfg.inspector, now: NOW });
  });
  afterAll(() => close());

  it("GET /health and the ERC-8004 registration file", async () => {
    const health = await (await fetch(`${url}/health`)).json();
    expect(health).toMatchObject({ ok: true, provider: "mock", inspector: { agentId: "4", label: "Signed by KeyEscrow Inspector, ERC-8004 agent #4" } });
    const file = await (await fetch(`${url}/.well-known/agent-registration.json`)).json();
    expect(file.registrations).toEqual([{ agentId: 4, agentRegistry: AGENT_REGISTRY }]);
  });

  it("MCP: lists the tools and runs inspect_move_out", async () => {
    const client = new Client({ name: "test", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["inspect_move_out", "inspector_identity", "verify_report", ...ACTIONS.map((a) => a.name)].sort());
    const res = await client.callTool({ name: "inspect_move_out", arguments: SAMPLE_REQUEST });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toEqual(expected);
    const verify = await client.callTool({ name: "verify_report", arguments: { report: res.structuredContent } });
    expect(verify.structuredContent).toEqual({ hashValid: true, signer: SIGNER, signatureValid: true });
    const bad = await client.callTool({ name: "inspect_move_out", arguments: { ...SAMPLE_REQUEST, deposit: "0" } });
    expect(bad.isError).toBe(true);
    expect(bad.structuredContent).toMatchObject({ error: "invalid inspection request" });
    await client.close();
  });

  it("A2A: resolves the card and answers message/send with a data part", async () => {
    const client = await A2AClient.fromCardUrl(`${url}/.well-known/agent-card.json`);
    const send = (data: Record<string, unknown>) =>
      client.sendMessage({ message: { kind: "message", role: "user", messageId: randomUUID(), parts: [{ kind: "data", data }] } });
    const res = await send({ skill: SKILL_ID, ...SAMPLE_REQUEST });
    if ("error" in res) throw new Error(JSON.stringify(res.error));
    expect(res.result.kind).toBe("message");
    const part = res.result.kind === "message" ? res.result.parts[0] : undefined;
    expect(part?.kind === "data" ? part.data : undefined).toEqual(expected);

    const wrong = await send({ skill: "negotiate" });
    if ("error" in wrong) throw new Error(JSON.stringify(wrong.error));
    const wp = wrong.result.kind === "message" ? wrong.result.parts[0] : undefined;
    expect(wp?.kind === "data" ? wp.data : undefined).toMatchObject({ status: 400, error: expect.stringMatching(/unknown skill/) });
  });

  it("REST: POST /inspect mirrors POST /api/settlement", async () => {
    const ok = await fetch(`${url}/inspect`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(SAMPLE_REQUEST) });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual(expected);
    const bad = await fetch(`${url}/inspect`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(bad.status).toBe(400);
    expect((await fetch(`${url}/mcp`)).status).toBe(405);
  });
});
