import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { A2AClient } from "@a2a-js/sdk/client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.ts";
import { inspectMoveOut, InspectionInputError } from "../src/inspect.ts";
import { buildApp } from "../src/server.ts";
import { SKILL_ID } from "../src/card.ts";
import { SAMPLE_REQUEST } from "../scripts/sample.ts";
import { listen } from "./helpers.ts";

// The agent's public faces (A2A, MCP, REST) read scooter memory but never write it: only the web app does, for a
// rental it verified on-chain.
const REQUEST = { ...SAMPLE_REQUEST, scooterId: "BKK-123" };
const EARLIER = { scooterId: "BKK-123", at: "2026-11-01T00:00:00Z", findings: ["left mirror scratched (minor)"], newDamage: true };

describe("agent inspection memory is read-only", () => {
  it("inspectMoveOut recalls but never calls remember, and takes no rental", async () => {
    const memory = {
      status: { provider: "local" as const, configured: false },
      recall: vi.fn(async () => [{ text: "Scooter BKK-123: left mirror scratched", source: "local" as const }]),
      remember: vi.fn(async () => ({ stored: true })),
    };
    const r = await inspectMoveOut(REQUEST, { inspector: null, provider: null, memory });
    expect(memory.recall).toHaveBeenCalledWith("BKK-123");
    expect(memory.remember).not.toHaveBeenCalled();
    expect(r.memory?.recalled).toEqual(["Scooter BKK-123: left mirror scratched"]);
    expect(r.memoryStored).toBe(false);
    await expect(inspectMoveOut({ ...REQUEST, lease: "0x9f1ac54BEF0DD2f6f3462EA0fa94fC62300d3a8e" }, { inspector: null, provider: null, memory })).rejects.toBeInstanceOf(
      InspectionInputError,
    );
    expect(memory.remember).not.toHaveBeenCalled();
  });

  describe("over MCP and A2A, with the Node memory (local file)", () => {
    let dir: string;
    let file: string;
    let url: string;
    let close: () => Promise<void>;
    const prev = process.env.SPONSOR_LOG_DIR;

    beforeAll(async () => {
      dir = mkdtempSync(path.join(tmpdir(), "keyescrow-agent-mem-"));
      process.env.SPONSOR_LOG_DIR = dir;
      file = path.join(dir, "inspections.jsonl");
      writeFileSync(file, `${JSON.stringify(EARLIER)}\n`);
      ({ url, close } = await listen(buildApp(loadConfig({ AGENT_PORT: "3190", INSPECTOR_DEPLOYMENT: "/nonexistent" }), { provider: null, actions: null }), 3190));
    });
    afterAll(async () => {
      await close();
      if (prev === undefined) delete process.env.SPONSOR_LOG_DIR;
      else process.env.SPONSOR_LOG_DIR = prev;
      rmSync(dir, { recursive: true, force: true });
    });

    it("MCP inspect_move_out recalls the scooter's history and writes nothing", async () => {
      const client = new Client({ name: "test", version: "0" });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));
      const res = await client.callTool({ name: "inspect_move_out", arguments: REQUEST });
      await client.close();
      expect(res.isError).toBeFalsy();
      expect(res.structuredContent).toMatchObject({ memory: { scooterId: "BKK-123", recalled: [expect.stringContaining("left mirror")] }, memoryStored: false });
      expect(readFileSync(file, "utf8")).toBe(`${JSON.stringify(EARLIER)}\n`);
    });

    it("A2A inspect_move_out writes nothing", async () => {
      const client = await A2AClient.fromCardUrl(`${url}/.well-known/agent-card.json`);
      const res = await client.sendMessage({ message: { kind: "message", role: "user", messageId: randomUUID(), parts: [{ kind: "data", data: { skill: SKILL_ID, ...REQUEST } }] } });
      if ("error" in res) throw new Error(JSON.stringify(res.error));
      const part = res.result.kind === "message" ? res.result.parts[0] : undefined;
      expect(part?.kind === "data" ? part.data : undefined).toMatchObject({ memoryStored: false });
      expect(readFileSync(file, "utf8")).toBe(`${JSON.stringify(EARLIER)}\n`);
    });
  });
});
