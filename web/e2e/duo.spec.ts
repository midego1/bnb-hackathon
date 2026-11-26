import { expect, test, type Browser, type FrameLocator, type Page } from "@playwright/test";
import path from "node:path";
import { E2E_WEB_PORT } from "./env";
import { noisyBmp } from "./photos";

/**
 * /duo/mystery-box on the throwaway anvil: the renter's phone (the framed /r flow) left, the rental company's view right.
 * The phone starts on its chooser; picking the Honda Click switches the header, the owner pane and the URL to it. One
 * full rental is played through the phone pane; the owner pane, step bar and money follow it, and the presenter
 * accepts on the right. Then the settled screen at laptop and projector size, light and dark, 中文 and EN+中文, and a phone.
 *
 * Screenshots go to DUO_SHOTS (default test-results/screenshots/duo).
 */

const SLUG = "mystery-box";
const HONDA = "honda-click-125i";
const SHOTS = process.env.DUO_SHOTS ?? path.resolve(__dirname, "../test-results/screenshots/duo");
const phoneOf = (page: Page) => page.frameLocator("[data-testid='duo-phone-frame']");

async function step(phone: FrameLocator | Page, name: string) {
  await expect(phone.getByTestId("judge-flow")).toHaveCount(1);
  await expect(phone.getByTestId("judge-flow")).toHaveAttribute("data-step", name, { timeout: 45_000 });
}

async function resetStage(page: Page) {
  await page.getByTestId("stage-reset").click();
  await page.getByTestId("confirm-ok").click(); // in-page dialog, not window.confirm
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
  for (const id of ["duo-steps", "duo-renter", "duo-owner", "duo-phone", "stage-qr", "duo-board", "stage-accept", "stage-reset"]) {
    await expect(page.getByTestId(id), `${id} at ${at}`).toBeInViewport({ ratio: 1 });
  }
  // The three LED panels sit inside their stations, side by side.
  for (const el of await page.locator("[data-testid='duo-board'] .mk-dotnum").all()) {
    expect(await el.evaluate((e) => e.getBoundingClientRect().right <= e.closest(".mk-station")!.getBoundingClientRect().right + 1), `LED panel overflows at ${at}`).toBe(true);
  }
}

/** The money board (the landing page's LED board, live): what a station holds, as its screen-reader text says it. */
const held = (page: Page, tone: "renter" | "escrow" | "owner") => page.locator(`[data-testid='duo-board'] .mk-station-${tone} .mk-station-read .sr-only`);
const track = (page: Page, i: 0 | 1) => page.locator("[data-testid='duo-board'] .mk-track").nth(i);
const LED_SHOTS = process.env.DUO_LED_SHOTS ?? SHOTS;
/** The board at 1440x900, light and dark, for the report; then back to the test's own size. */
async function ledShots(page: Page, name: string) {
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.waitForTimeout(1200); // the tag has flown in and the new amount has lit up
    await page.screenshot({ path: path.join(LED_SHOTS, `duo-led-1440x900-${colorScheme}-${name}.png`) });
  }
  await page.emulateMedia({ colorScheme: null });
  await page.setViewportSize(size);
}

