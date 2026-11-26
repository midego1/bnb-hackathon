import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { hydrated } from "./hydrated";

/**
 * A demo scooter listing (/app/listings/<slug>) rented with the wallet connected in the app, on a throwaway anvil with
 * the dev account switcher (no browser wallet): connect -> "Rent it" (the demo owner's offer: a real createLease,
 * signed on the server) -> the rental page, where the renter approves and funds the deposit and one day's rent (the stage price).
 *
 * Like e2e/stage.spec.ts this leaves its rental on-chain and only resets the server's record of it. No
 * restoreChainAfterEachTest() here: the server counts the owner's nonces locally, and a chain reverted under it would
 * leave that count ahead for every stage rental that follows.
 */

const SLUG = "honda-click-125i";
const OTHER = "yamaha-nmax-155";
const SHOTS = path.resolve(__dirname, "../test-results/screenshots");
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
const badge = (page: Page) => page.getByTestId("status-badge").first();

async function actAs(page: Page, role: "landlord" | "tenant" | "investor") {
  const button = page.getByTestId(`dev-role-${role}`);
  await hydrated(button);
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

async function waitForTx(page: Page, title: string) {
  const toast = page.locator('[role="status"]', { hasText: title }).last();
  await expect(toast).toHaveAttribute("data-kind", "success", { timeout: 30_000 });
}

// The scooter is free again for the next test or run (the escrow itself stays on-chain).
test.afterEach(async ({ request }) => {
  for (const slug of [SLUG, OTHER]) await request.post(`/api/stage/${slug}`, { data: { action: "reset" } });
});

test("a renter rents a demo scooter from its listing: the owner's offer, then deposit and first rent into the escrow", async ({ page }) => {
  test.setTimeout(180_000);
  const problems: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("response", (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`));

  await page.goto(`/app/listings/${SLUG}`);
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Honda Click 125i" })).toBeVisible();
  const terms = page.getByTestId("listing-terms");
  await expect(terms).toContainText("฿250 / day");
  await expect(terms).toContainText("฿3,400 / month");
  await expect(terms).toContainText("฿6,800");
  await expect(page.getByTestId("listing-flow")).toContainText("the deposit and one day's rent");
  await expect(terms).toContainText("Nimman, Chiang Mai");
  await expect(page.getByTestId("listing-demo")).toContainText("Demo listing");
  await expect(page.getByTestId("listing-demo")).toContainText("test money");
  // The catalogue's real photo is there and sized (nothing moves when it loads), with its credit.
  const photo = page.getByTestId("listing-photo").getByRole("img", { name: /Honda Click/ });
  await expect(photo).toHaveAttribute("width", "1200");
  await expect(page.getByTestId("listing-photo")).toContainText("Photo: Vyacheslav Argenberg, CC BY 4.0.");
  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  // The Mystery Box's phone links belong to the stage item only.
  await expect(page.getByTestId("listing-rent")).toHaveCount(0);

  // 1. A wallet: this build connects a dev account by itself, so the "Connect a wallet" prompt (the app's shared
  //    WalletGate) cannot show here. 2. As the renter: "Rent it" (after "Get test money" when this wallet is short).
  const flow = page.getByTestId("listing-flow");
  await actAs(page, "tenant");
  const rentIt = page.getByTestId("listing-rent-it");
  await expect(rentIt).toBeEnabled();
  await expect(rentIt).toHaveText("Rent it");
  const money = page.getByTestId("listing-money");
  if (await money.isVisible()) {
    await money.click();
    await expect(money).toHaveCount(0, { timeout: 60_000 });
  }
  await expect(flow).toHaveAttribute("data-step", "rent");
  await shot(page, "listing-scooter");

  // 3. The owner's offer: a real createLease by the demo owner, then the rental page.
  await rentIt.click();
  await page.waitForURL(/\/lease\/0x[0-9a-fA-F]{40}$/, { timeout: 60_000 });
  const lease = new URL(page.url()).pathname;
  await expect(badge(page)).toHaveText("Awaiting funding");
  await expect(page.getByText("You are the renter")).toBeVisible();
  await shot(page, "listing-scooter-offer");

  // 4. The renter pays the deposit and one day's rent into the escrow.
  await expect(page.getByTestId("approve")).toBeEnabled(); // the wallet's balance and allowance are loaded
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
  const status = (await (await page.request.get(`/api/stage/${SLUG}`)).json()) as { lease: { status: string }; rental: { lease: string } };
  expect(status.lease.status).toBe("Active");
  expect(lease.toLowerCase()).toBe(`/lease/${status.rental.lease.toLowerCase()}`);
  await shot(page, "listing-scooter-funded");

  // 5. Back on the listing: this wallet carries on with its rental, another wallet sees that the scooter is out.
  await page.goto(`/app/listings/${SLUG}`);
  await actAs(page, "tenant");
  await expect(page.getByTestId("listing-continue")).toHaveAttribute("href", new RegExp(`^${lease}$`, "i"));
  await expect(rentIt).toHaveCount(0);
  await actAs(page, "investor");
  await expect(flow).toContainText("Rented right now");
  await expect(rentIt).toHaveCount(0);
  await expect(page.getByTestId("listing-continue")).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("the owner's own wallet cannot rent its scooter: the server's refusal is shown, nothing is created", async ({ page }) => {
  await page.goto(`/app/listings/${OTHER}`);
  await expect(page.getByRole("heading", { name: "Yamaha NMAX 155" })).toBeVisible();
  await actAs(page, "landlord"); // the demo owner on anvil
  const rentIt = page.getByTestId("listing-rent-it");
  await expect(rentIt).toBeEnabled();
  await rentIt.click();
  await expect(page.getByTestId("listing-flow").getByRole("alert")).toContainText("belongs to the owner or the dispute desk");
  await expect(page).toHaveURL(new RegExp(`/app/listings/${OTHER}$`));
  await expect(rentIt).toBeEnabled(); // not left busy
  const status = (await (await page.request.get(`/api/stage/${OTHER}`)).json()) as { rental?: unknown };
  expect(status.rental).toBeUndefined();
});
