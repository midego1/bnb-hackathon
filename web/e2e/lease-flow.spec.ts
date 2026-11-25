import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Full scooter rental lifecycle through the UI on a throwaway anvil, acting as owner (landlord) / renter (tenant) via the dev account
 * switcher (no browser wallet): create -> fund -> release rent -> AI proposal -> accept -> settled.
 */

const SHOTS = path.resolve(__dirname, "../test-results/screenshots");
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

// Two different (tiny) PNGs: the mock inspector treats a return photo not seen at pickup as one finding.
const png = (b64: string, name: string) => ({ name, mimeType: "image/png", buffer: Buffer.from(b64, "base64") });
const CHECKIN_PNG = png("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "left-side-pickup.png");
const CHECKOUT_PNG = png("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "left-side-return.png");
const LEASE_PDF = { name: "lease.pdf", mimeType: "application/pdf", buffer: readFileSync(path.resolve(__dirname, "../public/demo/lease.pdf")) };

async function actAs(page: Page, role: "landlord" | "tenant" | "arbiter") {
  await page.getByTestId(`dev-role-${role}`).click();
  await expect(page.getByTestId(`dev-role-${role}`)).toHaveAttribute("aria-pressed", "true");
}

async function waitForTx(page: Page, title: string) {
  const toast = page.locator('[role="status"]', { hasText: title }).last();
  await expect(toast).toHaveAttribute("data-kind", "success", { timeout: 30_000 });
}

const badge = (page: Page) => page.getByTestId("status-badge").first();

test("owner creates, renter funds, rent is released, AI proposal accepted", async ({ page }) => {
  // No page may log a console error or hit a 4xx/5xx (e.g. a missing favicon or evidence file).
  const problems: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("response", (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`));

  // --- Owner creates a rental --------------------------------------------------------------------
  await page.goto("/landlord");
  await actAs(page, "landlord");
  // The fleet dashboard above the form loads from the chain; wait so the form does not move under the click.
  await expect(page.getByTestId("fleet-owner")).toHaveAttribute("data-ready", "true");
  const form = page.getByTestId("create-lease-form");
  await expect(form).toBeVisible();
  await expect(page.getByTestId("fee-note")).toContainText("one-time 10%");
  // Amounts are THB first, and the rate source is labelled (no keys in this run -> demo rates).
  await expect(page.getByTestId("price-source").first()).toHaveAttribute("data-source", "mock");
  await expect(page.getByTestId("price-source").first()).toHaveText(/Demo rates/);
  await form.getByRole("button", { name: /Use anvil renter/ }).click();
  await form.locator('input[name="rent"]').fill("500");
  await form.locator('input[name="deposit"]').fill("1000");
  await form.locator('input[name="term"]').fill("12");
  await page.getByTestId("lease-pdf").setInputFiles(LEASE_PDF);
  await page.getByTestId("checkin-photos").setInputFiles(CHECKIN_PNG);
  await shot(page, "01-landlord-create");
  // The page above and inside the form (fleet dashboard, risk panel) re-renders while chain data loads; a click that
  // lands mid-render can be lost. Retry the click until the submit visibly started (busy button = no double submit).
  const create = form.getByRole("button", { name: "Create rental" });
  await expect(async () => {
    if (await create.isEnabled()) await create.click({ timeout: 3_000 });
    await expect(page.locator('[role="status"]', { hasText: "Create rental" }).first()).toBeVisible({ timeout: 8_000 });
  }).toPass({ timeout: 60_000 });

  await page.waitForURL(/\/lease\/0x[0-9a-fA-F]{40}$/, { timeout: 60_000 });
  const leaseUrl = page.url();
  await expect(badge(page)).toHaveText("Awaiting funding");
  await expect(page.getByText("You are the owner")).toBeVisible();
  await expect(page.locator('[data-event="EvidenceAdded"]')).toHaveCount(1);

  // --- Renter funds ----------------------------------------------------------------------------------
  await actAs(page, "tenant");
  await expect(page.getByText("You are the renter")).toBeVisible();
  const faucet = page.getByTestId("faucet");
  if (await faucet.isEnabled()) {
    await faucet.click();
    await waitForTx(page, "Get test USDT");
  }
  await page.getByTestId("approve").click();
  await waitForTx(page, "Approve USDT");
  await expect(page.getByTestId("fund")).toBeEnabled();
  await page.getByTestId("fund").click();
  await waitForTx(page, "Fund escrow");
  await expect(badge(page)).toHaveText("Active");

  // --- Rent release (first month is due at start) ------------------------------------------------------
  await expect(page.getByTestId("months-released")).toHaveText("0");
  await page.getByTestId("release-rent").click();
  await waitForTx(page, "Release rent");
  await expect(page.getByTestId("months-released")).toHaveText("1");
  await expect(page.locator('[data-event="ProtocolFeePaid"]')).toHaveCount(1);
  await shot(page, "02-lease-active-tenant");

  // --- Return: renter anchors a return photo, runs the AI inspector, proposes --------------------------
  await page.getByTestId("check-out-photos").setInputFiles(CHECKOUT_PNG);
  await page.getByTestId("anchor-check-out").click();
  await waitForTx(page, "Anchor return photo 1/1");
  await expect(page.getByTestId("run-inspection")).toBeEnabled();
  await page.getByTestId("run-inspection").click();
  await expect(page.getByTestId("inspection-result")).toBeVisible();
  await page.getByTestId("submit-ai-proposal").click();
  await waitForTx(page, "Submit AI proposal");
  await expect(badge(page)).toHaveText("Return proposal");
  await expect(page.getByTestId("current-proposal")).toContainText("by the renter");
  await expect(page.getByTestId("accept-proposal")).toBeDisabled();
  await shot(page, "03-moveout-proposal");

  // --- Owner accepts ---------------------------------------------------------------------------------
  await actAs(page, "landlord");
  await expect(page.getByTestId("accept-proposal")).toBeEnabled();
  await page.getByTestId("accept-proposal").click();
  await waitForTx(page, "Accept proposal");
  await expect(badge(page)).toHaveText("Settled");
  await expect(page.getByTestId("settlement")).toBeVisible();
  await expect(page.locator('[data-event="Settled"]')).toHaveCount(1);
  await shot(page, "04-lease-settled");

  // --- Lists reflect the state -------------------------------------------------------------------------
  await page.goto("/tenant");
  await actAs(page, "tenant");
  const address = leaseUrl.split("/").pop()!;
  const card = page.locator(`[data-testid="lease-card"][data-address="${address}"]`);
  await expect(card.getByTestId("status-badge")).toHaveText("Settled");
  await shot(page, "05-tenant-leases");

  // The seed script leaves one rental in dispute for the dispute desk.
  await page.goto("/arbiter");
  await actAs(page, "arbiter");
  await expect(page.getByRole("heading", { name: "Needs a ruling" })).toBeVisible();
  const disputed = page.getByTestId("lease-card").filter({ has: page.getByText("In dispute") }).first();
  await expect(disputed).toBeVisible();
  await shot(page, "06-dispute-desk");
  await disputed.click();
  await expect(page.getByRole("heading", { name: "Rule on this dispute" })).toBeVisible();
  // The seeded pickup manifest expands into its three bundled demo photos, each actually loaded.
  const thumbs = page.getByTestId("evidence-thumb").locator("img");
  await expect(thumbs).toHaveCount(3);
  for (const img of await thumbs.all()) await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByTestId("amount-thb").first()).toContainText("฿");
  await shot(page, "07-arbiter-resolve");

  // Mobile layout of the rental page.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(leaseUrl);
  await expect(badge(page)).toHaveText("Settled");
  await shot(page, "08-lease-mobile");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  expect(problems).toEqual([]);
});