async function screen(browser: Browser, width: number, height: number, scheme: "light" | "dark", lang: "en" | "zh" | "both" = "en") {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
  await ctx.addCookies([{ name: "ke_lang", value: lang, url: `http://127.0.0.1:${E2E_WEB_PORT}` }]);
  const page = await ctx.newPage();
  const at = `${width}x${height} ${scheme} ${lang}`;
  await page.goto(`/duo/${HONDA}`);
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
  // Step 0: the phone shows the catalogue, the Mystery Box preselected; the step bar is at Choose.
  await step(phone, "choose");
  await expect(page.getByTestId("duo-steps").locator("[aria-current='step']")).toContainText("Choose");
  await expect(page.getByTestId("duo-view")).toHaveAttribute("data-step", "0");
  await expect(phone.getByTestId(`judge-pick-${SLUG}`)).toHaveAttribute("aria-current", "true");
  await expect(phone.getByTestId("judge-choose").getByRole("button")).toHaveCount(8);
  await oneScreen(page, "1470x830 choose");
  // No Ask AI bubble, neither on the page nor in the framed phone.
  await expect(page.getByTestId("assistant-bubble")).toHaveCount(0);
  await expect(phone.getByTestId("assistant-bubble")).toHaveCount(0);

  // Pick the Honda Click: the header, the owner pane (its own stage) and the URL switch; the phone goes on to rent it.
  await phone.getByTestId(`judge-pick-${HONDA}`).click();
  await step(phone, "wallet");
  await expect(page).toHaveURL(new RegExp(`/duo/${HONDA}$`));
  await expect(page.getByTestId("duo-view").locator("header")).toContainText("Honda Click 125i");
  await expect(page.getByTestId("stage-headline")).toContainText("Honda Click 125i");
  await expect(page.getByTestId("duo-steps").locator("[aria-current='step']")).toContainText("Rent");
  await expect(phone.getByRole("heading", { level: 1 })).toHaveText("Honda Click 125i");
  await resetStage(page); // the presenter buttons now act on the Honda's stage
  await oneScreen(page, "1470x830 picked");
  // "Change scooter" goes back to the chooser (the bar too), the Honda now highlighted; pick it again.
  await phone.getByTestId("judge-change").click();
  await step(phone, "choose");
  await expect(page.getByTestId("duo-view")).toHaveAttribute("data-step", "0");
  await expect(phone.getByTestId(`judge-pick-${HONDA}`)).toHaveAttribute("aria-current", "true");
  await phone.getByTestId(`judge-pick-${HONDA}`).click();
  await step(phone, "wallet");
  await expect(page.getByTestId("duo-view")).toHaveAttribute("data-step", "1");
  // Rent: the renter still holds the Honda's month + deposit (฿3,400 + ฿6,800; on-chain mUSDT, so ±฿1), nothing moves yet.
  await expect(page.getByTestId("duo-board")).toHaveAttribute("data-phase", "none");
  await expect(held(page, "renter")).toHaveText(/^฿10,20[01]\s*$/);
  await expect(held(page, "escrow")).toHaveText(/^฿0\s*$/);
  await expect(held(page, "owner")).toHaveText(/^฿0\s*$/);
  await expect(track(page, 0)).toHaveAttribute("data-flow", "off");
  await expect(page.getByTestId("duo-board")).toContainText("Passport: still in your pocket");
  await expect(page.getByTestId("duo-board")).toContainText("this rental's own contract");
  await ledShots(page, "1-rent");

  await phone.getByTestId("judge-guest").click();
  await step(phone, "money");
  await phone.getByTestId("judge-drip").click();
  await step(phone, "rent");
  await phone.getByTestId("judge-rent").click();
  await step(phone, "pickup");

  // Funded: the owner pane follows; the escrow's live balance is on the board and the coins run renter -> escrow.
  await expect(page.getByTestId("duo-view")).toHaveAttribute("data-status", "Active");
  await expect(page.getByTestId("duo-view")).toHaveAttribute("data-step", "2");
  await expect(page.getByTestId("stage-headline")).toContainText("locked in escrow");
  await expect(page.getByTestId("duo-board")).toHaveAttribute("data-phase", "funded");
  await expect(held(page, "renter")).toHaveText(/^฿0\s*$/);
  await expect(held(page, "escrow")).toHaveText(/^฿10,20[01]\s*$/);
  await expect(track(page, 0)).toHaveAttribute("data-flow", "fwd");
  await expect(track(page, 0)).toContainText(/฿10,20[01]/);
  await expect(track(page, 1)).toHaveAttribute("data-flow", "off");
  await expect(page.locator("[data-testid='duo-steps'] [data-state='done']")).toHaveCount(2);
  await page.screenshot({ path: path.join(SHOTS, "duo-1470x830-funded.png") });
  await ledShots(page, "2-escrow");

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
  await expect(page.locator("[data-testid='duo-steps'] [data-state='done']")).toHaveCount(6);
  await expect(page.getByTestId("stage-timeline")).toContainText("Both agreed: money settled");
  // Settled: the escrow is empty, coins run back to the renter and on to the owner, and the one-time fee shows.
  await expect(page.getByTestId("duo-board")).toHaveAttribute("data-phase", "settled");
  await expect(held(page, "escrow")).toHaveText(/^฿0\s*$/);
  await expect(track(page, 0)).toHaveAttribute("data-flow", "rev");
  await expect(track(page, 1)).toHaveAttribute("data-flow", "fwd");
  await expect(page.locator("[data-testid='duo-board'] .mk-station-owner .mk-station-note")).toHaveText(/^KeyScrow fee ฿[\d,]+, once$/);
  await expect(page.locator("[data-testid='duo-board'] .mk-station-owner .mk-station-note")).not.toHaveClass(/invisible/);
  await step(phone, "settled");
  await expect(phone.getByTestId("judge-settled")).toContainText(/Your ฿[\d,]+ are back/);
  // The board and the phone agree on what came back.
  const back = (await phone.getByTestId("judge-settled").textContent())!.match(/฿[\d,]+/)![0];
  await expect(held(page, "renter")).toHaveText(new RegExp(`^${back}\\s*$`));
  await expect(held(page, "owner")).toHaveText(/^฿[1-9][\d,]*\s*$/);
  await expect(phone.getByTestId("judge-mirror")).toHaveCount(0);
  await oneScreen(page, "1470x830 settled");
  await ledShots(page, "3-settled");
  // Reduced motion: the active tracks are simply lit (no chase), the tag and the amounts sit still.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const still = (sel: string, pseudo?: string) => page.locator(`[data-testid='duo-board'] ${sel}`).first().evaluate((e, p) => getComputedStyle(e, p).animationName, pseudo);
  expect(await still(".mk-track[data-flow='fwd']", "::after")).toBe("none");
  expect(await still(".mk-track-tag")).toBe("none");
  expect(await still(".mk-dot-on")).toBe("none");

  for (const [w, h] of [
    [1280, 720],
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
  await step(phone, "choose"); // free again: the phone opens on its chooser
});

test("duo + /r: step 0 Choose at 1440x900 and on a 390x844 phone, light and dark", async ({ browser }) => {
  // Stages no other spec rents, so nothing is mirrored here: the phone opens on its chooser.
  const [from, to] = ["yamaha-nmax-155", "honda-scoopy"];
  for (const scheme of ["light", "dark"] as const) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
    const page = await ctx.newPage();
    await page.goto(`/duo/${from}`);
    const phone = phoneOf(page);
    await step(phone, "choose");
    await expect(phone.getByTestId(`judge-pick-${from}`)).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("duo-view")).toHaveAttribute("data-step", "0");
    await page.waitForTimeout(400); // the catalogue photos
    await page.screenshot({ path: path.join(SHOTS, `duo-1440x900-${scheme}-choose.png`) });
    await phone.getByTestId(`judge-pick-${to}`).click();
    await step(phone, "wallet");
    await expect(page).toHaveURL(new RegExp(`/duo/${to}$`));
    await expect(page.getByTestId("duo-view").locator("header")).toContainText("Honda Scoopy");
    await expect(page.getByTestId("duo-view")).toHaveAttribute("data-step", "1");
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, `duo-1440x900-${scheme}-picked.png`) });
    await ctx.close();

    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, hasTouch: true });
    const p = await mobile.newPage();
    await p.goto(`/r/${from}`);
    await step(p, "choose");
    await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(SHOTS, `r-390x844-${scheme}-choose.png`) });
    await mobile.close();
  }
});
