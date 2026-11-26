import { NextRequest } from "next/server";
import { getAddress, type Address, type Hex } from "viem";
import { describe, expect, it, vi } from "vitest";
import { findAction, walletHistory as walletHistoryAction } from "@/lib/actions/definitions";
import { runAction } from "@/lib/actions/run";
import type { ChainEvent } from "@/lib/rentals";
import { rememberSettlement, recordAiClaim, walletHistory } from "@/lib/server/history";
import { MemoryState } from "@/lib/server/state";
import { livingBrainConfig } from "@/lib/server/sponsors/livingbrain";
import { LivingBrainWalletMemory, walletMemoryFromEnv, type WalletMemory, type WalletMemoryEntry } from "@/lib/server/sponsors/walletMemory";
import { ARBITER_TIMEOUT_BASIS, factsSummary, LANDLORD_TIMEOUT_BASIS, settledSentence, walletFacts } from "@/lib/walletHistory";
import { summarizeRentals } from "@/lib/rentals";

// Dispute memory per wallet: the facts fold, the Living Brain capture writer and reader (mocked fetch: never the real
// API), and the wallet_history action.

const A = (n: number) => getAddress(`0x${n.toString(16).padStart(40, "0")}`);
const H = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const RENTER = A(0xaa);
const OWNER = A(0xbb);
const OTHER = A(0xcc);
const DESK = A(0xdd);
const FACTORY = A(0xf0);
const U = BigInt(1_000_000); // 6-decimal token
const DAY = 86_400;
const MONTH = 30 * DAY;
const T0 = BigInt(1_700_000_000);

let block = BigInt(1);
let tx = 1;
function ev(address: Address, name: string, args: Record<string, unknown>, at: bigint): ChainEvent {
  return { address, name, args, txHash: H(tx++), blockNumber: block++, logIndex: 0, timestamp: at };
}

/** A funded 3-month rental of 100 rent / 500 deposit, created by `landlord` for `tenant`. */
function rental(lease: Address, landlord: Address, tenant: Address, start = T0) {
  return [
    ev(FACTORY, "LeaseCreated", { escrow: lease, landlord, tenant, arbiter: DESK, rentAmount: BigInt(100) * U, depositAmount: BigInt(500) * U, termPeriods: 3, rentPeriod: MONTH, responseWindow: 7 * DAY, arbiterWindow: 14 * DAY, leaseHash: H(0) }, start - BigInt(10)),
    ev(lease, "Funded", { tenant, deposit: BigInt(500) * U, firstRent: BigInt(100) * U, startTime: start }, start),
  ];
}
const settled = (lease: Address, refund: bigint, basis: Hex, at: bigint) =>
  ev(lease, "Settled", { tenantRefund: refund, landlordClaim: BigInt(500) * U - refund, rentToLandlord: BigInt(0), rentToTenant: BigInt(0), fee: BigInt(0), basis }, at);

const L1 = A(0x101); // renter paid month 2 on time, month 3 late; owner proposed 40%, renter disputed, desk ruled 20%
const L2 = A(0x102); // RENTER is the owner here; renter proposed, owner silent -> timeout
const L3 = A(0x103); // dispute opened by the owner, desk missed its deadline
const L4 = A(0x104); // unfunded offer: not a track record
const L5 = A(0x105); // someone else's rental
const AI_REPORT = H(0xa1);

