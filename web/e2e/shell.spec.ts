import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

/**
 * The app shell: a left sidebar (role switcher, demo, build links, theme, network, wallet) that collapses to an icon
 * rail, opens collapsed on the one-screen stages, and becomes a drawer on phones.
 *
 * Screenshots go to SHELL_SHOTS (default test-results/screenshots/shell).
 */

const SHOTS = process.env.SHELL_SHOTS ?? path.resolve(__dirname, "../test-results/screenshots/shell");
const sidebar = (page: Page) => page.getByTestId("sidebar");
const toggle = (page: Page) => page.getByTestId("sidebar-toggle");
const state = (page: Page) => page.locator("html");

/** Nothing in the sidebar wraps: every row is a single line and the address is shortened. */
async function expectSingleLineRows(page: Page) {
  const rows = await sidebar(page).evaluate((aside) =>
    [...aside.querySelectorAll<HTMLElement>("nav a, [data-testid='wallet'] button")].map((el) => ({
      text: el.textContent ?? "",
      h: el.getBoundingClientRect().height,
    })),
  );
  expect(rows.length).toBeGreaterThanOrEqual(9);
  for (const r of rows) expect(r.h, `"${r.text}" is one 36 px row`).toBe(36);
  await expect(page.getByTestId("wallet-address")).toHaveText(/^0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}$/);
}

for (const vp of [
  { width: 1280, height: 720 },
  { width: 1440, height: 800 },
  { width: 1470, height: 830 },
]) {
  test(`sidebar at ${vp.width}x${vp.height}: single-line rows, the page never scrolls sideways`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto("/tenant");
    await page.getByTestId("dev-role-tenant").click();
    await expect(page.getByTestId("wallet-address")).toBeVisible();
    await expect(state(page)).toHaveAttribute("data-sidebar", "expanded");
    await expectSingleLineRows(page);
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: path.join(SHOTS, `sidebar-${vp.width}x${vp.height}.png`) });
  });
}

test("roles group is the role switcher: active item, demo account follows, keyboard reachable", async ({ page }) => {
  await page.goto("/");
  const roles = page.getByTestId("role-switcher");
  await expect(roles.getByRole("link")).toHaveText(["Renter", "Fleet owner", "Shareholders", "Back office", "Dispute desk"]);
  await roles.getByRole("link", { name: "Fleet owner" }).click();
  await page.waitForURL(/\/landlord$/);
  await expect(page.getByTestId("view-landlord")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("view-tenant")).not.toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("dev-role-landlord")).toHaveAttribute("aria-pressed", "true");
  // Keyboard, from a fresh load: the skip link comes first, then the sidebar (logo, collapse button, the roles).
  await page.reload();
  await expect(page.getByTestId("view-landlord")).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(toggle(page)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("view-tenant")).toBeFocused();
  // Demo and Build groups.
  await expect(page.getByTestId("nav-demo")).toHaveAttribute("href", "/demo");
  await expect(page.getByTestId("nav-eli5")).toHaveAttribute("href", "/how-it-works");
  await expect(page.getByTestId("nav-developers")).toHaveAttribute("href", "/developers");
  await expect(page.getByTestId("nav-integrations")).toHaveAttribute("href", "/integrations");
  await expect(page.locator("#ask-ai-slot")).toHaveCount(1);
});

test("collapse to an icon rail: remembered across reloads; /demo and /how-it-works open collapsed", async ({ page }) => {
  await page.setViewportSize({ width: 1470, height: 830 });
  await page.goto("/");
  await expect(state(page)).toHaveAttribute("data-sidebar", "expanded");
  const wide = (await sidebar(page).boundingBox())!.width;
  await toggle(page).click();
  await expect(state(page)).toHaveAttribute("data-sidebar", "collapsed");
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect.poll(async () => (await sidebar(page).boundingBox())!.width).toBe(64);
  expect(wide).toBe(224);
  // Labels are visually hidden but still name the links.
  await expect(page.getByRole("link", { name: "Back office" })).toBeVisible();
  await page.reload();
  await expect(state(page)).toHaveAttribute("data-sidebar", "collapsed");
  await page.screenshot({ path: path.join(SHOTS, "rail-1470x830-light.png") });
  await toggle(page).click();
  await expect(state(page)).toHaveAttribute("data-sidebar", "expanded");

  // The stages open collapsed, by URL and by client-side navigation, without changing the remembered choice.
  await page.goto("/demo");
  await expect(state(page)).toHaveAttribute("data-sidebar", "collapsed");
  await toggle(page).click();
  await expect(state(page)).toHaveAttribute("data-sidebar", "expanded");
  await page.getByTestId("nav-eli5").click();
  await page.waitForURL(/\/how-it-works$/);
  await expect(state(page)).toHaveAttribute("data-sidebar", "collapsed");
  await page.getByTestId("view-backoffice").click();
  await page.waitForURL(/\/backoffice$/);
  await expect(state(page)).toHaveAttribute("data-sidebar", "expanded");
  expect(await page.evaluate(() => localStorage.getItem("keyescrow-sidebar"))).toBe("expanded");
});

test("phone: a top bar with a menu button opens the sidebar as a drawer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(sidebar(page)).toBeHidden();
  const open = page.getByTestId("menu-open");
  await open.click();
  await expect(sidebar(page)).toBeVisible();
  await expect(open).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "Close menu" }).last()).toBeFocused();
  await page.screenshot({ path: path.join(SHOTS, "mobile-drawer.png") });
  await page.keyboard.press("Escape");
  await expect(sidebar(page)).toBeHidden();
  await open.click();
  await page.getByTestId("view-shareholders").click();
  await page.waitForURL(/\/shareholders$/);
  await expect(sidebar(page)).toBeHidden();
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: path.join(SHOTS, "mobile-shareholders.png") });
});

test.describe("shell screenshots", () => {
  for (const vp of [
    { width: 1470, height: 830 },
    { width: 1280, height: 720 },
  ]) {
    for (const theme of ["light", "dark"] as const) {
      test(`expanded and collapsed at ${vp.width}x${vp.height}, ${theme}`, async ({ page }) => {
        await page.setViewportSize(vp);
        await page.emulateMedia({ colorScheme: theme });
        await page.goto("/backoffice");
        await expect(page.getByTestId("rental-row").first()).toBeVisible();
        await page.mouse.move(vp.width - 1, vp.height - 1);
        await page.screenshot({ path: path.join(SHOTS, `expanded-${vp.width}x${vp.height}-${theme}.png`) });
        await toggle(page).click();
        await expect(state(page)).toHaveAttribute("data-sidebar", "collapsed");
        await page.mouse.move(vp.width - 1, vp.height - 1);
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(SHOTS, `collapsed-${vp.width}x${vp.height}-${theme}.png`) });
      });
    }
  }
});
