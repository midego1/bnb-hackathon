import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ACTIONS } from "@/lib/actions/definitions";
import { landingCopy } from "@/components/marketing/copy";
import { LED_CHARS, LED_COLS, LED_ROWS, ledDots } from "@/components/marketing/led";
import { REPO_URL } from "@/lib/links";
import {
  ARBITER_DAYS,
  baht,
  CONTRACT_TESTS,
  EXAMPLE,
  FEE_PERCENT,
  FLEET_OPERATOR_FEE_PERCENT,
  INSPECTOR_AGENT,
  INSPECTOR_TOOLS,
  OWNER_RESPONSE_DAYS,
  RENT_PERIOD_DAYS,
  rentPer,
  TESTNET_CONTRACTS,
  TESTS_URL,
} from "@/lib/marketing";

/** The marketing page may only state what the repo backs up: these compare its facts with their sources. */
const repo = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => readFileSync(path.join(repo, file), "utf8");
const deployment = JSON.parse(read("contracts/deployments/97.json"));
const agent = JSON.parse(read("agent/deployments/97.json"));

describe("marketing page facts", () => {
  it("lists the contracts of contracts/deployments/97.json", () => {
    const byName = Object.fromEntries(TESTNET_CONTRACTS.map((c) => [c.name, c.address]));
    expect(deployment.chainId).toBe(97);
    expect(byName).toEqual({
      EscrowFactory: deployment.escrowFactory,
      RentalEscrow: deployment.rentalEscrowImplementation,
      FleetVault: deployment.fleetVault,
      MockUSDT: deployment.token,
    });
  });

  it("names the inspector agent registered in agent/deployments/97.json", () => {
    expect(agent.chainId).toBe(97);
    expect(INSPECTOR_AGENT).toEqual({ id: agent.agentId, registry: agent.identityRegistry, registerTx: agent.registerTx });
  });

  it("quotes the deployed fee, operator fee and the contract's default deadlines", () => {
    expect(FEE_PERCENT).toBe(deployment.feeBps / 100);
    expect(FLEET_OPERATOR_FEE_PERCENT).toBe(deployment.fleetOperatorFeeBps / 100);
    const factory = read("contracts/src/EscrowFactory.sol");
    expect(factory).toContain(`DEFAULT_RESPONSE_WINDOW = ${OWNER_RESPONSE_DAYS} days`);
    expect(factory).toContain(`DEFAULT_ARBITER_WINDOW = ${ARBITER_DAYS} days`);
  });

  it("uses a worked example that adds up", () => {
    expect(EXAMPLE.deposit).toBe(2 * EXAMPLE.rent);
    expect(EXAMPLE.funded).toBe(EXAMPLE.deposit + EXAMPLE.rent);
    expect(EXAMPLE.fee).toBe((EXAMPLE.rent * FEE_PERCENT) / 100);
    expect(EXAMPLE.firstPayout).toBe(EXAMPLE.rent - EXAMPLE.fee);
  });

  it("uses a damage ending that is the example proposal (30 of 200 mUSDT to the owner) on the example deposit", () => {
    expect(EXAMPLE.claim + EXAMPLE.refund).toBe(EXAMPLE.deposit);
    expect(EXAMPLE.claim / EXAMPLE.deposit).toBe(30 / 200);
    expect(landingCopy.en.inspection.code).toContain('"landlordClaim": "30.00"');
    expect(landingCopy.en.inspection.code).toContain('"tenantRefund": "170.00"');
  });

  it("counts the contract tests as the README does, and links to them", () => {
    expect(read("README.md")).toContain(`${CONTRACT_TESTS} tests`);
    expect(TESTS_URL).toBe(`${REPO_URL}/tree/main/contracts/test`);
  });

  it("offers the rent rhythms the factory accepts, priced as the monthly rent x days / 30, rounded down", () => {
    const factory = read("contracts/src/EscrowFactory.sol");
    expect(factory).toContain(RENT_PERIOD_DAYS.map((d) => `rentPeriod != ${d} days`).join(" && "));
    expect(RENT_PERIOD_DAYS.map(rentPer)).toEqual([793, 1586, EXAMPLE.rent]);
    expect(landingCopy.en.shops.subs.rhythms).toHaveLength(RENT_PERIOD_DAYS.length);
  });

  it("says the mainnet pilot is planned and quotes its caps as docs/BUSINESS.md does", () => {
    const [, title, body] = landingCopy.en.roadmap.phases[1];
    expect(title).toBe("Capped BSC mainnet pilot");
    expect(body).toMatch(/^Not live yet\./);
    const business = read("docs/BUSINESS.md");
    expect(business).toContain("at most 5 USDT deposit and 2 USDT rent per period per rental, 25 USDT held in all escrows together");
    expect(body).toContain("at most 5 USDT deposit and 2 USDT rent per payment per rental, and 25 USDT in all escrows together");
  });

  it("can show every amount of the money board on its LED panel", () => {
    const e = EXAMPLE;
    for (const n of [0, e.funded, e.deposit, e.firstPayout, e.refund, e.firstPayout + e.claim]) {
      for (const ch of baht(n)) expect(LED_CHARS, `${baht(n)}: "${ch}"`).toContain(ch);
      const dots = ledDots(baht(n));
      expect(dots.length).toBeGreaterThan(20);
      for (const [x, y] of dots) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(LED_COLS);
        expect(y).toBeLessThan(LED_ROWS);
      }
    }
    // Flush right: the last column of the widest amount is the panel's last column.
    expect(Math.max(...ledDots(baht(e.funded)).map(([x]) => x))).toBe(LED_COLS - 1);
    expect(Math.min(...ledDots(baht(e.funded)).map(([x]) => x))).toBe(0);
    // Decoration never takes the page down: an unknown character is blank, an amount too wide loses its left edge.
    expect(ledDots("฿1.5").length).toBe(ledDots("฿15").length);
    expect(Math.min(...ledDots("฿1,000,000,000").map(([x]) => x))).toBe(0);
  });

  it("names inspector tools the agent really registers, next to the rental actions", () => {
    // mcp.ts registers them; the first one's name is SKILL_ID from card.ts.
    const agentSource = read("agent/src/mcp.ts") + read("agent/src/card.ts");
    for (const tool of INSPECTOR_TOOLS) expect(agentSource).toContain(`"${tool}"`);
    expect(ACTIONS.length).toBeGreaterThan(0);
    expect(new Set(ACTIONS.map((a) => a.name)).size).toBe(ACTIONS.length);
  });
});
