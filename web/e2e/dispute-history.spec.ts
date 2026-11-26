import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { E2E_WEB_PORT } from "./env";

/**
 * Dispute memory per wallet: on the dispute desk, the seeded dispute shows a History card per party (on-chain facts +
 * what memory remembers, here the local stand-in: no Living Brain key in e2e), and the disputed rental page shows the
 * same two cards, the viewer's own one titled "What the dispute desk sees about you". Light, dark, 中文 and phone.
 */

const SHOTS = path.resolve(__dirname, "../test-results/screenshots/history");
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

async function actAs(page: Page, role: "landlord" | "tenant" | "arbiter") {
  await page.getByTestId(`dev-role-${role}`).click();
  await expect(page.getByTestId(`dev-role-${role}`)).toHaveAttribute("aria-pressed", "true");
}

function watchProblems(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("response", (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`));
  return problems;
}

async function expectBothCards(page: Page, scope = page.getByTestId("dispute-case").first()) {
  const renter = scope.locator('[data-testid="history-card"][data-party="renter"]');
  const owner = scope.locator('[data-testid="history-card"][data-party="owner"]');
  await expect(renter.getByTestId("history-as-renter")).toBeVisible();
  await expect(owner.getByTestId("history-as-owner")).toBeVisible();
  // The seeded dispute is still open: both cards list it, with who opened it.
  await expect(renter.getByTestId("history-events")).toContainText("opened by the");
  for (const card of [renter, owner]) {
    await expect(card.getByTestId("history-memory")).toHaveAttribute("data-provider", "local");
    await expect(card).toContainText("The AI summarises; the dispute desk decides.");
  }
  return { renter, owner };
}

test("dispute desk shows a history card per party for the seeded dispute", async ({ page }) => {
  const problems = watchProblems(page);
  await page.goto("/arbiter");
  await actAs(page, "arbiter");
  const kase = page.getByTestId("dispute-case").first();
  await expect(kase.getByTestId("lease-card")).toBeVisible();
  await expectBothCards(page, kase);
  await shot(page, "01-desk-light");

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);
  await shot(page, "02-desk-dark");
  await page.emulateMedia({ colorScheme: "light" });

  // The disputed rental page: the same two cards; the renter sees theirs titled for them.
  await kase.getByTestId("lease-card").click();
  await page.waitForURL(/\/lease\/0x/);
  await expectBothCards(page, page.getByTestId("party-histories"));
  await actAs(page, "tenant");
  await expect(page.locator('[data-testid="history-card"][data-party="renter"]').getByRole("heading", { name: "What the dispute desk sees about you" })).toBeVisible();
  await shot(page, "03-rental-renter");
  expect(problems).toEqual([]);
});

test("history cards in 中文 and on a phone", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.addCookies([{ name: "ke_lang", value: "zh", url: `http://127.0.0.1:${E2E_WEB_PORT}` }]);
  const page = await context.newPage();
  const problems = watchProblems(page);
  await page.goto("/arbiter");
  await actAs(page, "arbiter");
  const kase = page.getByTestId("dispute-case").first();
  await expect(kase.locator('[data-testid="history-card"][data-party="renter"]').getByRole("heading", { name: "租客的记录" })).toBeVisible();
  await expect(kase.locator('[data-testid="history-card"][data-party="owner"]')).toContainText("AI 只做总结；由争议处理台决定。");
  // Nothing wider than the phone, once transient UI (the account-switch toast sliding in) has settled.
  await expect.poll(() => page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await shot(page, "04-desk-zh-phone");
  expect(problems).toEqual([]);
  await context.close();
});
