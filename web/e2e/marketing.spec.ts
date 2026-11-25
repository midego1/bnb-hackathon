import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

/**
 * The marketing page at /: a static page without the app shell or a wallet. It renders, its calls to action lead into
 * the app, nothing logs an error, and a phone never scrolls sideways.
 *
 * Screenshots (1470x830 and 390x844, light and dark, first screen and full page) go to MARKETING_SHOTS
 * (default test-results/screenshots/marketing).
 */

const SHOTS = process.env.MARKETING_SHOTS ?? path.resolve(__dirname, "../test-results/screenshots/marketing");
const DESKTOP = { width: 1470, height: 830 };
const PHONE = { width: 390, height: 844 };

/** Console errors, page errors and failed requests seen while the page is open. */
function watchProblems(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  // A navigation aborts the link prefetches still in flight: that is not a failure.
  page.on("requestfailed", (r) => r.failure()?.errorText !== "net::ERR_ABORTED" && problems.push(`request failed: ${r.url()} ${r.failure()?.errorText}`));
  page.on("response", (r) => r.status() >= 400 && problems.push(`${r.status()}: ${r.url()}`));
  return problems;
}

const sideways = (page: Page) => page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);

/** Scroll through the page so every lazy image has loaded, then return to the top (instantly: the page scrolls smoothly). */
async function loadAll(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo({ top: y, behavior: "instant" });
      await new Promise((r) => setTimeout(r, 40));
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  await expect.poll(() => page.evaluate(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0))).toBe(true);
}

test("landing page renders the whole story without the app shell, a wallet or console errors", async ({ page }) => {
  const problems = watchProblems(page);
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await expect(page).toHaveTitle(/KeyEscrow.*passport/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Rent the scooter\.\s*Keep your passport\./);
  await expect(page.getByTestId("sidebar")).toHaveCount(0);
  await expect(page.getByTestId("wallet")).toHaveCount(0);
  await expect(page.getByTestId("ask-ai-entry")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+j"); // Ask AI's shortcut belongs to the app shell only
  await expect(page.getByTestId("assistant-panel")).toHaveCount(0);

  for (const name of [
    /nobody holding your passport/i,
    /How it works, in four steps/,
    /The AI proposes\. People decide\./,
    /Every dispute has a deadline/,
    /Fleet Vault/,
    /Built for agents/,
    /Live on BSC testnet/,
    /10% of one month's rent\. Once\./,
    /Where this goes next/,
  ]) {
    await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
  }
  await expect(page.getByRole("main")).toContainText("ERC-8004 agent #2921");
  await expect(page.getByTestId("fee-pitch")).toContainText("Never taken from the deposit");

  // The verified testnet contracts link to BscScan testnet.
  const contracts = page.getByTestId("mk-contract");
  await expect(contracts).toHaveCount(4);
  for (const href of await contracts.evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""))) {
    expect(href).toMatch(/^https:\/\/testnet\.bscscan\.com\/address\/0x[0-9a-fA-F]{40}#code$/);
  }
  await expect(page.getByTestId("mk-github")).toHaveAttribute("href", "https://github.com/midego1/bnb-hackathon");

  // SEO and social card.
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /smart contract on BNB Chain/);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/marketing\/og\.jpg$/);
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
  expect((await page.request.get("/marketing/og.jpg")).status()).toBe(200);

  // The hero artwork is the preloaded LCP image and has loaded; landmarks are in place.
  await expect(page.locator('link[rel="preload"][as="image"]')).toHaveCount(2);
  const art = page.locator(".mk-art img");
  await expect(art).toHaveAttribute("alt", /scooter rental shop/);
  await expect.poll(() => art.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  expect(await art.evaluate((img: HTMLImageElement) => img.currentSrc)).toMatch(/street-wide-\d+\.(avif|webp|jpg)$/);
  await expect(page.getByRole("banner")).toHaveCount(1);
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("contentinfo")).toHaveCount(1);

  // No web fonts or anything else from another origin.
  const origin = new URL(page.url()).origin;
  const foreign = await page.evaluate((o) => performance.getEntriesByType("resource").map((e) => e.name).filter((u) => !u.startsWith(o)), origin);
  expect(foreign).toEqual([]);

  await loadAll(page);
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  expect(problems).toEqual([]);
});

test("calls to action: Play the live demo, How it works, Open the app, Developers", async ({ page }) => {
  const problems = watchProblems(page);
  await page.setViewportSize(DESKTOP);

  await page.goto("/");
  await expect(page.getByTestId("mk-cta-demo")).toHaveText("Play the live demo");
  await page.getByTestId("mk-cta-demo").click();
  await page.waitForURL(/\/demo$/);
  await expect(page.getByTestId("demo-play")).toBeVisible();

  await page.goto("/");
  await page.getByTestId("mk-cta-how").click();
  await page.waitForURL(/\/how-it-works$/);
  await expect(page.locator("[data-demo-stage]")).toBeVisible();

  await page.goto("/");
  await page.getByTestId("mk-open-app").click();
  await page.waitForURL(/\/app$/);
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await expect(page.getByTestId("role-switcher")).toBeVisible();
  // ...and the app links back to the marketing page.
  await page.getByTestId("footer-website").click();
  await page.waitForURL((url) => url.pathname === "/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Keep your passport");

  await page.getByTestId("mk-developers").click();
  await page.waitForURL(/\/developers$/);
  await expect(page.getByTestId("action-get_lease")).toBeVisible();
  expect(problems).toEqual([]);
});

test("phone (390 px): no sideways scroll, both hero buttons on screen, theme button works", async ({ page }) => {
  const problems = watchProblems(page);
  await page.setViewportSize(PHONE);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  for (const id of ["mk-cta-demo", "mk-cta-how", "mk-open-app"]) {
    const box = (await page.getByTestId(id).boundingBox())!;
    expect(box.x, id).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, id).toBeLessThanOrEqual(PHONE.width);
    expect(box.y + box.height, `${id} is on the first screen`).toBeLessThanOrEqual(PHONE.height);
    expect(box.height, `${id} is a comfortable touch target`).toBeGreaterThanOrEqual(40);
  }
  expect(await page.locator(".mk-art img").evaluate((img: HTMLImageElement) => img.currentSrc)).toMatch(/street-tall-\d+\.(avif|webp|jpg)$/);

  const cycle = page.getByTestId("theme-cycle");
  await expect(page.locator("html")).toHaveClass(/\blight\b/);
  await cycle.click(); // system -> light
  await cycle.click(); // light -> dark
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await loadAll(page);
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  expect(problems).toEqual([]);
});

test("reduced motion: the street stands still", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  for (const sel of [".mk-art", ".mk-art-pan", ".mk-glow"]) {
    expect(await page.locator(sel).evaluate((el) => getComputedStyle(el).animationName), sel).toBe("none");
  }
});

test.describe("screenshots", () => {
  test.skip(!!process.env.SKIP_SCREENSHOTS, "SKIP_SCREENSHOTS is set");
  for (const vp of [DESKTOP, PHONE]) {
    for (const theme of ["light", "dark"] as const) {
      test(`${vp.width}x${vp.height} ${theme}`, async ({ page }) => {
        await page.setViewportSize(vp);
        await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
        await page.goto("/");
        await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
        await loadAll(page);
        await page.evaluate(() => document.fonts.ready);
        const name = `landing-${vp.width}x${vp.height}-${theme}`;
        await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
        await page.screenshot({ path: path.join(SHOTS, `${name}-full.png`), fullPage: true });
        expect(await sideways(page)).toBeLessThanOrEqual(0);
      });
    }
  }
});
