import { describe, expect, it } from "vitest";
import { deskRuling, ledger, newContext, PROPERTIES, stepsFor } from "@/lib/demo/script";

const U = BigInt(1_000_000);

describe("guided demo script", () => {
  it("prices a fresh scooter rental in baht: two months' deposit, cycling through the scooters", () => {
    const c = newContext("happy", 0, 33);
    expect(c.property).toBe(PROPERTIES[0]);
    expect(c.rent).toBe(BigInt(103_030_000)); // ฿3,400 / 33 = 103.03 mUSDT
    expect(c.deposit).toBe(c.rent * BigInt(2));
    expect(newContext("happy", 1, 33).property).toBe(PROPERTIES[1]);
    expect(newContext("happy", 3, undefined).property).toBe(PROPERTIES[0]); // falls back to 33 THB/USDT
  });

  it("has one ending per path, always closing with the final balances", () => {
    const ids = (p: Parameters<typeof stepsFor>[0]) => stepsFor(p).map((s) => s.id);
    expect(ids("happy").slice(-2)).toEqual(["accept", "final"]);
    expect(ids("dispute").slice(-3)).toEqual(["dispute", "resolve", "final"]);
    expect(ids("timeout").slice(-3)).toEqual(["wait", "timeout", "final"]);
    expect(ids("fleet").slice(-3)).toEqual(["accept", "vault", "final"]);
    // Only the timeout path bends time, and it says so.
    expect(stepsFor("happy").some((s) => s.demoOnly)).toBe(false);
    expect(stepsFor("timeout").find((s) => s.id === "wait")?.demoOnly).toMatch(/demo only/);
  });

  it("the dispute desk rules half again the AI estimate in whole mUSDT, never more than the deposit", () => {
    const c = newContext("dispute", 0, 33);
    c.inspection = { landlordClaim: (BigInt(37) * U).toString() } as never;
    expect(deskRuling(c)).toEqual({ landlordClaim: BigInt(55) * U, tenantRefund: c.deposit - BigInt(55) * U });
    c.inspection = { landlordClaim: c.deposit.toString() } as never;
    expect(deskRuling(c).landlordClaim).toBe(c.deposit);
  });

  it("the ledger balances only when everything paid in went somewhere and the escrow is empty", () => {
    const c = newContext("happy", 0, 33);
    const paidIn = c.deposit + c.rent;
    c.before = { tenant: BigInt(1_000) * U, landlord: BigInt(0), treasury: BigInt(0), escrow: BigInt(0), vault: BigInt(0) };
    c.after = { tenant: c.before.tenant - paidIn + BigInt(170) * U, landlord: paidIn - BigInt(180) * U, treasury: BigInt(10) * U, escrow: BigInt(0), vault: BigInt(0) };
    expect(ledger(c)).toMatchObject({ paidIn, tenantBack: BigInt(170) * U, treasury: BigInt(10) * U, balanced: true });
    // Fleet Vault path: the owner's cut lands in the vault and still counts on the owner's side.
    expect(ledger({ ...c, after: { ...c.after, landlord: BigInt(0), vault: paidIn - BigInt(180) * U } })?.balanced).toBe(true);
    // The shared treasury wallet also received another rental's fee in the same window: this rental's own fee counts.
    expect(ledger({ ...c, fee: BigInt(10) * U, after: { ...c.after, treasury: BigInt(20) * U } })).toMatchObject({ treasury: BigInt(10) * U, balanced: true });
    c.after = { ...c.after, escrow: BigInt(1) };
    expect(ledger(c)?.balanced).toBe(false);
  });
});
