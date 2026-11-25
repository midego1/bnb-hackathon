import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

/**
 * The four role views on the seeded throwaway anvil: back office (every rental + transaction, flags), fleet owner
 * (fleet, add a scooter, booking requests), renter (book, pay, follow the rental) and shareholders (Fleet Vault),
 * plus the header role switcher and the /demo Fleet Vault path (vault income goes up after a damaged return).
 */

const SHOTS = path.resolve(__dirname, "../test-results/screenshots/roles");
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

function watchProblems(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("response", (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`));
  return problems;
}

async function waitForTx(page: Page, title: string) {
  const toast = page.locator('[role="status"]', { hasText: title }).last();
  await expect(toast).toHaveAttribute("data-kind", "success", { timeout: 30_000 });
}

/** The header role switcher: opens the view and, on the local demo chain, switches the demo account too. */
async function view(page: Page, href: "backoffice" | "tenant" | "landlord" | "shareholders", role?: string) {
  await page.getByTestId(`view-${href}`).first().click();
  await page.waitForURL(new RegExp(`/${href}$`));
  if (role) await expect(page.getByTestId(`dev-role-${role}`)).toHaveAttribute("aria-pressed", "true");
}

test("back office lists every seeded rental with flags, transactions and vault inflows", async ({ page }) => {
  const problems = watchProblems(page);
  await page.goto("/backoffice");
  const rows = page.getByTestId("rental-row");
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThanOrEqual(3);
  // The seeded dispute is flagged, and still inside the desk's 14-day window: the specs that fast-forward the shared
  // chain revert it after each test (e2e/chain.ts), so this holds in any spec order.
  const disputed = rows.filter({ has: page.locator('[data-code="disputed"]') }).first();
  await expect(disputed).toHaveAttribute("data-status", "3");
  await expect(page.getByTestId("kpi-attention")).not.toContainText(/^0$/);
  // Expanding a rental shows its transactions with hashes.
  await disputed.getByTestId("toggle-tx").click();
  await expect(disputed.getByTestId("rental-tx").locator('[data-event="DisputeRaised"]')).toBeVisible();
  await expect(disputed.getByTestId("tx-link").first()).toContainText("0x");
  // Live feed and the Fleet Vault: the seeded vault rental already paid rent in.
  await expect(page.getByTestId("activity-feed").getByTestId("tx-event").first()).toBeVisible();
  await expect(page.getByTestId("vault-panel").locator('[data-event="Transfer"]').first()).toBeVisible();
  await expect(page.getByTestId("vault-tvl")).toContainText("฿");
  await page.getByTestId("filter-attention").click();
  expect(await rows.count()).toBeGreaterThanOrEqual(1);
  await shot(page, "01-backoffice");
  expect(problems).toEqual([]);
});

test("fleet owner lists a scooter, renter books it, owner offers the rental, renter pays", async ({ page }) => {
  const problems = watchProblems(page);
  await page.goto("/app");
  await view(page, "landlord", "landlord");
  await expect(page.getByTestId("fleet-list").getByTestId("scooter-card").first()).toBeVisible();
  await expect(page.getByTestId("scooter-card").filter({ hasText: "Honda Scoopy-i" }).getByTestId("scooter-state")).toHaveAttribute("data-state", "dispute");

  // Add a scooter (income to the Fleet Vault).
  const form = page.getByTestId("add-scooter-form");
  await form.locator('input[name="name"]').fill("Honda Wave 110");
  await form.locator('input[name="location"]').fill("Krabi Town");
  await form.locator('input[name="rentThb"]').fill("2500");
  await form.locator('input[name="depositThb"]').fill("5000");
  await expect(form.locator('input[name="vault"]')).toBeChecked();
  await page.getByTestId("add-scooter").click();
  const card = page.locator('[data-testid="scooter-card"][data-scooter="honda-wave-110-krabi-town"]');
  await expect(card.getByTestId("scooter-state")).toHaveAttribute("data-state", "available");
  await shot(page, "02-fleet-owner");

  // Renter books it.
  await view(page, "tenant", "tenant");
  const book = page.locator('[data-testid="book-card"][data-scooter="honda-wave-110-krabi-town"]');
  await book.getByTestId("book-scooter").click();
  await expect(book.getByText("Requested. Waiting for the shop.")).toBeVisible();

  // Owner turns the booking into an on-chain rental that pays the Fleet Vault.
  await view(page, "landlord", "landlord");
  const request = page.getByTestId("booking-request").filter({ hasText: "Honda Wave 110" });
  await expect(request).toContainText("pays the Fleet Vault");
  await request.getByTestId("offer-rental").click();
  await waitForTx(page, "Offer rental");
  await expect(card.getByTestId("scooter-state")).toHaveAttribute("data-state", "booked");

  // Renter pays deposit + rent on the rental page.
  await view(page, "tenant", "tenant");
  const rental = page.getByTestId("renter-rental").filter({ hasText: "Honda Wave 110" });
  await expect(rental).toHaveAttribute("data-status", "0");
  await rental.getByTestId("open-rental").click();
  await page.waitForURL(/\/lease\/0x[0-9a-fA-F]{40}$/);
  const faucet = page.getByTestId("faucet");
  if (await faucet.isEnabled()) {
    await faucet.click();
    await waitForTx(page, "Get test USDT");
  }
  await page.getByTestId("approve").click();
  await waitForTx(page, "Approve USDT");
  await page.getByTestId("fund").click();
  await waitForTx(page, "Fund escrow");
  await expect(page.getByTestId("status-badge").first()).toHaveText("Active");

  await page.goto("/tenant");
  await expect(rental).toHaveAttribute("data-status", "1");
  await expect(rental).toContainText("deposit is locked");
  await shot(page, "03-renter");

  // The back office shows it, routed to the vault.
  await view(page, "backoffice");
  await expect(page.getByTestId("rental-row").filter({ hasText: "Honda Wave 110" })).toContainText("pays Fleet Vault");
  expect(problems).toEqual([]);
});

test("shareholder buys fleet shares and claims income", async ({ page }) => {
  const problems = watchProblems(page);
  await page.goto("/app");
  await view(page, "shareholders", "investor");
  const shares = page.getByTestId("my-shares");
  await expect(shares).toContainText("3,000.00"); // seeded by Seed.s.sol
  await expect(page.getByTestId("vault-yield")).toContainText("%");
  await expect(page.getByTestId("vault-inflow").first()).toBeVisible();

  await page.getByTestId("deposit-amount").fill("500");
  await page.getByTestId("approve-vault").click();
  await waitForTx(page, "Approve USDT");
  await page.getByTestId("deposit-vault").click();
  await waitForTx(page, "Buy fleet shares");
  await expect(shares).toContainText("3,500.00");

  await expect(page.getByTestId("claim-income")).toBeEnabled();
  await page.getByTestId("claim-income").click();
  await waitForTx(page, "Claim income");
  await expect(page.getByTestId("claim-income")).toBeDisabled();
  await shot(page, "04-shareholders");
  expect(problems).toEqual([]);
});

test("renter view fits a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tenant");
  await page.getByTestId("dev-role-tenant").click();
  await expect(page.getByTestId("book-card").first()).toBeVisible();
  await expect(page.getByTestId("renter-rental").first()).toBeVisible();
  await shot(page, "05-renter-mobile");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("/demo Fleet Vault path: the vault's income rises after a damaged return", async ({ page }) => {
  await page.goto("/demo?autoplay=1&path=fleet&speed=fast");
  const summary = page.getByTestId("demo-summary");
  await expect(summary).toBeVisible({ timeout: 120_000 });
  await expect(summary).toHaveAttribute("data-path", "fleet");
  await expect(summary).toHaveAttribute("data-status", "settled");
  await expect(summary).toHaveAttribute("data-balanced", "true");
  await expect(page.getByTestId("demo-bal-landlord")).toContainText("Fleet Vault");
  expect(BigInt((await page.getByTestId("demo-bal-landlord").getAttribute("data-value")) ?? "0")).toBeGreaterThan(BigInt(0));
  await shot(page, "06-demo-fleet");
  // The shareholders' dashboard shows the new income.
  await page.goto("/backoffice");
  await expect(page.getByTestId("vault-panel").locator('[data-event="Transfer"]').nth(2)).toBeVisible();
});
