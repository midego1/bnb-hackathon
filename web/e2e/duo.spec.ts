import { expect, test, type Browser, type FrameLocator, type Page } from "@playwright/test";
import path from "node:path";
import { E2E_WEB_PORT } from "./env";
import { noisyBmp } from "./photos";

/**
 * /duo/mystery-box on the throwaway anvil: the renter's phone (the framed /r flow) left, the rental company's view right.
 * One full rental is played through the phone pane; the owner pane, step bar and money follow it, and the presenter
 * accepts on the right. Then the settled screen at laptop and projector size, light and dark, 中文 and EN+中文, and a phone.
 *
 * Screenshots go to DUO_SHOTS (default test-results/screenshots/duo).
 */

const SLUG = "mystery-box";
const SHOTS = process.env.DUO_SHOTS ?? path.resolve(__dirname, "../test-results/screenshots/duo");
const phoneOf = (page: Page) => page.frameLocator("[data-testid='duo-phone-frame']");

async function step(phone: FrameLocator, name: string) {
  await expect(phone.getByTestId("judge-flow")).toHaveCount(1);
  await expect(phone.getByTestId("judge-flow")).toHaveAttribute("data-step", name, { timeout: 45_000 });
}

async function resetStage(page: Page) {
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("stage-reset").click();
  await expect(page.getByTestId("duo-view")).toHaveAttribute("data-status", "none");
}

async function photos(page: Page, kind: "pickup" | "return", seed: number) {
  const phone = phoneOf(page);
  await phone.getByTestId(`judge-camera-${kind}`).setInputFiles(noisyBmp(seed, 320, 240));
  await expect(phone.getByAltText(`${kind} photo`)).toHaveCount(1);
  await phone.getByTestId(`judge-save-${kind}`).click();
}

/** One screen: no page scroll either way, both panes, the phone, the QR and the presenter buttons fully in view. */
async function oneScreen(page: Page, at: string) {
  const m = await page.evaluate(() => ({ sw: document.scrollingElement!.scrollWidth, sh: document.scrollingElement!.scrollHeight, w: innerWidth, h: innerHeight }));
  expect(m.sw, `sideways scroll at ${at}`).toBeLessThanOrEqual(m.w);
  expect(m.sh, `page scroll at ${at}`).toBeLessThanOrEqual(m.h);
  for (const id of ["duo-steps", "duo-renter", "duo-owner", "duo-phone", "stage-qr", "stage-money", "stage-accept", "stage-reset"]) {
    await expect(page.getByTestId(id), `${id} at ${at}`).toBeInViewport({ ratio: 1 });
  }
  for (const el of await page.getByTestId("stage-amount").all()) {
    expect(await el.evaluate((e) => e.scrollWidth <= e.clientWidth), `amount overflows at ${at}`).toBe(true);
  }
}

async function screen(browser: Browser, width: number, height: number, scheme: "light" | "dark", lang: "en" | "zh" | "both" = "en") {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
  await ctx.addCookies([{ name: "ke_lang", value: lang, url: `http://127.0.0.1:${E2E_WEB_PORT}` }]);
  const page = await ctx.newPage();
  const at = `${width}x${height} ${scheme} ${lang}`;
  await page.goto(`/duo/${SLUG}`);
  await expect(page.getByTestId("duo-view")).toHaveAttribute("data-step", "5");
  await expect(page.getByTestId("stage-timeline").locator("li").first()).toBeVisible();
  // This browser has no guest wallet: the phone pane shows the judge's (settled) rental read-only.
  const phone = phoneOf(page);
  await step(phone, "settled");
  await expect(phone.getByTestId("judge-mirror")).toBeVisible();
  await expect(phone.getByTestId("assistant-bubble")).toHaveCount(0);
  if (width >= 1024) await oneScreen(page, at);
  else await expect(page.getByText("Best on a laptop")).toBeVisible();
  await page.waitForTimeout(400); // let the phone's fonts and photos settle for the screenshot
  const name = `duo-${width}x${height}-${scheme}${lang === "en" ? "" : `-${lang}`}`;
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  if (width < 1024) {
    // Stacked: the owner pane comes under the phone.
    await page.getByTestId("duo-owner").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, `${name}-owner.png`) });
  }
  await ctx.close();
}

