import {
  custom,
  decodeFunctionData,
  encodeErrorResult,
  encodeFunctionResult,
  getAddress,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { describe, expect, it } from "vitest";
import { ActionError, actionContext, rpcUrl, type ActionHost } from "@/lib/actions/context";
import { ACTIONS, findAction, prepareCreateLease, prepareProposeSettlement, prepareResolve, toolDescription } from "@/lib/actions/definitions";
import { explainLease } from "@/lib/actions/explain";
import { fieldError, fieldLabel, formatToken, parseTokenAmount } from "@/lib/actions/fields";
import { parseUsdt } from "@/lib/format";
import type { LeaseSnapshot } from "@/lib/actions/lease";
import { buildOpenApi } from "@/lib/actions/openapi";
import { handleActionRequest, ROUTES } from "@/lib/actions/rest";
import { parseInput, runAction } from "@/lib/actions/run";
import { decodeRevert, explainRevert } from "@/lib/actions/simulate";
import { escrowFactoryAbi, getDeployment, mockUsdtAbi, rentalEscrowAbi } from "@/lib/contracts";
import { mockQuote } from "@/lib/server/price";

const D = getDeployment(31337)!;
const LEASE = getAddress("0x9f1ac54bef0dd2f6f3462ea0fa94fc62300d3a8e");
const OWNER = getAddress("0x70997970c51812dc3a010c7d01b50e0d17dc79c8");
const RENTER = getAddress("0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc");
const DESK = getAddress("0x90f79bf6eb2c4f870365e785982e1f101e93b906");
const NOW = BigInt(1_800_000_000);
const RENT = BigInt(441_180_000);
const DEPOSIT = RENT * BigInt(2);

/** On-chain state the fake node answers from (RentalEscrow view names). */
type State = {
  status: number;
  startTime?: bigint;
  monthsFunded?: number;
  monthsReleased?: number;
  monthsDue?: number;
  proposal?: { tenantRefund: bigint; landlordClaim: bigint; reportHash: Hex; proposer: Address; proposedAt: bigint; nonce: number };
  timeoutAt?: bigint;
  arbiterDeadline?: bigint;
  allowance?: bigint;
};

type SimCall = { from: Address; to: Address; data: Hex };

/**
 * A fake JSON-RPC node: eth_call is decoded against the KeyEscrow ABIs and answered from `state`; eth_simulateV1
 * is answered by `simulate` (default: every call succeeds). Records the simulated calls.
 */
function fakeHost(state: State, simulate?: (calls: SimCall[]) => { ok: boolean; data: Hex }[]) {
  const simulated: SimCall[][] = [];
  const answer = (abi: Abi, to: Address, data: Hex): Hex => {
    const { functionName, args } = decodeFunctionData({ abi, data });
    const v = (() => {
      if (to === D.escrowFactory) {
        if (functionName === "isLease") return args![0] === LEASE;
        if (functionName === "leasesByTenant") return [LEASE];
        return [];
      }
      if (to === D.mockUsdt) return functionName === "allowance" ? (state.allowance ?? BigInt(0)) : DEPOSIT;
      const zero = { tenantRefund: BigInt(0), landlordClaim: BigInt(0), reportHash: `0x${"00".repeat(32)}`, proposer: "0x0000000000000000000000000000000000000000", proposedAt: BigInt(0), nonce: 0 };
      const views: Record<string, unknown> = {
        terms: {
          token: D.mockUsdt,
          landlord: OWNER,
          tenant: RENTER,
          arbiter: DESK,
          rentAmount: RENT,
          depositAmount: DEPOSIT,
          termMonths: 12,
          responseWindow: 7 * 86400,
          arbiterWindow: 14 * 86400,
          leaseHash: `0x${"11".repeat(32)}`,
          feeBps: 1000,
          feeRecipient: OWNER,
        },
        status: state.status,
        startTime: state.startTime ?? BigInt(0),
        monthsFunded: state.monthsFunded ?? 0,
        monthsReleased: state.monthsReleased ?? 0,
        monthsDue: state.monthsDue ?? 0,
        checkInHash: `0x${"22".repeat(32)}`,
        checkOutHash: `0x${"00".repeat(32)}`,
        proposal: state.proposal ?? zero,
        timeoutAt: state.timeoutAt ?? BigInt(0),
        arbiterDeadline: state.arbiterDeadline ?? BigInt(0),
        feeCharged: false,
        payee: OWNER,
      };
      return views[functionName];
    })();
    return encodeFunctionResult({ abi, functionName, result: v } as never);
  };
  const host: ActionHost = {
    env: { KEYESCROW_CHAIN_ID: "31337" },
    prices: async () => mockQuote(new Date("2026-11-25T00:00:00Z")),
    transport: () =>
      custom({
        async request({ method, params }) {
          if (method === "eth_chainId") return "0x7a69";
          if (method === "eth_getBlockByNumber") return { number: "0x10", timestamp: `0x${NOW.toString(16)}`, hash: `0x${"ab".repeat(32)}`, transactions: [] };
          if (method === "eth_call") {
            const { to, data } = (params as [{ to: Address; data: Hex }])[0];
            const t = getAddress(to);
            const abi = (t === D.escrowFactory ? escrowFactoryAbi : t === D.mockUsdt ? mockUsdtAbi : rentalEscrowAbi) as Abi;
            return answer(abi, t, data);
          }
          if (method === "eth_simulateV1") {
            const calls = (params as [{ blockStateCalls: [{ calls: SimCall[] }] }])[0].blockStateCalls[0].calls;
            simulated.push(calls);
            const results = simulate?.(calls) ?? calls.map(() => ({ ok: true, data: "0x" as Hex }));
            return [
              {
                number: "0x11",
                timestamp: `0x${(NOW + BigInt(1)).toString(16)}`,
                hash: `0x${"cd".repeat(32)}`,
                transactions: [],
                calls: results.map((r) => ({ status: r.ok ? "0x1" : "0x0", returnData: r.data, gasUsed: "0x5208", logs: [] })),
              },
            ];
          }
          throw new Error(`fake node: unexpected ${method}`);
        },
      }),
  };
  return { host, simulated };
}

const decodeStep = (abi: Abi, data: Hex) => decodeFunctionData({ abi, data });

describe("action definitions", () => {
  it("are uniquely named, snake_case, and every example passes its own schema", () => {
    const names = ACTIONS.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
    for (const a of ACTIONS) {
      expect(a.name).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(a.kind === "prepare").toBe(a.name.startsWith("prepare_"));
      expect(a.description.length).toBeGreaterThan(60);
      expect(() => parseInput(a, a.example), a.name).not.toThrow();
      expect(toolDescription(a)).toContain("Who:");
    }
  });

  it("validates inputs with plain messages", () => {
    const s = prepareCreateLease.input;
    expect(fieldError(s, "renter", "0x123")).toMatch(/Not a valid address/);
    expect(fieldError(s, "renter", RENTER.toLowerCase())).toBeUndefined();
    expect(fieldError(s, "rent", "abc")).toMatch(/positive amount/);
    expect(fieldError(s, "rent", "18,000")).toBeUndefined();
    expect(fieldError(s, "termMonths", "0")).toBe("1 to 60.");
    expect(fieldError(s, "termMonths", 61)).toBe("1 to 60.");
    expect(fieldError(s, "responseWindowDays", 7)).toBeUndefined();
    expect(fieldError(s, "arbiterWindowDays", 91)).toBe("1 to 90.");
    expect(fieldError(prepareResolve.input, "toRenter", "1.1234567")).toMatch(/at most 6 decimals/);
    // Optional fields still validate a present value (the web forms rely on this).
    expect(fieldError(s, "deposit", "")).toMatch(/positive amount/);
    expect(fieldError(prepareProposeSettlement.input, "toRenter", "abc")).toMatch(/Enter an amount in mUSDT/);
    expect(fieldLabel(s, "termMonths")).toBe("Term");
    expect(fieldLabel(s, "payee")).toBe("Payout address");

    const both = { from: OWNER, renter: RENTER, rent: "100", deposit: "200", depositMonths: 2, termMonths: 12 };
    expect(() => parseInput(prepareCreateLease, both)).toThrow(/either `deposit` or `depositMonths`/);
    expect(() => parseInput(prepareCreateLease, { ...both, extra: 1 })).toThrow(ActionError);
    const ok = parseInput(prepareCreateLease, { from: OWNER.toLowerCase(), renter: RENTER, rent: 18000, depositMonths: "2", termMonths: "12" });
    expect(ok).toMatchObject({ from: OWNER, currency: "THB", depositMonths: 2, termMonths: 12, responseWindowDays: 7, arbiterWindowDays: 14 });
    expect(() => parseInput(prepareProposeSettlement, { lease: LEASE, from: RENTER })).toThrow(/either `toRenter` or `inspection`/);
  });

  it("parses and formats token amounts in mUSDT base units", () => {
    expect(parseTokenAmount("441.18")).toBe(RENT);
    expect(parseTokenAmount("1,000")).toBe(BigInt(1_000_000_000));
    expect(parseTokenAmount("1.0000001")).toBeUndefined();
    expect(parseTokenAmount("-1")).toBeUndefined();
    expect(formatToken(DEPOSIT)).toBe("882.36 mUSDT");
    expect(formatToken(BigInt(44_118_000))).toBe("44.118 mUSDT");
    // The panels send parseUsdt's value after fieldError said OK: both must read "1 000" the same way.
    expect(parseUsdt("1 000")).toBe(BigInt(1_000_000_000));
    expect(parseUsdt("")).toBeUndefined();
  });

  it("picks the server RPC per chain (PublicNode for 97)", () => {
    expect(rpcUrl(97, {})).toBe("https://bsc-testnet-rpc.publicnode.com");
    expect(rpcUrl(97, { KEYESCROW_RPC_URL_97: "https://x" })).toBe("https://x");
    expect(rpcUrl(31337, {})).toBe("http://127.0.0.1:8545");
    expect(actionContext({ env: {} }, 97).deployment.escrowFactory).toBe(getDeployment(97)!.escrowFactory);
    expect(() => actionContext({ env: {} }, 56)).toThrow(/not supported/);
  });
});

describe("prepare_* calldata against the ABI", () => {
  it("prepare_create_lease converts baht and encodes createLease for the factory", async () => {
    const { host, simulated } = fakeHost({ status: 0 });
    const r = (await runAction("prepare_create_lease", { from: OWNER, renter: RENTER, rent: "18000", currency: "THB", depositMonths: 2, termMonths: 12 }, host)) as {
      steps: { to: Address; data: Hex; value: string }[];
      summary: string;
      unsigned: boolean;
    };
    expect(r.unsigned).toBe(true);
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0].to).toBe(D.escrowFactory);
    expect(r.steps[0].value).toBe("0");
    const { functionName, args } = decodeStep(escrowFactoryAbi, r.steps[0].data);
    expect(functionName).toBe("createLease");
    // 18,000 THB at the mock 33 THB/USDT = 545.45 mUSDT; deposit = 2 months exactly.
    expect(args![0]).toMatchObject({
      tenant: RENTER,
      arbiter: "0x0000000000000000000000000000000000000000",
      rentAmount: BigInt(545_450_000),
      depositAmount: BigInt(1_090_900_000),
      termMonths: 12,
      responseWindow: 7 * 86400,
      arbiterWindow: 14 * 86400,
    });
    expect(r.summary).toMatch(/545\.45 mUSDT a month .*demo rate/);
    expect(simulated[0][0]).toMatchObject({ from: OWNER, to: D.escrowFactory, data: r.steps[0].data });

    // Optional payee (e.g. a Fleet Vault): same params, routed through createLeaseWithPayee.
    const vault = getDeployment(31337)!.fleetVault!;
    const withPayee = (await runAction("prepare_create_lease", { from: OWNER, renter: RENTER, rent: "100", currency: "USDT", depositMonths: 1, termMonths: 3, payee: vault }, host)) as { steps: { data: Hex }[] };
    const decoded = decodeStep(escrowFactoryAbi, withPayee.steps[0].data);
    expect(decoded.functionName).toBe("createLeaseWithPayee");
    expect(decoded.args![1]).toBe(vault);
  });

  it("prepare_fund approves exactly deposit + first rent, then funds, simulated as one sequence", async () => {
    const { host, simulated } = fakeHost({ status: 0 });
    const r = (await runAction("prepare_fund", { lease: LEASE, from: RENTER }, host)) as { steps: { to: Address; data: Hex }[] };
    expect(r.steps.map((s) => s.to)).toEqual([D.mockUsdt, LEASE]);
    expect(decodeStep(mockUsdtAbi, r.steps[0].data)).toEqual({ functionName: "approve", args: [LEASE, DEPOSIT + RENT] });
    expect(decodeStep(rentalEscrowAbi, r.steps[1].data).functionName).toBe("fund");
    expect(simulated[0]).toHaveLength(2);

    const approved = fakeHost({ status: 0, allowance: DEPOSIT + RENT });
    const r2 = (await runAction("prepare_fund", { lease: LEASE, from: RENTER }, approved.host)) as { steps: unknown[] };
    expect(r2.steps).toHaveLength(1);
  });

  it("prepare_propose_settlement takes the AI inspection result as is", async () => {
    const { host } = fakeHost({ status: 1, startTime: NOW, monthsFunded: 1, monthsDue: 1 });
    const reportHash = `0x${"ef".repeat(32)}` as Hex;
    const r = (await runAction(
      "prepare_propose_settlement",
      { lease: LEASE, from: RENTER, inspection: { tenantRefund: "800000000", landlordClaim: "82360000", reportHash, deposit: DEPOSIT.toString(), reasons: ["x"] } },
      host,
    )) as { steps: { data: Hex }[]; summary: string };
    expect(decodeStep(rentalEscrowAbi, r.steps[0].data)).toEqual({ functionName: "propose", args: [BigInt(800_000_000), reportHash] });
    expect(r.summary).toContain("from the AI inspection");

    await expect(
      runAction("prepare_propose_settlement", { lease: LEASE, from: RENTER, inspection: { tenantRefund: "1", reportHash, deposit: "5" } }, host),
    ).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/deposit of 0.000005 mUSDT/) });
    await expect(runAction("prepare_propose_settlement", { lease: LEASE, from: RENTER, toRenter: "900" }, host)).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/more than the deposit/),
    });
  });

  it("prepare_accept pins the current nonce; prepare_claim_timeout picks the right function", async () => {
    const p = { tenantRefund: BigInt(1), landlordClaim: DEPOSIT - BigInt(1), reportHash: `0x${"01".repeat(32)}` as Hex, proposer: RENTER, proposedAt: NOW - BigInt(10), nonce: 3 };
    const moveOut = fakeHost({ status: 2, proposal: p, timeoutAt: NOW + BigInt(100) });
    const acc = (await runAction("prepare_accept", { lease: LEASE, from: OWNER }, moveOut.host)) as { steps: { data: Hex }[] };
    expect(decodeStep(rentalEscrowAbi, acc.steps[0].data)).toEqual({ functionName: "accept", args: [3] });
    const to = (await runAction("prepare_claim_timeout", { lease: LEASE, from: OWNER }, moveOut.host)) as { steps: { data: Hex }[] };
    expect(decodeStep(rentalEscrowAbi, to.steps[0].data).functionName).toBe("claimTimeout");

    const disputed = fakeHost({ status: 3, proposal: p, arbiterDeadline: NOW - BigInt(1) });
    const arb = (await runAction("prepare_claim_timeout", { lease: LEASE, from: RENTER }, disputed.host)) as { steps: { data: Hex }[] };
    expect(decodeStep(rentalEscrowAbi, arb.steps[0].data).functionName).toBe("claimArbiterTimeout");
  });
});

