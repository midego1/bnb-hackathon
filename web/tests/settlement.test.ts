import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/settlement/route";
import { LocalEvidenceStore, storeEvidence } from "@/lib/server/evidence";
import { canonicalJson, sha256Hex } from "@/lib/server/hash";
import { proposeSettlement, SettlementRequestSchema, visionProviderFromEnv, type VisionProvider } from "@/lib/server/settlement";
import { getSharedState, hitRateLimit } from "@/lib/server/state";
import type { VisionAssessmentInput } from "@/lib/server/settlement/vision";

const h = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function request(overrides: Record<string, unknown> = {}) {
  return SettlementRequestSchema.parse({
    deposit: "500000000",
    checkIn: [{ hash: h(1) }, { hash: h(2) }, { hash: h(3) }],
    checkOut: [{ hash: h(1) }, { hash: h(4), label: "Kitchen" }, { hash: h(5) }],
    ...overrides,
  });
}

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/settlement", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
}

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "keyescrow-settle-"));
  process.env.EVIDENCE_DIR = dir;
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("mock settlement", () => {
  it("uses the mock when no key is set", () => {
    expect(visionProviderFromEnv({})).toBeNull();
    expect(visionProviderFromEnv({ VISION_LLM_PROVIDER: "mock", ANTHROPIC_API_KEY: "x" })).toBeNull();
    expect(() => visionProviderFromEnv({ VISION_LLM_PROVIDER: "other" })).toThrow();
  });

  it("selects Anthropic with a key, default model overridable (no network: constructor only)", () => {
    expect(visionProviderFromEnv({ ANTHROPIC_API_KEY: "test" })?.model).toBe("claude-opus-5-5");
    expect(visionProviderFromEnv({ ANTHROPIC_API_KEY: "test", VISION_LLM_MODEL: "claude-sonnet-5-5" })?.model).toBe("claude-sonnet-5-5");
  });

  it("is deterministic and sums to the deposit", async () => {
    const now = new Date("2026-11-25T00:00:00Z");
    const a = await proposeSettlement(request(), { now });
    const b = await proposeSettlement(request(), { now });
    expect(a).toEqual(b);
    expect(a.mock).toBe(true);
    expect(a.provider).toBe("mock");
    expect(BigInt(a.tenantRefund) + BigInt(a.landlordClaim)).toBe(BigInt(500_000_000));
    expect(BigInt(a.landlordClaim) > BigInt(0)).toBe(true);
    expect(a.reasons.some((r) => r.startsWith("Kitchen: "))).toBe(true);
    expect(a.confidence).toBeGreaterThan(0);
    expect(a.confidence).toBeLessThanOrEqual(1);
  });

  it("refunds in full when check-out matches check-in", async () => {
    const r = await proposeSettlement(request({ checkOut: [{ hash: h(1) }, { hash: h(2) }, { hash: h(3) }] }));
    expect(r.landlordClaim).toBe("0");
    expect(r.tenantRefund).toBe("500000000");
  });

  it("reportHash is the sha256 of the canonical report", async () => {
    const r = await proposeSettlement(request());
    const { reportHash, ...rest } = r;
    expect(reportHash).toBe(sha256Hex(canonicalJson(rest)));
    expect(reportHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("never claims more than 60% of the deposit", async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ hash: h(100 + i) }));
    const r = await proposeSettlement(request({ checkOut: many }));
    expect(BigInt(r.landlordClaim)).toBeLessThanOrEqual(BigInt(300_000_000));
  });
});

