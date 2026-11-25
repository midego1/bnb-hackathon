import { NextRequest } from "next/server";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/settlement/route";
import { canonicalJson, sha256Hex } from "@/lib/server/hash";
import {
  inspectorFromEnv,
  inspectorLabel,
  inspectorSignerFromKey,
  proposeSettlement,
  SettlementRequestSchema,
  verifyInspectorReport,
} from "@/lib/server/settlement";

// Throwaway test key, not used anywhere else.
const KEY = `0x${"11".repeat(32)}` as const;
const ADDRESS = privateKeyToAccount(KEY).address;
const REGISTRY = "eip155:97:0x8004A818BFB912233c491871b3d84c89A494BD9e";
const h = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const now = new Date("2026-11-25T00:00:00Z");
const req = SettlementRequestSchema.parse({
  deposit: "500000000",
  checkIn: [{ hash: h(1) }],
  checkOut: [{ hash: h(1) }, { hash: h(2), label: "Kitchen" }],
});

afterEach(() => {
  delete process.env.INSPECTOR_PRIVATE_KEY;
  delete process.env.INSPECTOR_AGENT_ID;
  delete process.env.INSPECTOR_AGENT_REGISTRY;
});

describe("inspector identity", () => {
  it("is off without INSPECTOR_PRIVATE_KEY, and reports stay exactly as before", async () => {
    expect(inspectorFromEnv({})).toBeNull();
    const r = await proposeSettlement(req, { now, inspector: null });
    expect(r).not.toHaveProperty("inspector");
    expect(r).not.toHaveProperty("inspectorSignature");
    const { reportHash, ...body } = r;
    expect(reportHash).toBe(sha256Hex(canonicalJson(body)));
  });

  it("reads the identity from env and validates it", () => {
    const s = inspectorFromEnv({ INSPECTOR_PRIVATE_KEY: KEY, INSPECTOR_AGENT_ID: "7", INSPECTOR_AGENT_REGISTRY: REGISTRY });
    expect(s?.identity).toEqual({ name: "KeyEscrow Inspector", address: ADDRESS, agentId: "7", agentRegistry: REGISTRY });
    expect(inspectorLabel(s!.identity)).toBe("Signed by KeyEscrow Inspector, ERC-8004 agent #7");
    expect(inspectorLabel({ name: "KeyEscrow Inspector", address: ADDRESS })).toBe("Signed by KeyEscrow Inspector");
    expect(() => inspectorFromEnv({ INSPECTOR_PRIVATE_KEY: "0x1234" })).toThrow(/64 hex/);
    expect(() => inspectorFromEnv({ INSPECTOR_PRIVATE_KEY: KEY, INSPECTOR_AGENT_ID: "-1" })).toThrow(/AGENT_ID/);
    expect(() => inspectorFromEnv({ INSPECTOR_PRIVATE_KEY: KEY, INSPECTOR_AGENT_REGISTRY: "0xabc" })).toThrow(/REGISTRY/);
  });

  it("commits the identity into reportHash and signs the hash", async () => {
    const signer = inspectorSignerFromKey(KEY, { agentId: "7", agentRegistry: REGISTRY });
    const r = await proposeSettlement(req, { now, inspector: signer });
    expect(r.inspector).toEqual(signer.identity);
    const { reportHash, inspectorSignature, ...body } = r;
    expect(reportHash).toBe(sha256Hex(canonicalJson(body)));
    expect(inspectorSignature).toMatch(/^0x[0-9a-f]{130}$/);

    // A different agent id gives a different hash: the on-chain proposal pins the agent.
    const other = await proposeSettlement(req, { now, inspector: inspectorSignerFromKey(KEY, { agentId: "8", agentRegistry: REGISTRY }) });
    expect(other.reportHash).not.toBe(reportHash);
    expect(other.tenantRefund).toBe(r.tenantRefund);

    expect(await verifyInspectorReport(r as unknown as Record<string, unknown>)).toEqual({
      hashValid: true,
      signer: ADDRESS,
      signatureValid: true,
    });
  });

  it("detects tampering and foreign signatures", async () => {
    const r = await proposeSettlement(req, { now, inspector: inspectorSignerFromKey(KEY, { agentId: "7" }) });
    const tampered = { ...r, tenantRefund: r.deposit, landlordClaim: "0" };
    expect((await verifyInspectorReport(tampered)).hashValid).toBe(false);

    const impostor = { ...r, inspector: { ...r.inspector!, address: "0x000000000000000000000000000000000000dEaD" } };
    expect((await verifyInspectorReport(impostor)).signatureValid).toBe(false);

    const unsigned = await proposeSettlement(req, { now });
    expect(await verifyInspectorReport(unsigned as unknown as Record<string, unknown>)).toMatchObject({ hashValid: true, signatureValid: false });
  });

  it("POST /api/settlement signs when the inspector is configured", async () => {
    process.env.INSPECTOR_PRIVATE_KEY = KEY;
    process.env.INSPECTOR_AGENT_ID = "3";
    process.env.INSPECTOR_AGENT_REGISTRY = REGISTRY;
    const res = await POST(
      new NextRequest("http://localhost/api/settlement", {
        method: "POST",
        body: JSON.stringify({ deposit: "500000000", checkIn: [{ hash: h(1) }], checkOut: [{ hash: h(1) }] }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.inspector).toMatchObject({ agentId: "3", address: ADDRESS });
    expect((await verifyInspectorReport(body)).signatureValid).toBe(true);
  });
});
