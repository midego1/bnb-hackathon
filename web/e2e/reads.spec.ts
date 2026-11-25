import { expect, test, type Page } from "@playwright/test";
import { createPublicClient, http, type Address } from "viem";
import { escrowFactoryAbi, rentalEscrowAbi } from "../lib/contracts/abis.generated";
import { E2E_DEPLOYMENT, E2E_RPC_URL } from "./env";

/**
 * Chain reads of the back office and the Fleet owner dashboard: no eth_getLogs from the browser (rentals come from the
 * server-side chain index, GET /api/chain/index), no console errors or failed requests, counts equal to what the
 * contracts say, and a clear retry state when the index cannot be read.
 */

const chain = createPublicClient({ transport: http(E2E_RPC_URL) });
const factory = E2E_DEPLOYMENT.escrowFactory as Address;
const LANDLORD = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address; // anvil #1, the seeded fleet owner

function watch(page: Page) {
  const problems: string[] = [];
  const rpc: Record<string, number> = {};
  let indexReads = 0;
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("response", (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`));
  page.on("request", (r) => {
    if (r.url().includes("/api/chain/index")) indexReads++;
    if (r.method() !== "POST" || !r.url().startsWith(E2E_RPC_URL)) return;
    try {
      const body = JSON.parse(r.postData() ?? "null");
      for (const c of Array.isArray(body) ? body : [body]) if (c?.method) rpc[c.method] = (rpc[c.method] ?? 0) + 1;
    } catch {}
  });
  return { problems, rpc, indexReads: () => indexReads };
}

async function landlordCounts() {
  const leases = await chain.readContract({ address: factory, abi: escrowFactoryAbi, functionName: "leasesByLandlord", args: [LANDLORD] });
  const statuses = await Promise.all(leases.map((a) => chain.readContract({ address: a, abi: rentalEscrowAbi, functionName: "status" })));
  return { active: statuses.filter((s) => s === 1 || s === 2).length, disputes: statuses.filter((s) => s === 3).length };
}

test("back office: every rental from one server read, no browser eth_getLogs, no errors", async ({ page }) => {
  const w = watch(page);
  await page.goto("/backoffice");
  const rows = page.getByTestId("rental-row");
  await expect(rows.first()).toBeVisible();
  // Other specs may create rentals meanwhile: compare against the factory until both agree.
  await expect
    .poll(async () => (await rows.count()) === Number(await chain.readContract({ address: factory, abi: escrowFactoryAbi, functionName: "leaseCount" })), { timeout: 30_000 })
    .toBe(true);
  await expect(page.getByTestId("kpi-rentals")).toHaveText(new RegExp(`^Rentals\\s*${await rows.count()}$`));
  await expect(page.getByTestId("activity-feed").getByTestId("tx-event").first()).toBeVisible();
  await expect(page.getByTestId("vault-panel").locator('[data-event="Transfer"]').first()).toBeVisible();
  expect(w.indexReads()).toBeGreaterThanOrEqual(1);
  expect(w.rpc.eth_getLogs ?? 0).toBe(0);
  await expect(page.getByTestId("chain-read-error")).toHaveCount(0);
  expect(w.problems).toEqual([]);
});

test("fleet owner: rental KPIs match the contracts, no browser eth_getLogs, no errors", async ({ page }) => {
  const w = watch(page);
  await page.goto("/landlord");
  await page.getByTestId("dev-role-landlord").click();
  await expect(page.getByTestId("fleet-owner")).toHaveAttribute("data-ready", "true");
  await expect
    .poll(
      async () => {
        const want = await landlordCounts();
        const active = await page.getByTestId("kpi-active").innerText();
        const disputes = await page.getByTestId("kpi-disputes").innerText();
        return active.includes(String(want.active)) && disputes.includes(String(want.disputes)) && want.disputes >= 1;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  await expect(page.getByTestId("lease-card").first()).toBeVisible();
  expect(w.rpc.eth_getLogs ?? 0).toBe(0);
  expect(w.problems).toEqual([]);
});

test("back office shows a retry state when the chain cannot be read, and recovers on Retry", async ({ page }) => {
  let failing = true;
  await page.route("**/api/chain/index**", (route) =>
    failing
      ? route.fulfill({ status: 503, contentType: "application/json", headers: { "retry-after": "5" }, body: JSON.stringify({ error: "Could not read the chain right now" }) })
      : route.continue(),
  );
  await page.goto("/backoffice");
  const notice = page.getByTestId("chain-read-error");
  await expect(notice).toHaveAttribute("data-state", "error", { timeout: 30_000 });
  await expect(notice).toContainText("Retry");
  failing = false;
  await notice.getByTestId("chain-retry").click();
  await expect(page.getByTestId("rental-row").first()).toBeVisible();
  await expect(page.getByTestId("chain-read-error")).toHaveCount(0);
});

test("a link to a rental that no longer exists points to the latest one instead of a red error", async ({ page }) => {
  await page.goto("/lease/0x000000000000000000000000000000000000dEaD");
  const gone = page.getByTestId("lease-gone");
  await expect(gone).toContainText("This demo rental no longer exists");
  await expect(page.getByTestId("chain-retry")).toHaveCount(0);
  const link = gone.getByRole("link", { name: "Open the latest one" });
  await expect(link).toHaveAttribute("href", /^\/lease\/0x[0-9a-fA-F]{40}$/);
  await link.click();
  await expect(page.getByRole("heading", { name: /Rental 0x/ })).toBeVisible();
  await expect(page.getByTestId("lease-gone")).toBeHidden();
});
