import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { createPublicClient, createWalletClient, http, parseEventLogs, zeroAddress, zeroHash, type Address } from "viem";
import { escrowFactoryAbi, mockUsdtAbi } from "../lib/contracts/abis.generated";
import { devAccounts } from "../lib/devAccounts";
import { restoreChainAfterEachTest } from "./chain";
import { E2E_DEPLOYMENT, E2E_RPC_URL } from "./env";

/**
 * "Pay with PromptPay" DEMO on the e2e anvil: a fresh rental awaiting funding, the renter opens the pay page from the
 * rental, sees the baht amount and a QR, clicks "I've paid" (the server mints test mUSDT), then approves and funds the
 * escrow from their own (dev) wallet.
 */
restoreChainAfterEachTest();

const SHOTS = path.resolve(__dirname, "../test-results/screenshots");
const U = BigInt(1_000_000);
const pub = createPublicClient({ transport: http(E2E_RPC_URL) });
const factory = E2E_DEPLOYMENT.escrowFactory as Address;
const token = E2E_DEPLOYMENT.token as Address;
const balance = () => pub.readContract({ address: token, abi: mockUsdtAbi, functionName: "balanceOf", args: [devAccounts.tenant] });

async function createLease(): Promise<Address> {
  const wallet = createWalletClient({ transport: http(E2E_RPC_URL) });
  const hash = await wallet.writeContract({
    account: devAccounts.landlord,
    chain: null,
    address: factory,
    abi: escrowFactoryAbi,
    functionName: "createLease",
    args: [{ tenant: devAccounts.tenant, arbiter: zeroAddress, rentAmount: BigInt(100) * U, depositAmount: BigInt(200) * U, termPeriods: 3, rentPeriod: 0, responseWindow: 0, arbiterWindow: 0, leaseHash: zeroHash }],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  const [created] = parseEventLogs({ abi: escrowFactoryAbi, eventName: "LeaseCreated", logs: receipt.logs });
  return created.args.escrow;
}

async function waitForTx(page: Page, title: string) {
  await expect(page.locator('[role="status"]', { hasText: title }).last()).toHaveAttribute("data-kind", "success", { timeout: 30_000 });
}

test("renter pays a rental with the PromptPay demo and funds the escrow", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("response", (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`));

  const lease = await createLease();
  await page.goto(`/lease/${lease}`);
  await page.getByTestId("dev-role-tenant").click();
  await page.getByTestId("pay-promptpay").click();
  await page.waitForURL(`**/app/pay/${lease}`);

  await expect(page.getByTestId("demo-banner")).toContainText("Demo, no real money");
  // 300 mUSDT at the e2e demo rate (33 THB per USDT, no price keys) = ฿9,900.
  await expect(page.getByTestId("promptpay-thb")).toHaveText(/9,900/);
  await expect(page.getByTestId("promptpay-usdt")).toContainText("300");
  const qr = page.getByTestId("promptpay-qr");
  await expect(qr).toBeVisible();
  await expect(qr).toHaveAttribute("data-payload", /^000201010212.*5303764540\d9900\.00.*6304[0-9A-F]{4}$/);
  await expect(page.getByTestId("promptpay-countdown")).toContainText(/QR valid for (10:00|9:5\d)/);
  await page.screenshot({ path: path.join(SHOTS, "promptpay-01-qr.png"), fullPage: true });

  const before = await balance();
  await page.getByTestId("promptpay-paid").click();
  await expect(page.getByTestId("promptpay-minted")).toBeVisible({ timeout: 30_000 });
  expect((await balance()) - before).toBe(BigInt(300) * U);

  await page.getByTestId("promptpay-approve").click();
  await waitForTx(page, "Approve USDT");
  await expect(page.getByTestId("promptpay-fund")).toBeEnabled();
  await page.getByTestId("promptpay-fund").click();
  await waitForTx(page, "Fund escrow");
  await expect(page.getByTestId("promptpay-done")).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, "promptpay-02-funded.png"), fullPage: true });

  await page.getByRole("link", { name: "Open the rental" }).click();
  await expect(page.getByTestId("status-badge").first()).toHaveText("Active");
  expect(problems).toEqual([]);
});
