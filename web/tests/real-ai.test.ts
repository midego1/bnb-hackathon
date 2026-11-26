import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaseSnapshot } from "@/lib/actions/lease";
import { sha256Hex } from "@/lib/server/hash";
import { MemoryState, getSharedState } from "@/lib/server/state";

// The real-model paths with a mocked Anthropic API (a stubbed global fetch): never a real call, never a key.
// Writes to scooter memory need an on-chain rental check; here no lease is ever a rental (no RPC).
vi.mock("@/lib/server/settlement/lease", async (orig) => ({ ...(await orig<object>()), leaseMemoryKey: async () => null }));

const { POST: settle } = await import("@/app/api/settlement/route");
const { POST: upload } = await import("@/app/api/evidence/route");
const { proposeSettlement, SettlementRequestSchema, visionProviderFromEnv } = await import("@/lib/server/settlement");
const { StateEvidenceStore } = await import("@/lib/server/evidence");
const { ClaudeModel, ModelError } = await import("@/lib/assistant/model");
const { assistantDeps } = await import("@/lib/server/assistant");

const ORIGIN = "http://localhost";
const VERDICT = { tenantRefund: 80, landlordClaim: 20, reasons: ["Left side panel scratched: repaint 20 USDT"], confidence: 0.8 };

type Call = { url: string; body: Record<string, unknown> };
let calls: Call[] = [];
/** What the fake Anthropic API answers next. */
let reply: () => Response = () => message(VERDICT);

function message(verdict: unknown, stop_reason = "end_turn") {
  return Response.json({
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content: [{ type: "text", text: JSON.stringify(verdict) }],
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 0 },
  });
}

/** An Anthropic error response; x-should-retry: false so the SDK does not back off and retry in tests. */
function apiError(status: number, type: string, msg: string) {
  return Response.json({ type: "error", error: { type, message: msg } }, { status, headers: { "x-should-retry": "false" } });
}

const walkthrough = (file: string) => readFile(path.join(process.cwd(), "public/demo/walkthrough", file));

/** The stub behind global fetch: Anthropic is faked; the route reads the static demo photos from public/ itself. */
async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input);
  if (url.startsWith("https://api.anthropic.com/")) {
    calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
    return reply();
  }
  if (url.startsWith(`${ORIGIN}/api/settlement`)) return settle(new NextRequest(url, init as never));
  return new Response("not found", { status: 404 });
}

let ip = 0;
function post(body: unknown) {
  return settle(
    new NextRequest(`${ORIGIN}/api/settlement`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-forwarded-for": `10.1.0.${++ip}` } }),
  );
}

const images = (c: Call) =>
  ((c.body.messages as { content: { type: string; source?: { type: string; data?: string; url?: string } }[] }[])[0].content).filter((b) => b.type === "image");

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "keyescrow-real-ai-"));
  process.env.EVIDENCE_DIR = dir;
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
  calls = [];
  reply = () => message(VERDICT);
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.SETTLEMENT_DAILY_CALLS;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("vision model choice", () => {
  it("is Sonnet 5.5 by default, Haiku 5.5 via env, never anything else", () => {
    expect(visionProviderFromEnv({ ANTHROPIC_API_KEY: "k" })?.model).toBe("claude-sonnet-5-5");
    expect(visionProviderFromEnv({ ANTHROPIC_API_KEY: "k", VISION_LLM_MODEL: "claude-haiku-5-5" })?.model).toBe("claude-haiku-5-5");
    expect(visionProviderFromEnv({ ANTHROPIC_API_KEY: "k", VISION_LLM_MODEL: "claude-opus-5-5" })?.model).toBe("claude-sonnet-5-5");
  });
});

