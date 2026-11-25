import { expect, test } from "@playwright/test";
import { ACTIONS } from "../lib/actions/definitions";

/**
 * The rental actions over REST against the e2e anvil (deployed + seeded by global-setup): the OpenAPI document lists
 * every action, a read and a prepare_* work on the seeded rental, and /developers documents each action.
 * Seeded rental: anvil's deterministic first lease (contracts/deployments/31337.demo.example.json).
 */
const LEASE = "0x9f1ac54BEF0DD2f6f3462EA0fa94fC62300d3a8e";
const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const RENTER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

test("GET /api/v1/openapi.json lists every action", async ({ request }) => {
  const doc = await (await request.get("/api/v1/openapi.json")).json();
  expect(doc.openapi).toBe("3.1.0");
  for (const a of ACTIONS) expect(Object.keys(doc.paths)).toContain(`/api/v1/${a.name}`);
});

test("explain_status and prepare_* answer from the chain; nothing is sent", async ({ request }) => {
  const explain = await request.get(`/api/v1/explain_status?lease=${LEASE}&viewer=${RENTER}`);
  expect(explain.status()).toBe(200);
  expect(await explain.json()).toMatchObject({ chainId: 31337, you: "renter", deposit: { where: expect.stringMatching(/escrow/) } });

  const before = await (await request.get(`/api/v1/get_lease?lease=${LEASE}`)).json();
  const prep = await request.post("/api/v1/prepare_dispute", { data: { lease: LEASE, from: RENTER } });
  expect(prep.status()).toBe(200);
  expect(await prep.json()).toMatchObject({ unsigned: true, simulation: { ok: true }, steps: [{ to: LEASE, function: "dispute()" }] });
  // Prepared, not sent: the rental is unchanged.
  expect((await (await request.get(`/api/v1/get_lease?lease=${LEASE}`)).json()).status).toBe(before.status);

  const wrong = await request.post("/api/v1/prepare_fund", { data: { lease: LEASE, from: OWNER } });
  expect(wrong.status()).toBe(409);
  expect((await wrong.json()).error).toMatch(/needs the rental to be Created|Only the renter/);
});

test("/developers documents every action with a curl example", async ({ page }) => {
  await page.goto("/developers");
  for (const a of ACTIONS) await expect(page.getByTestId(`action-${a.name}`)).toContainText(`/api/v1/${a.name}`);
});