test("duo: a rental played on the phone pane drives the owner pane, then the presenter accepts", async ({ page, browser }) => {
  test.setTimeout(360_000);
  const problems: string[] = [];
  page.on("response", (r) => r.status() >= 500 && problems.push(`${r.status()} ${r.url()}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  await page.setViewportSize({ width: 1470, height: 830 });
  await page.goto(`/duo/${SLUG}`);
  await expect(page.getByTestId("stage-qr")).toBeVisible();
  await resetStage(page);
  const phone = phoneOf(page);
  await expect(page.getByTestId("duo-steps").locator("[aria-current='step']")).toContainText("Rent");
  await oneScreen(page, "1470x830 idle");
  // No Ask AI bubble, neither on the page nor in the framed phone.
  await step(phone, "wallet");
  await expect(page.getByTestId("assistant-bubble")).toHaveCount(0);
  await expect(phone.getByTestId("assistant-bubble")).toHaveCount(0);

  await phone.getByTestId("judge-guest").click();
  await step(phone, "money");
  await phone.getByTestId("judge-drip").click();
  await step(phone, "rent");
  await phone.getByTestId("judge-rent").click();
  await step(phone, "pickup");

  // Funded: the owner pane follows, the paid and escrow cards light up and a coin runs renter -> escrow.
  await expect(page.getByTestId("duo-view")).toHaveAttribute("data-status", "Active");
  await expect(page.getByTestId("duo-view")).toHaveAttribute("data-step", "2");
  await expect(page.getByTestId("stage-headline")).toContainText("locked in escrow");
  await expect(page.getByTestId("stage-amount").first()).toHaveText(/^฿[\d,]+$/);
  await expect(page.getByTestId("duo-flash")).toHaveCount(2);
  await expect(page.locator("[data-testid='duo-flow'][data-moving]")).toHaveCount(1);
  await expect(page.locator("[data-testid='duo-steps'] [data-state='done']")).toHaveCount(1);
  await page.screenshot({ path: path.join(SHOTS, "duo-1470x830-funded.png") });

  await photos(page, "pickup", 1);
  await step(phone, "return");
  await expect(page.getByTestId("duo-view")).toHaveAttribute("data-step", "3");
  await expect(page.locator("img[alt='Pickup photo']")).toHaveCount(1);

  await photos(page, "return", 2);
  await step(phone, "inspect");
  await expect(page.getByTestId("duo-view")).toHaveAttribute("data-step", "4");
  await phone.getByTestId("judge-inspect").click();
  await expect(phone.getByTestId("judge-split")).toBeVisible();
  await phone.getByTestId("judge-propose").click();
  await step(phone, "waiting");
  await expect(page.getByTestId("duo-view")).toHaveAttribute("data-status", "MoveOut");
  await expect(page.getByTestId("stage-headline")).toContainText("AI split proposed");
  await page.screenshot({ path: path.join(SHOTS, "duo-1470x830-proposed.png") });

  await page.getByTestId("stage-accept").click();
  await expect(page.getByTestId("duo-view")).toHaveAttribute("data-status", "Settled", { timeout: 30_000 });
  await expect(page.getByTestId("duo-view")).toHaveAttribute("data-step", "5");
  await expect(page.locator("[data-testid='duo-steps'] [data-state='done']")).toHaveCount(5);
  await expect(page.getByTestId("stage-timeline")).toContainText("Both agreed: money settled");
  // Settled: owner and back-to-renter cards light up too, and a coin runs escrow -> owner.
  await expect(page.getByTestId("duo-flash")).toHaveCount(4);
  await expect(page.locator("[data-testid='duo-flow'][data-moving]")).toHaveCount(2);
  await step(phone, "settled");
  await expect(phone.getByTestId("judge-settled")).toContainText(/Your ฿[\d,]+ are back/);
  await expect(phone.getByTestId("judge-mirror")).toHaveCount(0);
  await oneScreen(page, "1470x830 settled");
  // Reduced motion: the coins stand still on their arrows (visible), nothing runs.
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const coin of await page.locator(".duo-coin").all()) {
    expect(await coin.evaluate((e) => [getComputedStyle(e).animationName, getComputedStyle(e).opacity])).toEqual(["none", "1"]);
  }

  for (const [w, h] of [
    [1470, 830],
    [1920, 1080],
  ]) {
    for (const scheme of ["light", "dark"] as const) await screen(browser, w, h, scheme);
  }
  for (const lang of ["zh", "both"] as const) await screen(browser, 1470, 830, "light", lang);
  await screen(browser, 390, 844, "light");
  expect(problems).toEqual([]);
});

test("duo: a judge renting on their own phone is mirrored read-only in the phone pane", async ({ page, request }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`/duo/${SLUG}`);
  await resetStage(page);
  const judge = "0x000000000000000000000000000000000000a11c";
  expect((await request.post(`/api/stage/${SLUG}`, { data: { action: "lease", address: judge } })).status()).toBe(200);
  const phone = phoneOf(page);
  await step(phone, "fund");
  await expect(phone.getByTestId("judge-flow")).toHaveAttribute("data-mirror", "true");
  await expect(phone.getByTestId("judge-mirror")).toContainText("a11c");
  // Read-only: the judge's pay button is there but cannot be pressed from here.
  await expect(phone.getByTestId("judge-rent")).toBeVisible();
  await expect(phone.getByTestId("judge-rent")).toBeDisabled();
  await expect(page.getByTestId("duo-view")).toHaveAttribute("data-status", "Created");
  await resetStage(page);
  await step(phone, "wallet");
});