describe("/demo: static walkthrough photos by url", () => {
  it("fetches same-origin photos as bytes, caches the system prompt, and says which model answered", async () => {
    const bytes = await walkthrough("checkin-front.png");
    const hash = sha256Hex(bytes); // what the demo anchored; not in this server's evidence store
    const photo = { hash, label: "Front", url: `${ORIGIN}/demo/walkthrough/checkin-front.png` };
    const res = await post({ deposit: "100000000", checkIn: [photo], checkOut: [photo] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ mock: false, provider: "anthropic", model: "claude-sonnet-5-5", landlordClaim: "20000000" });
    expect(body.fallback).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].body.model).toBe("claude-sonnet-5-5");
    expect(calls[0].body.system).toEqual([expect.objectContaining({ type: "text", cache_control: { type: "ephemeral" } })]);
    expect(images(calls[0]).map((b) => b.source)).toEqual([
      { type: "base64", media_type: "image/png", data: Buffer.from(bytes).toString("base64") },
      { type: "base64", media_type: "image/png", data: Buffer.from(bytes).toString("base64") },
    ]);
  });

  it("matches the host the browser used, not request.url (OpenNext on a Worker may report localhost)", async () => {
    const url = "http://127.0.0.1:8787/demo/walkthrough/checkin-front.png";
    const res = await settle(
      new NextRequest(`${ORIGIN}/api/settlement`, {
        method: "POST",
        body: JSON.stringify({ deposit: "100000000", checkIn: [{ url }], checkOut: [{ url }] }),
        headers: { host: "127.0.0.1:8787", "x-forwarded-for": `10.4.0.${++ip}` },
      }),
    );
    expect(await res.json()).toMatchObject({ mock: false });
    expect(images(calls[0])[0].source).toMatchObject({ type: "base64", media_type: "image/png" });
  });

  it("does not trust a same-origin url whose bytes do not match the photo's hash: demo inspector, labelled", async () => {
    const photo = { hash: `0x${"ab".repeat(32)}`, url: `${ORIGIN}/demo/walkthrough/checkin-front.png` };
    const body = await (await post({ deposit: "100000000", checkIn: [photo], checkOut: [photo] })).json();
    expect(body).toMatchObject({ mock: true, provider: "mock", fallback: "photos" });
    expect(calls).toHaveLength(0);
  });

  it("a 'same-origin' url is only ever a static file: no network fetch to the Host, no path outside public/", async () => {
    const evil = (url: string) =>
      settle(
        new NextRequest(`http://169.254.169.254/api/settlement`, {
          method: "POST",
          body: JSON.stringify({ deposit: "100000000", checkIn: [{ url }], checkOut: [{ url }] }),
          headers: { "x-forwarded-for": `10.3.0.${++ip}` },
        }),
      );
    expect(await (await evil("http://169.254.169.254/latest/meta-data")).json()).toMatchObject({ mock: true, fallback: "photos" });
    expect(await (await evil("http://169.254.169.254/demo/..%2F..%2Fpackage.json")).json()).toMatchObject({ mock: true, fallback: "photos" });
    expect(vi.mocked(fetch).mock.calls.map(([u]) => String(u)).filter((u) => u.includes("169.254"))).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("never fetches a foreign url itself (it goes to the model as a url)", async () => {
    await post({ deposit: "100000000", checkIn: [{ url: "https://example.com/a.jpg" }], checkOut: [{ url: "https://example.com/b.jpg" }] });
    expect(vi.mocked(fetch).mock.calls.map(([u]) => String(u)).filter((u) => u.includes("example.com"))).toEqual([]);
    expect(images(calls[0]).map((b) => b.source)).toEqual([
      { type: "url", url: "https://example.com/a.jpg" },
      { type: "url", url: "https://example.com/b.jpg" },
    ]);
  });
});

describe("/stage and /r: photos in the Durable Object store", () => {
  it("reads the bytes from SharedState", async () => {
    const state = new MemoryState();
    const store = new StateEvidenceStore(() => state);
    const bytes = new Uint8Array(await walkthrough("checkout-front.png"));
    const hash = sha256Hex(bytes);
    await store.put(hash, bytes, "image/png");
    const r = await proposeSettlement(SettlementRequestSchema.parse({ deposit: "100000000", checkIn: [{ hash }], checkOut: [{ hash }] }), {
      provider: visionProviderFromEnv(),
      store,
    });
    expect(r).toMatchObject({ mock: false, model: "claude-sonnet-5-5" });
    expect(images(calls[0])[0].source).toMatchObject({ type: "base64", media_type: "image/png" });
  });

  it("falls back, labelled, when the photo expired from the store", async () => {
    const r = await proposeSettlement(SettlementRequestSchema.parse({ deposit: "100000000", checkIn: [{ hash: `0x${"01".repeat(32)}` }], checkOut: [{ hash: `0x${"02".repeat(32)}` }] }), {
      provider: visionProviderFromEnv(),
      store: new StateEvidenceStore(() => new MemoryState()),
    });
    expect(r).toMatchObject({ mock: true, fallback: "photos" });
    expect(BigInt(r.tenantRefund) + BigInt(r.landlordClaim)).toBe(BigInt(100000000));
  });
});

