import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

/**
 * Light / Dark / System switch in the header: the choice applies at once, survives a reload, is on <html>
 * (class + data-theme) before the body is parsed (no flash), and System follows prefers-color-scheme.
 * The second test screenshots home, /demo (mid-run and summary) and a lease page in both themes at 1470x830.
 */

const SHOTS = path.resolve(__dirname, "../test-results/screenshots/theme");

const html = (page: Page) => page.locator("html");
const option = (page: Page, name: "Light" | "Dark" | "System") => page.getByTestId("theme-switch").getByRole("radio", { name: `${name} theme` });

async function expectTheme(page: Page, pref: "light" | "dark" | "system", resolved: "light" | "dark") {
  await expect(html(page)).toHaveAttribute("data-theme", pref);
  await expect(html(page)).toHaveClass(new RegExp(`(^|\\s)${resolved}(\\s|$)`));
  await expect(html(page)).not.toHaveClass(new RegExp(`(^|\\s)${resolved === "dark" ? "light" : "dark"}(\\s|$)`));
  await expect(option(page, pref === "system" ? "System" : pref === "dark" ? "Dark" : "Light")).toHaveAttribute("aria-checked", "true");
}

/** Records <html>'s class the moment <body> is created: proves the theme is set before first paint. */
async function recordThemeAtBody(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __themeAtBody?: string };
    new MutationObserver((_, obs) => {
      if (document.body) {
        w.__themeAtBody = document.documentElement.className;
        obs.disconnect();
      }
    }).observe(document, { childList: true, subtree: true });
  });
}
const themeAtBody = (page: Page) => page.evaluate(() => (window as unknown as { __themeAtBody?: string }).__themeAtBody ?? "");

test("theme switch: light / dark / system persist across reloads without a flash", async ({ page }) => {
  await recordThemeAtBody(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");

  // Default is System, which follows the OS.
  await expectTheme(page, "system", "dark");
  expect(await themeAtBody(page)).toMatch(/\bdark\b/);

  await option(page, "Light").click();
  await expectTheme(page, "light", "light");
  expect(await page.evaluate(() => localStorage.getItem("keyescrow-theme"))).toBe("light");
  await page.reload();
  await expectTheme(page, "light", "light");
  expect(await themeAtBody(page)).toMatch(/\blight\b/);

  // Keyboard: arrow keys move through the radio group and apply the theme.
  await option(page, "Light").focus();
  await page.keyboard.press("ArrowRight");
  await expectTheme(page, "dark", "dark");
  await expect(option(page, "Dark")).toBeFocused();
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/landlord");
  await expectTheme(page, "dark", "dark");
  expect(await themeAtBody(page)).toMatch(/\bdark\b/);

  // Back to System: follows the OS again, and live when the OS flips.
  await option(page, "System").click();
  await expectTheme(page, "system", "light");
  expect(await page.evaluate(() => localStorage.getItem("keyescrow-theme"))).toBeNull();
  await page.emulateMedia({ colorScheme: "dark" });
  await expectTheme(page, "system", "dark");
  await page.reload();
  await expectTheme(page, "system", "dark");
});

test.describe("theme screenshots", () => {
  test.use({ viewport: { width: 1470, height: 830 } });

  test("home, /demo and lease detail in light and dark", async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
    const shoot = async (name: string) => {
      await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
      await page.screenshot({ path: path.join(SHOTS, `${name}-full.png`), fullPage: true });
    };
    const both = async (name: string) => {
      for (const t of ["Light", "Dark"] as const) {
        await option(page, t).click();
        await expectTheme(page, t === "Light" ? "light" : "dark", t === "Light" ? "light" : "dark");
        await page.mouse.move(0, 400); // no hover state in the shot
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(300); // let the 150 ms color transitions finish
        await shoot(`${name}-${t.toLowerCase()}`);
      }
    };

    await page.goto("/");
    await expect(page.getByTestId("play-demo")).toBeVisible();
    await both("home");

    // /demo, paused mid-run (step by step, after the first rent payout), then the summary overlay.
    await page.goto("/demo");
    await expect(page.getByTestId("demo-play")).toBeEnabled();
    await page.getByTestId("demo-speed-fast").click();
    await page.getByTestId("demo-mode-step").click();
    await page.getByTestId("demo-play").click();
    for (const id of ["create", "checkin", "faucet", "fund", "rent"]) {
      await expect(page.locator(`[data-step="${id}"]`)).toHaveAttribute("data-status", "done", { timeout: 60_000 });
      if (id !== "rent") await page.getByTestId("demo-next").click();
    }
    await expect(page.getByTestId("demo-next")).toBeVisible();
    await expect(page.locator('[role="status"]')).toHaveCount(0, { timeout: 15_000 });
    await page.waitForTimeout(2_000); // let the 1.8 s "money moved" card flash fade
    await both("demo-mid-run");

    await page.getByTestId("demo-mode-auto").click();
    await expect(page.getByTestId("demo-summary")).toHaveAttribute("data-status", "settled", { timeout: 90_000 });
    await expect(page.locator('[role="status"]')).toHaveCount(0, { timeout: 15_000 });
    await both("demo-summary");
    const href = await page.getByTestId("demo-tx").first().getAttribute("href");
    expect(href).toMatch(/^\/lease\/0x[0-9a-fA-F]{40}$/);

    await page.goto(href!);
    await expect(page.getByTestId("status-badge").first()).toHaveText("Settled");
    await expect(page.getByTestId("timeline")).toBeVisible();
    await both("lease-detail");
    expect(problems).toEqual([]);
  });
});

test("phone width: a single cycle button fits the header row and cycles light -> dark -> system", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const cycle = page.getByTestId("theme-cycle");
  await expect(cycle).toBeVisible();
  await expect(page.getByTestId("theme-switch")).toBeHidden();
  const box = await cycle.boundingBox();
  expect(box && box.x + box.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  // It sits in the second header row, which must not need to scroll sideways to reach it.
  expect(await page.getByTestId("mobile-nav").evaluate((n) => n.scrollWidth - n.clientWidth)).toBeLessThanOrEqual(0);

  await expect(cycle).toHaveAttribute("data-theme-pref", "system");
  await cycle.click();
  await expect(html(page)).toHaveAttribute("data-theme", "light");
  await cycle.click();
  await expect(html(page)).toHaveAttribute("data-theme", "dark");
  await expect(html(page)).toHaveClass(/\bdark\b/);
  await page.reload();
  await expect(cycle).toHaveAttribute("data-theme-pref", "dark");
  await expect(cycle).toHaveAccessibleName("Color theme: Dark. Switch to System");
  await page.screenshot({ path: path.join(SHOTS, "home-mobile-dark.png") });
});