const events: ChainEvent[] = [
  ...rental(L1, OWNER, RENTER),
  ev(L1, "RentPaid", { tenant: RENTER, periods: 1, amount: BigInt(100) * U, periodsFunded: 2 }, T0 + BigInt(MONTH - DAY)),
  ev(L1, "RentPaid", { tenant: RENTER, periods: 1, amount: BigInt(100) * U, periodsFunded: 3 }, T0 + BigInt(2 * MONTH + 3 * DAY)),
  ev(L1, "SettlementProposed", { proposer: RENTER, nonce: 1, tenantRefund: BigInt(500) * U, landlordClaim: BigInt(0), reportHash: H(0x51) }, T0 + BigInt(80 * DAY)),
  ev(L1, "SettlementProposed", { proposer: OWNER, nonce: 2, tenantRefund: BigInt(300) * U, landlordClaim: BigInt(200) * U, reportHash: AI_REPORT }, T0 + BigInt(81 * DAY)),
  ev(L1, "DisputeRaised", { by: RENTER }, T0 + BigInt(82 * DAY)),
  settled(L1, BigInt(400) * U, H(0x77), T0 + BigInt(85 * DAY)),
  ...rental(L2, RENTER, OTHER),
  ev(L2, "SettlementProposed", { proposer: OTHER, nonce: 1, tenantRefund: BigInt(500) * U, landlordClaim: BigInt(0), reportHash: H(0x52) }, T0 + BigInt(10 * DAY)),
  settled(L2, BigInt(500) * U, LANDLORD_TIMEOUT_BASIS, T0 + BigInt(20 * DAY)),
  ...rental(L3, OWNER, RENTER),
  // Disputed in month 3 with only the first month paid: 2 periods due but unpaid.
  ev(L3, "DisputeRaised", { by: OWNER }, T0 + BigInt(65 * DAY)),
  settled(L3, BigInt(500) * U, ARBITER_TIMEOUT_BASIS, T0 + BigInt(80 * DAY)),
  rental(L4, OWNER, RENTER)[0],
  ...rental(L5, OWNER, OTHER),
];
const NOW = T0 + BigInt(100 * DAY);
const aiClaims = { [L1.toLowerCase()]: [{ reportHash: AI_REPORT, landlordClaim: String(BigInt(100) * U), deposit: String(BigInt(500) * U), mock: false, at: "2026-11-20T00:00:00Z" }] };

describe("walletFacts: exact numbers from the chain index", () => {
  it("counts rentals, settlements, disputes, rent timing, claims and timeouts per role", () => {
    const f = walletFacts(events, RENTER, NOW, aiClaims);
    // L1 + L3 as renter (L4 unfunded is skipped), L2 as owner.
    expect(f.asRenter).toEqual({ rentals: 2, settled: 2, disputes: 2, rentOnTime: 3, rentLate: 1, rentUnpaid: 2, depositSettled: BigInt(1000) * U, depositBack: BigInt(900) * U });
    expect(f.asOwner).toEqual({ rentals: 1, settled: 1, disputes: 0, depositSettled: BigInt(500) * U, depositKept: BigInt(0), repliesMissed: 1 });
    expect(f.disputes).toEqual([
      expect.objectContaining({ lease: L1, as: "renter", openedBy: "renter", outcome: "ruled", toRenter: BigInt(400) * U, toOwner: BigInt(100) * U }),
      expect.objectContaining({ lease: L3, as: "renter", openedBy: "owner", outcome: "desk-late", toRenter: BigInt(500) * U }),
    ]);
    // The owner claimed 40%; the AI report behind that proposal said 20%.
    expect(f.claims).toEqual([expect.objectContaining({ lease: L1, as: "renter", ownerClaimBps: 4000, aiClaimBps: 2000, aiMock: false })]);
    expect(f.timeouts.map((x) => [x.lease, x.as, x.kind])).toEqual([
      [L2, "owner", "owner-silent"],
      [L3, "renter", "desk-late"],
    ]);
  });

  it("says when no AI proposal was recorded, and summarises without judging", () => {
    const f = walletFacts(events, RENTER, NOW);
    expect(f.claims[0].aiClaimBps).toBeUndefined();
    const text = factsSummary(f).join("\n");
    expect(text).toContain("As renter: 2 rentals, 2 settled, 2 disputes. Rent periods paid on time: 3, late: 1, due but unpaid: 2.");
    expect(text).toContain("Got back 900.00 mUSDT of 1,000.00 mUSDT in settled deposits (90%).");
    expect(text).toContain(`Dispute on rental ${L1} (as renter), opened by the renter: the dispute desk ruled 400.00 mUSDT to the renter, 100.00 mUSDT to the owner.`);
    expect(text).toContain("the owner claimed 40% of the deposit; no AI proposal recorded.");
    expect(text).toContain("Missed the reply window 1 time.");
    expect(factsSummary(walletFacts(events, DESK, NOW))).toEqual(["No funded rentals on this deployment yet."]);
  });
});

