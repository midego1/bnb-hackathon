import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ACTIONS } from "@/lib/actions/definitions";
import { ARBITER_DAYS, EXAMPLE, FEE_PERCENT, FLEET_OPERATOR_FEE_PERCENT, INSPECTOR_AGENT, INSPECTOR_TOOLS, OWNER_RESPONSE_DAYS, TESTNET_CONTRACTS } from "@/lib/marketing";

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

  it("names inspector tools the agent really registers, next to the rental actions", () => {
    // mcp.ts registers them; the first one's name is SKILL_ID from card.ts.
    const agentSource = read("agent/src/mcp.ts") + read("agent/src/card.ts");
    for (const tool of INSPECTOR_TOOLS) expect(agentSource).toContain(`"${tool}"`);
    expect(ACTIONS.length).toBeGreaterThan(0);
    expect(new Set(ACTIONS.map((a) => a.name)).size).toBe(ACTIONS.length);
  });
});