describe("preconditions and simulation errors come back as plain reasons", () => {
  it("checks status and role before simulating", async () => {
    const { host, simulated } = fakeHost({ status: 1 });
    await expect(runAction("prepare_fund", { lease: LEASE, from: RENTER }, host)).rejects.toMatchObject({
      status: 409,
      code: "precondition_failed",
      message: "prepare_fund needs the rental to be Created; it is Active.",
    });
    await expect(runAction("prepare_dispute", { lease: LEASE, from: DESK }, host)).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/Only the owner .* or the renter .*; 0x90F7.* is the dispute desk/),
    });
    await expect(runAction("get_lease", { lease: OWNER }, host)).rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(simulated).toHaveLength(0);
  });

  it("refuses propose / accept / dispute without a dry-run once the reply window has closed", async () => {
    const deadline = NOW - BigInt(1);
    const proposal = { tenantRefund: DEPOSIT, landlordClaim: BigInt(0), reportHash: `0x${"33".repeat(32)}` as Hex, proposer: RENTER, proposedAt: deadline - BigInt(7 * 86400), nonce: 1 };
    const { host, simulated } = fakeHost({ status: 2, proposal, timeoutAt: deadline });
    for (const [name, extra] of [["prepare_accept", {}], ["prepare_dispute", {}], ["prepare_propose_settlement", { toRenter: "10" }]] as const) {
      await expect(runAction(name, { lease: LEASE, from: OWNER, ...extra }, host)).rejects.toMatchObject({
        status: 409,
        code: "precondition_failed",
        message: expect.stringMatching(/7-day response window closed on .*renter can now claim the full deposit\. Use prepare_claim_timeout/),
      });
    }
    expect(simulated).toHaveLength(0);
    await expect(runAction("prepare_claim_timeout", { lease: LEASE, from: RENTER }, host)).resolves.toBeTruthy();
  });

  it("maps a reverting step to its decoded custom error", async () => {
    const revert = encodeErrorResult({ abi: escrowFactoryAbi, errorName: "RolesNotDistinct" });
    const { host } = fakeHost({ status: 0 }, () => [{ ok: false, data: revert }]);
    const err = (await runAction("prepare_create_lease", { from: OWNER, renter: OWNER, rent: "100", currency: "USDT", depositMonths: 1, termMonths: 1 }, host).catch((e: unknown) => e)) as ActionError;
    expect(err).toBeInstanceOf(ActionError);
    expect(err.status).toBe(422);
    expect(err.code).toBe("simulation_reverted");
    expect(err.message).toMatch(/^Step 1 \(Create the rental offer\) would fail: .*three different addresses/);
    expect(err.details).toMatchObject({ step: 1, errorName: "RolesNotDistinct", function: expect.stringMatching(/^createLease\(/) });
  });

  it("explains errors with their arguments", () => {
    const deadline = BigInt(1_800_000_000);
    const data = encodeErrorResult({ abi: rentalEscrowAbi, errorName: "TimeoutNotReached", args: [deadline] });
    expect(decodeRevert(data).reason).toBe("The deadline has not been reached yet: it opens at 2027-01-15T08:00:00.000Z.");
    expect(explainRevert("InvalidStatus", [4])).toMatch(/status Settled/);
    const closed = encodeErrorResult({ abi: rentalEscrowAbi, errorName: "ResponseWindowClosed", args: [deadline] });
    expect(decodeRevert(closed).reason).toMatch(/reply window closed at 2027-01-15T08:00:00.000Z.*prepare_claim_timeout/);
    expect(explainRevert("ERC20InsufficientBalance", [RENTER, BigInt(1_000_000), BigInt(2_000_000)])).toMatch(/has 1.00 mUSDT, this needs 2.00 mUSDT/);
    expect(decodeRevert("0xdeadbeef").reason).toMatch(/would fail/);
  });
});