describe("settledSentence: one factual line per party", () => {
  const [r] = summarizeRentals(events.filter((e) => e.address === L1 || e.args.escrow === L1), NOW);
  it("names the outcome, amounts, rental and transaction; only wallet addresses", () => {
    const s = settledSentence(r, "renter")!;
    expect(s).toBe(
      `Wallet ${RENTER} was the renter of KeyScrow rental ${L1}: dispute opened by the renter, ruled by the dispute desk; 400.00 mUSDT of the 500.00 mUSDT deposit back to the renter, 100.00 mUSDT kept by the owner. Transaction ${r.settled!.txHash}.`,
    );
    expect(settledSentence(r, "owner")).toContain(`Wallet ${OWNER} was the owner`);
  });
  it("words the timeouts", () => {
    const [t] = summarizeRentals(events.filter((e) => e.address === L2 || e.args.escrow === L2), NOW);
    expect(settledSentence(t, "owner")).toContain("the owner did not answer the renter's return proposal in time");
  });
});

/** A WalletMemory that records writes. */
function fakeMemory(): WalletMemory & { written: WalletMemoryEntry[] } {
  const written: WalletMemoryEntry[] = [];
  return { status: { provider: "living-brain", configured: true }, written, recall: async () => [], remember: async (e) => (written.push(e), { stored: true }) };
}

describe("rememberSettlement: only verified settlements, once per transaction", () => {
  const settledAt = T0 + BigInt(85 * DAY);
  const index = (evs = events, chainNow = settledAt + BigInt(DAY)) => async () => ({ events: evs, chainNow });

  it("writes one entry per party for a settled rental, and nothing the second time", async () => {
    const memory = fakeMemory();
    const state = new MemoryState();
    expect(await rememberSettlement(L1, 31337, { memory, state, index: index() })).toEqual({ stored: 2, skipped: 0 });
    expect(memory.written.map((e) => e.wallet)).toEqual([RENTER.toLowerCase(), OWNER.toLowerCase()]);
    expect(memory.written.every((e) => e.lease === L1 && e.txHash === events.find((x) => x.name === "Settled" && x.address === L1)!.txHash)).toBe(true);
    expect(await rememberSettlement(L1, 31337, { memory, state, index: index() })).toEqual({ stored: 0, skipped: 2 });
    expect(memory.written).toHaveLength(2);
  });

  it("writes nothing for a rental that is not settled, or not a rental of this factory", async () => {
    const memory = fakeMemory();
    const open = events.filter((e) => !(e.name === "Settled" && e.address === L1));
    expect(await rememberSettlement(L1, 31337, { memory, state: new MemoryState(), index: index(open) })).toMatchObject({ stored: 0, reason: "not-settled" });
    expect(await rememberSettlement(A(0x999), 31337, { memory, state: new MemoryState(), index: index() })).toMatchObject({ stored: 0, reason: "not-a-rental" });
    expect(memory.written).toEqual([]);
  });

  it("never backfills: a settlement older than 7 days is not written", async () => {
    const memory = fakeMemory();
    expect(await rememberSettlement(L1, 31337, { memory, state: new MemoryState(), index: index(events, settledAt + BigInt(8 * DAY)) })).toMatchObject({ stored: 0, reason: "too-old" });
    expect(memory.written).toEqual([]);
  });

  it("retries a write Living Brain refused, and reports the error", async () => {
    const memory = fakeMemory();
    let fail = true;
    memory.remember = async (e) => (fail ? { stored: false, error: "Living Brain 503" } : (memory.written.push(e), { stored: true }));
    const state = new MemoryState();
    expect(await rememberSettlement(L1, 31337, { memory, state, index: index() })).toEqual({ stored: 0, skipped: 0, errors: ["Living Brain 503", "Living Brain 503"] });
    fail = false;
    expect(await rememberSettlement(L1, 31337, { memory, state, index: index() })).toEqual({ stored: 2, skipped: 0 });
  });
});