describe("live provider path (fake provider, no network)", () => {
  it("repairs a fenced, over-claiming model response", async () => {
    const seen: VisionAssessmentInput[] = [];
    const fake: VisionProvider = {
      name: "fake",
      model: "fake-1",
      async assess(input) {
        seen.push(input);
        return '```json\n{"tenantRefund": 10, "landlordClaim": 9000, "reasons": ["Broken window"], "confidence": 90}\n```';
      },
    };
    const r = await proposeSettlement(request({ checkIn: [{ url: "https://example.com/a.jpg" }], checkOut: [{ url: "https://example.com/b.jpg" }] }), {
      provider: fake,
    });
    expect(seen[0].deposit).toBe("500");
    expect(seen[0].checkIn[0]).toEqual({ kind: "url", url: "https://example.com/a.jpg", label: undefined });
    expect(r.mock).toBe(false);
    expect(r.model).toBe("fake-1");
    expect(r.landlordClaim).toBe("500000000");
    expect(r.tenantRefund).toBe("0");
    expect(r.confidence).toBe(0.9);
    expect(r.repairs.length).toBeGreaterThan(0);
  });

  it("resolves photo hashes from the evidence store as base64", async () => {
    const store = new LocalEvidenceStore(dir);
    const rec = await storeEvidence(store, PNG, "in.png");
    let got: VisionAssessmentInput | undefined;
    const fake: VisionProvider = {
      name: "fake",
      model: "fake-1",
      async assess(input) {
        got = input;
        return { tenantRefund: 500, landlordClaim: 0, reasons: ["Clean"], confidence: 0.95 };
      },
    };
    await proposeSettlement(request({ checkIn: [{ hash: rec.hash }], checkOut: [{ hash: rec.hash }] }), { provider: fake, store });
    expect(got?.checkIn[0]).toMatchObject({ kind: "base64", mediaType: "image/png", data: Buffer.from(PNG).toString("base64") });
  });
});

describe("POST /api/settlement", () => {
  it("returns a mock proposal", async () => {
    const res = await post({ deposit: "1000000000", checkIn: [{ hash: h(1) }], checkOut: [{ hash: h(9) }] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mock).toBe(true);
    expect(BigInt(body.tenantRefund) + BigInt(body.landlordClaim)).toBe(BigInt(1_000_000_000));
    expect(body.decimals).toBe(6);
    expect(body.currency).toBe("USDT");
    // Notes steer the model, so they are inside the hashed (and signed) report.
    const noted = await (await post({ deposit: "1000000000", checkIn: [{ hash: h(1) }], checkOut: [{ hash: h(9) }], notes: "renter admits a scratch" })).json();
    expect(noted.notes).toBe("renter admits a scratch");
  });

  it("rejects invalid input", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post({ deposit: "0", checkIn: [{ hash: h(1) }], checkOut: [{ hash: h(1) }] })).status).toBe(400);
    expect((await post({ deposit: "10", checkIn: [], checkOut: [{ hash: h(1) }] })).status).toBe(400);
    expect((await post({ deposit: "10", checkIn: [{}], checkOut: [{ hash: h(1) }] })).status).toBe(400);
    expect((await post({ deposit: "10", checkIn: [{ hash: "0x12" }], checkOut: [{ hash: h(1) }] })).status).toBe(400);
    expect((await post({ deposit: "1.5", checkIn: [{ hash: h(1) }], checkOut: [{ hash: h(1) }] })).status).toBe(400);
    expect((await post({ deposit: "10", checkIn: [{ url: "file:///etc/passwd" }], checkOut: [{ hash: h(1) }] })).status).toBe(400);
    const res = await post({ deposit: "10", checkIn: [{ hash: h(1) }], checkOut: [{ hash: h(1) }], extra: true });
    expect(res.status).toBe(400);
    expect((await res.json()).details).toBeInstanceOf(Array);
  });

  it("limits live (paid) inspections per caller IP, before calling the model", async () => {
    for (let i = 0; i < 10; i++) await hitRateLimit(getSharedState(), "settlement:local", { limit: 10, windowMs: 3_600_000 });
    process.env.ANTHROPIC_API_KEY = "test";
    try {
      expect((await post({ deposit: "10", checkIn: [{ hash: h(1) }], checkOut: [{ hash: h(2) }] })).status).toBe(429);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
    // The mock costs nothing and stays unlimited.
    expect((await post({ deposit: "10", checkIn: [{ hash: h(1) }], checkOut: [{ hash: h(2) }] })).status).toBe(200);
  });
});