describe("iOS app: POST /api/evidence, then POST /api/settlement with the hashes", () => {
  it("the model gets the uploaded bytes", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    const form = new FormData();
    form.append("file", new File([jpeg], "photo-1.jpg", { type: "image/jpeg" }));
    const up = await (await upload(new NextRequest(`${ORIGIN}/api/evidence`, { method: "POST", body: form }))).json();
    const hash = up.items[0].hash;
    const body = await (await post({ deposit: "100000000", checkIn: [{ hash }], checkOut: [{ hash }] })).json();
    expect(body.mock).toBe(false);
    expect(images(calls[0])[0].source).toEqual({ type: "base64", media_type: "image/jpeg", data: Buffer.from(jpeg).toString("base64") });
  });

  it("an upload that failed (hash computed on the phone only) gets the demo inspector, labelled, not an error", async () => {
    const res = await post({ deposit: "100000000", checkIn: [{ hash: `0x${"cd".repeat(32)}` }], checkOut: [{ hash: `0x${"ef".repeat(32)}` }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mock: true, fallback: "photos" });
  });
});

describe("fallback when Anthropic cannot answer", () => {
  const photo = async () => {
    const bytes = await walkthrough("checkin-left-side.png");
    return { hash: sha256Hex(bytes), url: `${ORIGIN}/demo/walkthrough/checkin-left-side.png` };
  };

  it.each([
    ["429 rate limit", () => apiError(429, "rate_limit_error", "rate limited")],
    ["529 overloaded", () => apiError(529, "overloaded_error", "Overloaded")],
    ["500 api error", () => apiError(500, "api_error", "Internal error")],
    ["400 out of credit", () => apiError(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API.")],
    ["402 billing", () => apiError(402, "billing_error", "Billing problem")],
  ])("%s: the demo inspector answers, labelled busy", async (_name, err) => {
    reply = err;
    const p = await photo();
    const res = await post({ deposit: "100000000", checkIn: [p], checkOut: [p] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ mock: true, provider: "mock", fallback: "busy" });
    expect(body.model).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("a stand-in verdict is never written to the scooter's memory", async () => {
    reply = () => apiError(529, "overloaded_error", "Overloaded");
    const remember = vi.fn(async () => ({ stored: true }));
    const memory = { status: { provider: "local" as const, configured: false }, recall: async () => [], remember };
    const r = await proposeSettlement(SettlementRequestSchema.parse({ deposit: "100000000", checkIn: [await photo()], checkOut: [await photo()] }), {
      provider: visionProviderFromEnv(),
      photoSource: { host: "localhost", fetch: async (u) => new Response(new Uint8Array(await walkthrough(u.split("/").pop()!))) },
      memory,
      rememberAs: { scooterId: "BKK-1", rental: "0x9f1ac54bef0dd2f6f3462ea0fa94fc62300d3a8e" },
    });
    expect(r).toMatchObject({ mock: true, fallback: "busy", memoryStored: false });
    expect(remember).not.toHaveBeenCalled();
  });

  it("a refusal or unusable answer: labelled error", async () => {
    reply = () => message({}, "refusal");
    const p = await photo();
    expect(await (await post({ deposit: "100000000", checkIn: [p], checkOut: [p] })).json()).toMatchObject({ mock: true, fallback: "error" });
  });

  it("never logs the key or the photos", async () => {
    reply = () => apiError(429, "rate_limit_error", "rate limited");
    const p = await photo();
    await post({ deposit: "100000000", checkIn: [p], checkOut: [p] });
    reply = () => message(VERDICT);
    await post({ deposit: "100000000", checkIn: [p], checkOut: [p] });
    const logged = JSON.stringify([...vi.mocked(console.log).mock.calls, ...vi.mocked(console.warn).mock.calls]);
    expect(logged).toContain("in=1200 out=80");
    expect(logged).not.toContain("test-key-not-real");
    expect(logged).not.toContain(p.hash);
    expect(logged).not.toContain("scratched");
  });
});

describe("cost caps", () => {
  it("SETTLEMENT_DAILY_CALLS: over it the demo inspector answers without calling the model", async () => {
    const used = (await getSharedState().get<number[]>("rate:settlement:all"))?.value.length ?? 0;
    process.env.SETTLEMENT_DAILY_CALLS = String(used + 1);
    const p = { url: `${ORIGIN}/demo/walkthrough/checkout-front.png` };
    expect(await (await post({ deposit: "100000000", checkIn: [p], checkOut: [p] })).json()).toMatchObject({ mock: false });
    expect(await (await post({ deposit: "100000000", checkIn: [p], checkOut: [p] })).json()).toMatchObject({ mock: true, fallback: "limit" });
    expect(calls).toHaveLength(1);
  });

  it("keeps the per-IP limit (429, counted before the daily cap)", async () => {
    const used = (await getSharedState().get<number[]>("rate:settlement:all"))?.value.length ?? 0;
    const req = () =>
      settle(new NextRequest(`${ORIGIN}/api/settlement`, { method: "POST", body: JSON.stringify({ deposit: "10", checkIn: [{ url: `${ORIGIN}/demo/walkthrough/checkin-front.png` }], checkOut: [{ url: `${ORIGIN}/demo/walkthrough/checkin-front.png` }] }), headers: { "x-forwarded-for": "10.9.9.9" } }));
    for (let i = 0; i < 10; i++) expect((await req()).status).toBe(200);
    expect((await req()).status).toBe(429);
    expect((await getSharedState().get<number[]>("rate:settlement:all"))?.value.length).toBe(used + 10);
  });
});

describe("Ask AI", () => {
  const step = (m: InstanceType<typeof ClaudeModel>) =>
    m.step({ system: "s", tools: [], messages: [{ role: "user", content: "hi" }], maxTokens: 100, signal: new AbortController().signal, onText: () => {} });

  it.each([
    ["429", () => apiError(429, "rate_limit_error", "rate limited")],
    ["529", () => apiError(529, "overloaded_error", "Overloaded")],
    ["credit", () => apiError(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API.")],
  ])("%s -> 'AI is busy, try again'", async (_name, err) => {
    reply = err;
    const e = await step(new ClaudeModel("test-key-not-real", "claude-sonnet-5-5")).catch((x) => x);
    expect(e).toBeInstanceOf(ModelError);
    expect(e).toMatchObject({ code: "busy", message: "AI is busy, try again." });
  });

  it("answers on Sonnet 5.5 with a cached system prompt", async () => {
    const sse = [
      ["message_start", { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 50, output_tokens: 1 } } }],
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } }],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } }],
      ["message_stop", { type: "message_stop" }],
    ]
      .map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`)
      .join("");
    reply = () => new Response(sse, { headers: { "content-type": "text/event-stream" } });
    const r = await step(new ClaudeModel("test-key-not-real", "claude-sonnet-5-5"));
    expect(r.content).toEqual([expect.objectContaining({ type: "text", text: "Hello" })]);
    expect(calls[0].body).toMatchObject({ model: "claude-sonnet-5-5", system: [{ cache_control: { type: "ephemeral" } }] });
  });

  it("inspect_return gets the real model through POST /api/settlement, or the labelled demo inspector", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]);
    const form = new FormData();
    form.append("file", new File([bytes], "p.jpg"));
    const hash = (await (await upload(new NextRequest(`${ORIGIN}/api/evidence`, { method: "POST", body: form }))).json()).items[0].hash;
    const deps = assistantDeps(new Request(`${ORIGIN}/api/assistant`, { headers: { "x-forwarded-for": "10.2.0.1" } }));
    const lease = {
      address: "0x9f1ac54bef0dd2f6f3462ea0fa94fc62300d3a8e",
      chainId: 31337,
      terms: { depositAmount: BigInt(100000000) },
      checkInHash: hash,
      checkOutHash: hash,
    } as unknown as LeaseSnapshot;
    expect(await deps.inspect!(lease)).toMatchObject({ mock: false, model: "claude-sonnet-5-5" });
    reply = () => apiError(529, "overloaded_error", "Overloaded");
    expect(await deps.inspect!(lease)).toMatchObject({ mock: true, fallback: "busy" });
  });
});

describe("UI label: who answered", () => {
  it("names the model, or the demo inspector and why", async () => {
    const { answeredBy } = await import("@/lib/settlement");
    const { stateFor } = await import("@/lib/i18n/server");
    const { makeT } = await import("@/lib/i18n/t");
    const t = makeT(stateFor("en"));
    expect(answeredBy({ mock: false, provider: "anthropic", model: "claude-sonnet-5-5" }, t)).toBe("checked by claude-sonnet-5-5");
    expect(answeredBy({ mock: true, provider: "mock", fallback: "busy" }, t)).toBe("demo inspector stood in: AI is busy, try again later");
    expect(answeredBy({ mock: true, provider: "mock" }, t)).toBe("demo inspector (no AI key configured)");
  });
});