const cfg = { apiKey: "k", subjectId: "s", brainId: "keyescrow-scooters", base: "https://lb.test", missing: [], off: undefined, dailyCalls: 200, configured: true };
function lbFetch(handler: (url: string, body: Record<string, unknown>) => Response) {
  const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ url: String(url), body, headers: init?.headers as Record<string, string> });
    return handler(String(url), body);
  });
  return { f: f as unknown as typeof fetch, calls };
}

describe("Living Brain wallet memory (mocked fetch)", () => {
  it("captures under label wallet:<address> with the tx as idempotency key and the subject header", async () => {
    const { f, calls } = lbFetch(() => Response.json({ id: "src_1" }, { status: 201 }));
    const m = new LivingBrainWalletMemory(cfg, f, () => new MemoryState());
    const text = `Wallet ${RENTER} was the renter of KeyScrow rental ${L1}: settled by agreement. Transaction ${H(9)}.`;
    expect(await m.remember({ wallet: RENTER.toLowerCase(), lease: L1, txHash: H(9), text, at: "2026-11-26T00:00:00Z" })).toEqual({ stored: true });
    expect(calls[0].url).toBe("https://lb.test/v1/brains/keyescrow-scooters/captures");
    expect(calls[0].headers).toMatchObject({ "x-api-key": "k", "x-subject-id": "s" });
    expect(calls[0].body).toEqual({
      kind: "note",
      label: `wallet:${RENTER.toLowerCase()}`,
      content: text,
      bucket: "notes",
      originRef: `${H(9)}:${RENTER.toLowerCase()}`,
      source: { channel: "keyescrow", ref: H(9), label: `wallet:${RENTER.toLowerCase()}` },
    });
  });

  it("reads its own captures back from the ingest sources by id: compiled ones as Living Brain, the rest as sent", async () => {
    const state = new MemoryState();
    const w = RENTER.toLowerCase();
    const s1 = `Wallet ${w} was the renter of KeyScrow rental ${L1}: settled by agreement. Transaction ${H(9)}.`;
    const s2 = `Wallet ${w} was the renter of KeyScrow rental ${L2}: the dispute desk ruled. Transaction ${H(10)}.`;
    let n = 0;
    const { f, calls } = lbFetch((url) =>
      url.endsWith("/captures")
        ? Response.json({ id: `src_${++n}`, status: "pending" }, { status: 201 })
        : // Living Brain compiled the first capture (its page has its own title and summary), the second is still queued.
          Response.json({ items: [
            { id: "src_1", label: `wallet:${w}`, content: s1, originRef: `${H(9)}:${w}`, status: "completed", createdAt: "2026-11-26T01:00:00Z" },
            { id: "src_2", label: `wallet:${w}`, content: s2, originRef: `${H(10)}:${w}`, status: "compiling", createdAt: "2026-11-26T02:00:00Z" },
          ], total: 2, limit: 2, offset: 0 }),
    );
    const m = new LivingBrainWalletMemory(cfg, f, () => state);
    await m.remember({ wallet: w, lease: L1, txHash: H(9), text: s1, at: "2026-11-26T01:00:00Z" });
    await m.remember({ wallet: w, lease: L2, txHash: H(10), text: s2, at: "2026-11-26T02:00:00Z" });
    const got = await m.recall(RENTER);
    expect(calls[2].url).toBe("https://lb.test/v1/brains/keyescrow-scooters/sources?ids=src_1,src_2&limit=2");
    expect(got).toEqual([
      { text: s2, txHash: H(10), lease: L2, source: "sent" },
      { text: s1, txHash: H(9), lease: L1, source: "living-brain" },
    ]);
  });

  it("shows what it sent when Living Brain is unreachable, and finds older captures by label", async () => {
    const state = new MemoryState();
    const w = RENTER.toLowerCase();
    const mine = `Wallet ${w} was the renter of KeyScrow rental ${L1}: settled by agreement. Transaction ${H(9)}.`;
    const down = lbFetch((url) => (url.endsWith("/captures") ? Response.json({ id: "src_1" }, { status: 201 }) : Response.json({ message: "busy" }, { status: 503 })));
    const m = new LivingBrainWalletMemory(cfg, down.f, () => state);
    await m.remember({ wallet: w, lease: L1, txHash: H(9), text: mine, at: "2026-11-26T01:00:00Z" });
    expect(await m.recall(RENTER)).toEqual([{ text: mine, txHash: H(9), lease: L1, source: "sent" }]);

    // No copy here (captured before this server kept one): the newest sources, filtered to this wallet's label.
    const { f, calls } = lbFetch(() =>
      Response.json({ items: [
        { id: "a", label: `wallet:${w}`, content: mine, status: "completed", createdAt: "2026-11-26T01:00:00Z" },
        { id: "b", label: `wallet:${OTHER.toLowerCase()}`, content: "someone else", status: "completed" },
        { id: "c", label: "Scooter x inspection", content: "not a wallet", status: "completed" },
      ] }),
    );
    expect(await new LivingBrainWalletMemory(cfg, f, () => new MemoryState()).recall(RENTER)).toEqual([{ text: mine, txHash: H(9), lease: L1, source: "living-brain" }]);
    expect(calls[0].url).toBe("https://lb.test/v1/brains/keyescrow-scooters/sources?limit=100");
  });

  it("an error from Living Brain falls back to the facts only, labelled", async () => {
    const { f } = lbFetch(() => Response.json({ message: "rate limited" }, { status: 429 }));
    const h = await walletHistory(RENTER, 31337, { memory: new LivingBrainWalletMemory(cfg, f, () => new MemoryState()), state: new MemoryState(), index: async () => ({ events, chainNow: NOW }) });
    expect(h.facts.asRenter.rentals).toBe(2);
    expect(h.memory).toMatchObject({ provider: "living-brain", entries: [], error: "Living Brain 429: rate limited" });
    expect(h.note).toBe("The AI summarises; the dispute desk decides.");
  });

  it("walletHistory joins the AI proposals this server recorded", async () => {
    const state = new MemoryState();
    await recordAiClaim(31337, L1, aiClaims[L1.toLowerCase()][0], state);
    const h = await walletHistory(RENTER, 31337, { memory: null, state, index: async () => ({ events, chainNow: NOW }) });
    expect(h.facts.claims[0]).toMatchObject({ ownerClaimBps: 4000, aiClaimBps: 2000 });
    expect(h.memory).toBeNull();
  });
});

