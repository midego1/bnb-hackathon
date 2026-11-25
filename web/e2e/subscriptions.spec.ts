import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

/**
 * Subscriptions on the current contract: the owner offers a scooter as a monthly plan, the renter subscribes, the
 * owner issues the 12-month rental, the renter pays deposit + month 1 and then month 2, MRR shows up for the owner
 * and the shareholders, and "Cancel subscription" opens the normal return flow on the rental page.
 */

const SHOTS = path.resolve(__dirname, "../test-results/screenshots/subscriptions");
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

async function view(page: Page, testId: string, url: RegExp, role?: string) {
  await page.getByTestId(testId).first().click();
  await page.waitForURL(url);
  if (role) await expect(page.getByTestId(`dev-role-${role}`)).toHaveAttribute("aria-pressed", "true");
}
const owner = (page: Page) => view(page, "view-landlord", /\/landlord$/, "landlord");
const renter = (page: Page) => view(page, "view-subscriptions", /\/app\/subscriptions$/, "tenant");

test("subscribe, pay month 2, cancel starts the return flow", async ({ page }) => {
  const problems = watchProblems(page);
  await page.goto("/app");

  // Owner offers the Honda PCX 160 (income to the Fleet Vault) as a subscription.
  await owner(page);
  const form = page.getByTestId("offer-plan-form");
  await form.locator('select[name="scooter"]').selectOption("pcx-160-bkk");
  await form.locator('input[name="priceThb"]').fill("4500");
  await expect(form.locator('input[name="maxMonths"]')).toHaveValue("12");
  await expect(form.getByRole("radio", { name: "Monthly" })).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("offer-plan").click();
  await expect(page.locator('[data-testid="owner-plan"][data-scooter="pcx-160-bkk"]')).toContainText("฿4,500");

  // Renter subscribes.
  await renter(page);
  const plan = page.locator('[data-testid="plan-card"][data-scooter="pcx-160-bkk"]');
  await expect(plan).toContainText("Up to 12 months");
  await plan.getByTestId("subscribe").click();
  const sub = page.getByTestId("my-subscription").filter({ hasText: "Honda PCX 160" });
  await expect(sub).toHaveAttribute("data-state", "requested");

  // Owner issues the 12-month rental.
  await owner(page);
  const request = page.getByTestId("booking-request").filter({ hasText: "Honda PCX 160" });
  await expect(request).toContainText("subscription, up to 12 months");
  await request.getByTestId("offer-rental").click();
  await waitForTx(page, "Offer rental");

  // Renter pays deposit + month 1, then month 2.
  await renter(page);
  await expect(sub).toHaveAttribute("data-state", "issued");
  const faucet = sub.getByTestId("sub-faucet");
  if (await faucet.isVisible()) {
    await faucet.click();
    await waitForTx(page, "Get test USDT");
  }
  await sub.getByTestId("sub-pay").click();
  await waitForTx(page, "Pay deposit + month 1");
  await expect(sub).toHaveAttribute("data-state", "active");
  await expect(sub.getByTestId("months-paid")).toHaveText("1 of 12 months paid");
  await expect(sub.getByTestId("subscription-status")).toContainText("Next payment ฿");
  await expect(sub.getByTestId("sub-pay")).toHaveText(/Pay month 2/);
  await sub.getByTestId("sub-pay").click();
  await waitForTx(page, "Pay month 2");
  await expect(sub.getByTestId("months-paid")).toHaveText("2 of 12 months paid");
  await expect(sub.getByTestId("sub-pay")).toHaveText(/Pay month 3/);
  await shot(page, "01-renter");

  // MRR for the owner and the shareholders (the PCX pays the Fleet Vault).
  await owner(page);
  await expect(page.getByTestId("kpi-mrr")).toContainText("฿");
  await expect(page.getByTestId("kpi-mrr")).not.toContainText("฿0");
  await expect(page.getByTestId("kpi-subscribers")).toContainText("1");
  await page.getByTestId("owner-plan").first().scrollIntoViewIfNeeded();
  await shot(page, "02-owner");
  await view(page, "view-shareholders", /\/shareholders$/, "investor");
  await expect(page.getByTestId("vault-mrr")).toContainText("1 active subscriber");
  await shot(page, "03-shareholders");

  // Cancel = the normal return flow, after an explanation.
  await renter(page);
  await sub.getByTestId("sub-cancel").click();
  await expect(page.getByTestId("confirm-dialog")).toContainText("deposit comes back after that return check");
  await page.getByTestId("confirm-ok").click();
  await page.waitForURL(/\/lease\/0x[0-9a-fA-F]{40}$/);
  await expect(page.getByTestId("anchor-check-out")).toBeVisible();
  await expect(page.getByText("Return & deposit")).toBeVisible();
  expect(problems).toEqual([]);
});

test("subscriptions page fits a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/subscriptions");
  await page.getByTestId("dev-role-tenant").click();
  await expect(page.getByTestId("plan-card").first()).toBeVisible();
  await shot(page, "04-mobile");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
