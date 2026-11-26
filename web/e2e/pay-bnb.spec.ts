import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, http, parseAbi, parseEventLogs, zeroAddress, zeroHash, type Address } from "viem";
import { escrowFactoryAbi, mockUsdtAbi } from "../lib/contracts/abis.generated";
import { devAccounts } from "../lib/devAccounts";
import { restoreChainAfterEachTest } from "./chain";
import { E2E_DEPLOYMENT, E2E_RPC_URL } from "./env";

/**
 * "Pay with BNB" on the e2e anvil: the renter of a fresh rental is 300 mUSDT short, swaps BNB for exactly that through
 * the AtlasSwapGuard demo swap (reading a MockAtlasFeed at 650 USD/BNB), then approves and funds. The server has no
 * Atlas keys in e2e, so the Atlas status in GET /api/price (push feed + Pull API consensus) is stubbed in the browser.
 */
restoreChainAfterEachTest();

const SHOTS = path.resolve(__dirname, "../test-results/screenshots");
const U = BigInt(1_000_000);
const pub = createPublicClient({ transport: http(E2E_RPC_URL) });
const wallet = createWalletClient({ transport: http(E2E_RPC_URL) });
const token = E2E_DEPLOYMENT.token as Address;
const feed = JSON.parse(readFileSync(path.resolve(__dirname, "../../contracts/deployments/31337.example.json"), "utf8")).atlasFeedBnbUsd as Address;
const balance = () => pub.readContract({ address: token, abi: mockUsdtAbi, functionName: "balanceOf", args: [devAccounts.tenant] });

/** A rental whose deposit + first rent is 300 mUSDT more than the renter holds. */
async function createShortLease(): Promise<Address> {
  const deposit = (await balance()) + BigInt(200) * U;
  const hash = await wallet.writeContract({
    account: devAccounts.landlord,
    chain: null,
    address: E2E_DEPLOYMENT.escrowFactory as Address,
    abi: escrowFactoryAbi,
    functionName: "createLease",
    args: [{ tenant: devAccounts.tenant, arbiter: zeroAddress, rentAmount: BigInt(100) * U, depositAmount: deposit, termPeriods: 3, rentPeriod: 0, responseWindow: 0, arbiterWindow: 0, leaseHash: zeroHash }],
  });
  const [created] = parseEventLogs({ abi: escrowFactoryAbi, eventName: "LeaseCreated", logs: (await pub.waitForTransactionReceipt({ hash })).logs });
  return created.args.escrow;
}

/** Fresh MockAtlasFeed answer (the guard refuses one older than 240 s on the anvil clock). */
async function refreshFeed() {
  const hash = await wallet.writeContract({ account: devAccounts.landlord, chain: null, address: feed, abi: parseAbi(["function set(int256)"]), functionName: "set", args: [BigInt(650) * BigInt(10) ** BigInt(18)] });
  await pub.waitForTransactionReceipt({ hash });
}

/** GET /api/price as served, plus the Atlas status the server would give with live Atlas keys. */
async function stubAtlas(page: Page, consensusStatus: string, ok: boolean) {
  await page.route("**/api/price", async (route) => {
    const body = await (await route.fetch()).json();
    const now = Date.now();
    const atlas = {
      ok,
      ...(ok ? {} : { reason: `Atlas consensus is ${consensusStatus}` }),
      bnbUsdE18: "650000000000000000000",
      bnbUsd: 650,
      updatedAt: new Date(now - 20_000).toISOString(),
      maxAgeSec: 240,
      consensus: { score: 0.94, status: consensusStatus },
      fetchedAt: new Date(now).toISOString(),
    };
    await route.fulfill({ json: { ...body, atlas } });
  });
}

async function waitForTx(page: Page, title: string) {
  await expect(page.locator('[role="status"]', { hasText: title }).last()).toHaveAttribute("data-kind", "success", { timeout: 30_000 });
}

test("renter pays a rental with BNB through the Atlas-guarded swap and funds the escrow", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("response", (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`));
  await refreshFeed();
  await stubAtlas(page, "HEALTHY", true);
  const lease = await createShortLease();

  await page.goto(`/lease/${lease}`);
  await page.getByTestId("dev-role-tenant").click();
  await expect(page.getByTestId("atlas-badge")).toHaveText("Priced by Atlas · updated 20 s ago · consensus 0.94 HEALTHY");
  await expect(page.getByTestId("pay-bnb-box")).toContainText("AtlasSwapGuard");
  await expect(page.getByTestId("pay-bnb-min")).toContainText("you get at least 300");
  await expect(page.getByTestId("pay-bnb")).toBeEnabled();
  await page.screenshot({ path: path.join(SHOTS, "pay-bnb-01-quote.png"), fullPage: true });

  const before = await balance();
  await page.getByTestId("pay-bnb").click();
  await waitForTx(page, "Swap BNB to USDT");
  const got = (await balance()) - before;
  expect(got >= BigInt(300) * U && got < BigInt(304) * U).toBe(true); // 300 + the 1 % Atlas margin at most

  await expect(page.getByTestId("pay-bnb")).toBeDisabled(); // enough USDT now
  await page.getByTestId("approve").click();
  await waitForTx(page, "Approve USDT");
  await expect(page.getByTestId("fund")).toBeEnabled();
  await page.getByTestId("fund").click();
  await waitForTx(page, "Fund escrow");
  await expect(page.getByTestId("status-badge").first()).toHaveText("Active");
  await page.screenshot({ path: path.join(SHOTS, "pay-bnb-02-funded.png"), fullPage: true });
  expect(problems).toEqual([]);
});

test("Pay with BNB refuses while the Atlas consensus is CRITICAL", async ({ page }) => {
  await refreshFeed();
  await stubAtlas(page, "CRITICAL", false);
  const lease = await createShortLease();
  await page.goto(`/lease/${lease}`);
  await page.getByTestId("dev-role-tenant").click();
  await expect(page.getByTestId("pay-bnb-box")).toContainText("Price not trustworthy right now: Atlas consensus is CRITICAL.");
  await expect(page.getByTestId("pay-bnb")).toBeDisabled();
});