describe("Living Brain budget (prepaid credit)", () => {
  it("is never live in tests, CI or e2e, whatever keys are set", () => {
    const keys = { LIVING_BRAIN_API_KEY: "k", LIVING_BRAIN_SUBJECT_ID: "s", LIVING_BRAIN_BRAIN_ID: "b" };
    expect(livingBrainConfig({ ...keys }).configured).toBe(true);
    for (const flag of [{ CI: "true" }, { KEYESCROW_E2E: "1" }, { VITEST: "true" }]) {
      const c = livingBrainConfig({ ...keys, ...flag });
      expect(c.configured, JSON.stringify(flag)).toBe(false);
      expect(walletMemoryFromEnv({ ...keys, ...flag }).status).toMatchObject({ provider: "local", reason: expect.stringContaining("off in tests, CI and e2e") });
    }
    expect(livingBrainConfig({ ...keys }).dailyCalls).toBe(200);
    expect(livingBrainConfig({ ...keys, LIVING_BRAIN_DAILY_CALLS: "50" }).dailyCalls).toBe(50);
  });

  it("stops calling after LIVING_BRAIN_DAILY_CALLS in 24 h; the history then shows facts only, labelled", async () => {
    const { f, calls } = lbFetch(() => Response.json([]));
    const capped = { ...cfg, dailyCalls: 1 };
    // The counter is server-wide (shared state): start this test at zero.
    const { getSharedState } = await import("@/lib/server/state");
    const cur = await getSharedState().get("rate:livingbrain:calls");
    if (cur) await getSharedState().set("rate:livingbrain:calls", cur.version, null);
    const m = new LivingBrainWalletMemory(capped, f, () => new MemoryState());
    const first = await walletHistory(RENTER, 31337, { memory: m, state: new MemoryState(), index: async () => ({ events, chainNow: NOW }) });
    expect(first.memory).toMatchObject({ entries: [] });
    const second = await walletHistory(OTHER, 31337, { memory: m, state: new MemoryState(), index: async () => ({ events, chainNow: NOW }) });
    expect(second.memory).toMatchObject({ entries: [], limited: true, error: expect.stringContaining("daily limit") });
    expect(second.facts.asOwner.rentals + second.facts.asRenter.rentals).toBeGreaterThan(0);
    expect(calls).toHaveLength(1);
  });

  it("reads a wallet from Living Brain at most once per 10 minutes, and again after a new entry is written", async () => {
    const state = new MemoryState();
    const memory = fakeMemory();
    const recall = vi.fn(async () => [{ text: "x", source: "living-brain" as const }]);
    memory.recall = recall;
    const deps = { memory, state, index: async () => ({ events, chainNow: T0 + BigInt(86 * DAY) }) };
    await walletHistory(RENTER, 31337, deps);
    await walletHistory(RENTER, 31337, deps);
    expect(recall).toHaveBeenCalledTimes(1);
    await rememberSettlement(L1, 31337, deps);
    await walletHistory(RENTER, 31337, deps);
    expect(recall).toHaveBeenCalledTimes(2);
  });
});