describe("explain_status", () => {
  const base = (over: Partial<LeaseSnapshot>): LeaseSnapshot => ({
    address: LEASE,
    chainId: 31337,
    status: "Active",
    terms: { token: D.mockUsdt, owner: OWNER, renter: RENTER, arbiter: DESK, rentAmount: RENT, depositAmount: DEPOSIT, termMonths: 12, responseWindow: 604800, arbiterWindow: 1209600, leaseHash: `0x${"00".repeat(32)}`, feeBps: 1000, feeRecipient: OWNER },
    startTime: NOW,
    monthsFunded: 1,
    monthsReleased: 0,
    monthsDue: 1,
    checkInHash: `0x${"00".repeat(32)}`,
    checkOutHash: `0x${"00".repeat(32)}`,
    proposal: { tenantRefund: BigInt(0), landlordClaim: BigInt(0), reportHash: `0x${"00".repeat(32)}`, proposer: "0x0000000000000000000000000000000000000000", proposedAt: BigInt(0), nonce: 0 },
    timeoutAt: BigInt(0),
    arbiterDeadline: BigInt(0),
    feeCharged: false,
    payee: OWNER,
    balance: DEPOSIT + RENT,
    chainNow: NOW,
    ...over,
  });

  it("says who holds the deposit and who must act by when", () => {
    const disputed = explainLease(base({ status: "Disputed", arbiterDeadline: NOW + BigInt(3 * 86400) }), RENTER);
    expect(disputed.you).toBe("renter");
    expect(disputed.deposit.where).toMatch(/Held in escrow/);
    expect(disputed.next).toEqual([expect.objectContaining({ who: "arbiter", action: "prepare_resolve", when: "before", deadline: "2027-01-18T08:00:00.000Z" })]);
    expect(disputed.text).toMatch(/in 3 days/);

    const late = explainLease(base({ status: "Disputed", arbiterDeadline: NOW - BigInt(60) }));
    expect(late.next[0]).toMatchObject({ who: "anyone", action: "prepare_claim_timeout", when: "from" });

    const moveOut = explainLease(
      base({ status: "MoveOut", proposal: { tenantRefund: DEPOSIT, landlordClaim: BigInt(0), reportHash: `0x${"00".repeat(32)}`, proposer: RENTER, proposedAt: NOW, nonce: 1 }, timeoutAt: NOW + BigInt(604800) }),
      OWNER,
    );
    expect(moveOut.headline).toMatch(/the renter proposed 882.36 mUSDT back to the renter/);
    expect(moveOut.next.map((n) => n.action)).toContain("prepare_accept");
    expect(moveOut.text).toMatch(/The owner must answer by .* or the full deposit goes back to the renter/);

    expect(explainLease(base({ status: "Created", startTime: BigInt(0) }), OWNER).next.map((n) => n.action)).toEqual(["prepare_fund", "prepare_cancel"]);
    expect(explainLease(base({ status: "Settled", balance: BigInt(0) })).next).toEqual([]);
  });
});