describe("wallet_history action", () => {
  it("is a read for anyone, with a checked wallet input", () => {
    expect(findAction("wallet_history")).toBe(walletHistoryAction);
    expect(walletHistoryAction).toMatchObject({ kind: "read", roles: ["anyone"] });
    expect(walletHistoryAction.input.safeParse({ wallet: "0x1" }).success).toBe(false);
    expect(walletHistoryAction.input.safeParse(walletHistoryAction.example).success).toBe(true);
    expect(walletHistoryAction.input.safeParse({ wallet: RENTER, name: "Alice" }).success).toBe(false);
  });

  it("runs through the host's history source, and says so when the host has none", async () => {
    const history = vi.fn(async (w: Address, c: number) => ({ address: w, chainId: c }));
    expect(await runAction("wallet_history", { wallet: RENTER.toLowerCase(), chainId: "31337" }, { env: {}, history })).toEqual({ address: RENTER, chainId: 31337 });
    await expect(runAction("wallet_history", { wallet: RENTER }, { env: {} })).rejects.toThrow(/needs the KeyScrow web server/);
  });
});

describe("POST /api/history", () => {
  const post = async (body: unknown, ip: string) => {
    const { POST } = await import("@/app/api/history/route");
    return POST(new NextRequest("http://localhost/api/history", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-forwarded-for": ip } }));
  };
  it("rejects a body that names no rental", async () => {
    expect((await post({ lease: "nope" }, "10.9.0.1")).status).toBe(400);
  });
  it("over the hourly limit writes nothing and still answers 200", async () => {
    const ip = "10.9.0.2";
    const { getSharedState, hitRateLimit } = await import("@/lib/server/state");
    for (let i = 0; i < 20; i++) await hitRateLimit(getSharedState(), `wallet-memory:${ip}`, { limit: 20, windowMs: 3_600_000 });
    const res = await post({ lease: L1 }, ip);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stored: 0, skipped: 0, reason: "rate-limited" });
  });
});