describe("REST + OpenAPI are generated from the definitions", () => {
  it("has one route and one OpenAPI operation per action, with the right method", () => {
    const doc = buildOpenApi();
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toHaveLength(ACTIONS.length);
    for (const a of ACTIONS) {
      const method = a.kind === "read" ? "get" : "post";
      const op = (doc.paths[`/api/v1/${a.name}`] as Record<string, { operationId: string; description: string }>)[method];
      expect(op?.operationId, a.name).toBe(a.name);
      expect(op.description).toBe(toolDescription(a));
      expect(ROUTES).toContainEqual({ action: a.name, method: method.toUpperCase(), path: `/api/v1/${a.name}` });
    }
    const create = (doc.paths["/api/v1/prepare_create_lease"] as { post: { requestBody: { content: { "application/json": { schema: { properties: Record<string, { "x-unit"?: string }>; required: string[] } } } } } }).post;
    const schema = create.requestBody.content["application/json"].schema;
    expect(schema.required).toEqual(expect.arrayContaining(["from", "renter", "rent", "termMonths"]));
    expect(schema.properties.termMonths["x-unit"]).toBe("months");
    const get = (doc.paths["/api/v1/get_lease"] as { get: { parameters: { name: string; required: boolean }[] } }).get;
    expect(get.parameters).toEqual(expect.arrayContaining([expect.objectContaining({ name: "lease", required: true })]));
  });

  it("serves actions over standard Request/Response with consistent errors", async () => {
    const { host } = fakeHost({ status: 1, startTime: NOW, monthsFunded: 1, monthsDue: 1 });
    const call = (method: string, path: string, body?: unknown) =>
      handleActionRequest(new Request(`http://x/api/v1/${path}`, { method, ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) }), path.split("?")[0], host);

    const ok = await call("GET", `explain_status?lease=${LEASE}&viewer=${RENTER}`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ status: "Active", you: "renter", depositFiat: { THB: expect.stringContaining("฿"), mock: true } });

    const q = await (await call("GET", "quote?amount=3300&currency=THB")).json();
    expect(q).toMatchObject({ mUSDT: { units: "100000000", display: "100.00 mUSDT" }, mock: true });

    expect((await call("POST", "explain_status", {})).status).toBe(405);
    expect((await call("GET", "nope")).status).toBe(404);
    const bad = await call("POST", "prepare_dispute", { lease: "0x1", from: RENTER });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: "invalid_input", details: [expect.objectContaining({ path: "lease" })] });
    const notJson = await handleActionRequest(new Request("http://x/api/v1/prepare_dispute", { method: "POST", body: "{" }), "prepare_dispute", host);
    expect(notJson.status).toBe(400);
    const prepared = await call("POST", "prepare_dispute", { lease: LEASE, from: RENTER });
    expect(prepared.status).toBe(200);
    expect(await prepared.json()).toMatchObject({ chainId: 31337, from: RENTER, unsigned: true, steps: [expect.objectContaining({ to: LEASE, value: "0", function: "dispute()" })] });
    expect(findAction("prepare_dispute")).toBeDefined();
  });
});
