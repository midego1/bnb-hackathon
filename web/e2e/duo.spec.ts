import { expect, test, type Browser, type FrameLocator, type Page } from "@playwright/test";
import path from "node:path";
import { E2E_WEB_PORT } from "./env";
import { hydrated } from "./hydrated";
import { noisyBmp } from "./photos";

/**
 * /duo/mystery-box on the throwaway anvil: two phones and a vault. The renter's phone (the framed /r flow) left, the
 * shop owner's phone right, the escrow as a vault between them. The phone starts on its chooser; picking the Honda
 * Click switches the header, the owner side and the URL to it. One full rental is played through the phone pane; the
 * owner's phone, the vault (coin pile, lanes, receipt), the step bar and the money follow it, and the presenter accepts
 * on the owner's phone. The renter's phone is drawn as the KeyScrow iPhone app (status bar, 7-dot step row, the app's
 * cards, on-chain transactions); a shot of the whole screen at each step, light and dark. Then the settled screen at laptop and projector size, light and dark, 中文 and EN+中文, and a phone.
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

/**
 * One screen: no page scroll either way; the step bar and the header's icon buttons (sound, theme, QR, Reset), both
 * phones, the vault with its lanes and receipt fully in view (and Accept when the owner's phone shows it).
 */
async function oneScreen(page: Page, at: string) {
  const m = await page.evaluate(() => ({ sw: document.scrollingElement!.scrollWidth, sh: document.scrollingElement!.scrollHeight, w: innerWidth, h: innerHeight }));
  expect(m.sw, `sideways scroll at ${at}`).toBeLessThanOrEqual(m.w);
  expect(m.sh, `page scroll at ${at}`).toBeLessThanOrEqual(m.h);
  const ids = ["duo-steps", "duo-renter", "duo-owner", "duo-phone", "duo-owner-phone", "duo-sound", "theme-cycle", "stage-qr-card", "duo-board", "duo-pile", "duo-lock", "duo-paid", "duo-back", "duo-got", "duo-fee", "stage-timeline-box", "stage-reset"];
  if (await page.getByTestId("stage-accept").count()) ids.push("stage-accept");
  // 0.999: Accept sits in the owner's scaled phone, whose sub-pixel edges round a hair under 1.
  for (const id of ids) await expect(page.getByTestId(id).first(), `${id} at ${at}`).toBeInViewport({ ratio: 0.999 });
  // The lanes sit between the phones and the vault, not over either.
  const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
  const [phone, owner, laneL, laneR, vault] = await Promise.all(["[data-testid='duo-phone']", "[data-testid='duo-owner-phone']", ".duo-lane-l", ".duo-lane-r", ".duo-vault"].map(box));
  expect(laneL.x, `left lane over the phone at ${at}`).toBeGreaterThanOrEqual(phone.x + phone.width - 1);
  expect(laneL.x + laneL.width, `left lane over the vault at ${at}`).toBeLessThanOrEqual(vault.x + 1);
  expect(laneR.x, `right lane over the vault at ${at}`).toBeGreaterThanOrEqual(vault.x + vault.width - 1);
  expect(laneR.x + laneR.width, `right lane over the owner's phone at ${at}`).toBeLessThanOrEqual(owner.x + 1);
}

/** The vault: what the escrow holds (its screen-reader text), a lane's coin track, a lane number. */
const escrow = (page: Page) => page.getByTestId("duo-escrow");
const track = (page: Page, i: 0 | 1) => page.locator(".duo-lane .mk-track").nth(i);
const stat = (page: Page, id: "paid" | "back" | "got" | "fee") => page.locator(`[data-testid='duo-${id}'] dd`);
/** The pile's coins of one kind that are lit (their coin face showing), once the drop or drain has played. */
const lit = (page: Page, kind?: string) =>
  page.locator(`[data-testid='duo-pile'] .duo-coin${kind ? `[data-kind='${kind}']` : ""}`).evaluateAll((els) => els.filter((e) => getComputedStyle(e, "::after").opacity === "1").length);
const coins = (page: Page, kind: string) => page.locator(`[data-testid='duo-pile'] .duo-coin[data-kind='${kind}']`).count();
/** The whole screen at 1440x900, light and dark, for the report; then back to the test's own size. */
async function shots(page: Page, name: string) {
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme }); // the framed phone follows the media query
    await page.evaluate((c) => document.documentElement.classList.replace(c === "dark" ? "light" : "dark", c), colorScheme); // the page, its theme class
    await page.waitForTimeout(2500); // the coins have dropped or drained, the tag has flown in, the receipt has printed
    await page.screenshot({ path: path.join(SHOTS, `duo-1440x900-${colorScheme}-${name}.png`) });
  }
  await page.emulateMedia({ colorScheme: null });
  await page.evaluate(() => document.documentElement.classList.replace("dark", "light"));
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
  await expect(page.getByTestId("stage-qr-card")).toBeVisible();
  await resetStage(page);
  const phone = phoneOf(page);
  // Step 0: the phone shows the catalogue, the Mystery Box preselected; the step bar is at Choose.
  await step(phone, "choose");
  await expect(page.getByTestId("duo-steps").locator("[aria-current='step']")).toContainText("Choose");
  await expect(page.getByTestId("duo-view")).toHaveAttribute("data-step", "0");
  await expect(phone.getByTestId(`judge-pick-${SLUG}`)).toHaveAttribute("aria-current", "true");
  await expect(phone.getByTestId("judge-choose").getByRole("button")).toHaveCount(8);
  // The iPhone app look: its catalogue list, the status bar and Dynamic Island on both phones.
  await expect(phone.getByRole("heading", { name: "Ready to rent" })).toBeVisible();
  await expect(page.locator(".ios-statusbar")).toHaveCount(2);
  await expect(page.locator(".ios-statusbar").first()).toContainText("09:41");
  await oneScreen(page, "1470x830 choose");
  await shots(page, "1-choose");
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
  // Rent: the vault is empty; its pile is laid out for the Honda's day + deposit (฿250 + ฿6,800; on-chain mUSDT, so
  // ±฿1) in ฿100 coins, all dim. Nothing moves yet.
  await expect(page.getByTestId("duo-board")).toHaveAttribute("data-phase", "none");
  await expect(escrow(page)).toHaveText(/^฿0\s*$/);
  await expect(page.getByTestId("duo-pile")).toHaveAttribute("data-coin", "100");
  await expect(page.getByTestId("duo-pile")).toHaveAttribute("data-count", "71");
  expect(await lit(page)).toBe(0);
  await expect(page.getByTestId("duo-legend")).toContainText("1 coin = ฿100");
  await expect(page.getByTestId("duo-legend")).toContainText(/฿6,80[01] deposit \+ ฿25[01] rent/);
  await expect(page.getByTestId("duo-lock")).toHaveText("Empty: waiting for the renter");
  await expect(track(page, 0)).toHaveAttribute("data-flow", "off");
  await expect(stat(page, "paid")).toHaveText("–");
  await expect(page.getByTestId("duo-renter")).toContainText("Passport: still in your pocket");
  await expect(page.getByTestId("duo-board")).toContainText("this rental's own contract");
  await expect(page.getByTestId("stage-headline")).toContainText("Scan to rent the Honda Click 125i");

  await phone.getByTestId("judge-guest").click();
  await step(phone, "money");
  await phone.getByTestId("judge-drip").click();
  await step(phone, "rent");
  // On stage a scooter rents for one day at its day price, like the box.
  await expect(phone.getByRole("heading", { level: 2 })).toContainText(/Rent it for ฿25[01]/);
  await expect(phone.getByText("Rent (1 day)")).toBeVisible();
  // The app's step row (dot 2 of 7, Money ticked) and its rent card: each amount with its mUSDT, the total, the lock.
  await expect(phone.getByTestId("ios-steps").locator("[aria-current='step']")).toHaveText("2Pay");
  await expect(phone.getByTestId("ios-steps").locator("[data-state='done']")).toHaveCount(1);
  await expect(phone.locator(".ios-kv")).toHaveCount(3);
  await expect(phone.locator(".ios-kv").last()).toContainText(/Into escrow now\s*฿7,05[01]\s*[\d.]+ mUSDT/);
  await shots(page, "1b-rent");
  await phone.getByTestId("judge-rent").click();
  await step(phone, "pickup");

  // Funded: the owner's phone follows; the vault holds the live balance, its pile fills and the coins run renter -> vault.
  await expect(page.getByTestId("duo-view")).toHaveAttribute("data-status", "Active");
  await expect(page.getByTestId("duo-view")).toHaveAttribute("data-step", "2");
  await expect(page.getByTestId("stage-headline")).toContainText("locked in escrow");
  await expect(page.getByTestId("duo-owner-screen")).toContainText(/Deposit in escrow\s*฿6,80[01]/);
  await expect(page.getByTestId("duo-board")).toHaveAttribute("data-phase", "funded");
  await expect(escrow(page)).toHaveText(/^฿7,05[01]\s*$/);
  await expect.poll(() => lit(page), { timeout: 10_000 }).toBe(71);
  await expect(page.getByTestId("duo-lock")).toHaveText("Locked: nobody can move it alone");
  await expect(track(page, 0)).toHaveAttribute("data-flow", "fwd");
  await expect(track(page, 0)).toContainText(/฿7,05[01]/);
  await expect(track(page, 1)).toHaveAttribute("data-flow", "off");
  await expect(stat(page, "paid")).toHaveText(/^฿7,05[01]$/);
  await expect(stat(page, "back")).toHaveText("–");
  // The receipt has printed the offer and the payment, each with its transaction.
  await expect(page.getByTestId("stage-timeline").locator("li")).toHaveCount(2);
  await expect(page.getByTestId("stage-timeline").locator("li").nth(0)).toContainText(/create.*escrow created.*0x[0-9a-f]{8}/);
  await expect(page.getByTestId("stage-timeline").locator("li").nth(1)).toContainText(/fund.*Renter paid/);
  await expect(page.locator("[data-testid='duo-steps'] [data-state='done']")).toHaveCount(2);
  await page.screenshot({ path: path.join(SHOTS, "duo-1470x830-funded.png") });
  await shots(page, "2-rent-paid");

  await photos(page, "pickup", 1);
  await step(phone, "return");
  await expect(page.getByTestId("duo-view")).toHaveAttribute("data-step", "3");
  await expect(page.locator("img[alt='Pickup photo']")).toHaveCount(1);
  await expect(page.getByTestId("stage-timeline")).toContainText("evidence");
  await expect(phone.getByTestId("ios-txs").locator(".ios-tx")).toHaveCount(3); // offer, payment, pickup photo
  await shots(page, "2b-return");

  await photos(page, "return", 2);
  await step(phone, "inspect");
  await expect(page.getByTestId("duo-view")).toHaveAttribute("data-step", "4");
  await phone.getByTestId("judge-inspect").click();
  await expect(phone.getByTestId("judge-split")).toBeVisible();
  await expect(phone.getByTestId("ios-split")).toContainText("Back to you");
  await shots(page, "2c-ai-check");
  await phone.getByTestId("judge-propose").click();
  await step(phone, "waiting");
  await expect(page.getByTestId("duo-view")).toHaveAttribute("data-status", "MoveOut");
  await expect(page.getByTestId("stage-headline")).toContainText("AI split proposed");
  // The AI split: the pile takes the split's colours (teal back to the renter, pink to the owner, amber the rent), the
  // owner's phone shows both photos and its Accept; the receipt has both photos and the proposal.
  await expect(page.getByTestId("duo-board")).toHaveAttribute("data-phase", "split");
  await expect(page.getByTestId("duo-lock")).toHaveText("Split proposed: it needs the owner's OK");
  expect(await coins(page, "renter")).toBeGreaterThan(50);
  expect(await coins(page, "owner")).toBeGreaterThan(0);
  expect(await coins(page, "fee")).toBe(1);
  await expect(page.getByTestId("duo-legend")).toContainText("back to renter");
  await expect(page.getByTestId("duo-owner-screen").locator("img[alt='Pickup photo'], img[alt='Return photo']")).toHaveCount(2);
  await expect(page.getByTestId("stage-timeline").locator("li")).toHaveCount(5);
  await expect(page.getByTestId("stage-accept")).toBeVisible();
  await oneScreen(page, "1470x830 split");
  await page.screenshot({ path: path.join(SHOTS, "duo-1470x830-proposed.png") });
  await shots(page, "3-ai-split");

  await page.getByTestId("stage-accept").click();
  await expect(page.getByTestId("duo-view")).toHaveAttribute("data-status", "Settled", { timeout: 30_000 });
  await expect(page.getByTestId("duo-view")).toHaveAttribute("data-step", "5");
  await expect(page.locator("[data-testid='duo-steps'] [data-state='done']")).toHaveCount(6);
  await expect(page.getByTestId("stage-timeline")).toContainText("Both agreed: money settled");
  // Settled: the vault is empty, its pile drains into both lanes (back to the renter, on to the owner) and the one-time
  // fee shows; the receipt prints the payouts.
  await expect(page.getByTestId("duo-board")).toHaveAttribute("data-phase", "settled");
  await expect(escrow(page)).toHaveText(/^฿0\s*$/);
  await expect.poll(() => lit(page), { timeout: 10_000 }).toBe(0);
  await expect(page.getByTestId("duo-lock")).toHaveText("Paid out and closed");
  await expect(track(page, 0)).toHaveAttribute("data-flow", "rev");
  await expect(track(page, 1)).toHaveAttribute("data-flow", "fwd");
  await expect(page.getByTestId("duo-fee")).toContainText("KeyScrow fee, once");
  await expect(stat(page, "fee")).toHaveText(/^฿[1-9][\d,]*$/);
  const fee = (await stat(page, "fee").textContent())!;
  await expect(page.getByTestId("duo-payout")).toContainText(`${fee} KeyScrow`);
  await step(phone, "settled");
  await expect(phone.getByTestId("judge-settled")).toContainText(/Your ฿[\d,]+ are back/);
  // The lanes, the receipt, the owner's phone and the renter's phone agree on what came back and what the owner got.
  const back = (await phone.getByTestId("judge-settled").textContent())!.match(/฿[\d,]+/)![0];
  await expect(stat(page, "back")).toHaveText(back);
  await expect(stat(page, "got")).toHaveText(/^฿[1-9][\d,]*$/);
  const got = (await stat(page, "got").textContent())!;
  await expect(page.getByTestId("duo-payout")).toContainText(`${back} renter`);
  await expect(page.getByTestId("duo-payout")).toContainText(`${got} owner`);
  await expect(page.getByTestId("duo-owner-screen")).toContainText(new RegExp(`Owner got\\s*${got}`));
  await expect(page.getByTestId("stage-accept")).toHaveCount(0);
  await expect(phone.getByTestId("judge-mirror")).toHaveCount(0);
  // The app's settled card: all 7 dots ticked, the split bar with the fee, the transactions (create to accept).
  await expect(phone.getByTestId("ios-steps").locator("[data-state='done']")).toHaveCount(7);
  await expect(phone.getByTestId("ios-split")).toContainText(`Back to you ${back}`);
  await expect(phone.getByTestId("ios-split")).toContainText(`To the owner ${got}`);
  await expect(phone.getByTestId("ios-split")).toContainText(`KeyScrow fee ${fee}`);
  await expect(phone.getByTestId("ios-txs").locator(".ios-tx")).toHaveCount(6);
  await oneScreen(page, "1470x830 settled");
  await shots(page, "4-settled");
  // Reduced motion: the active tracks are simply lit (no chase), nothing drops, drains, prints or flies.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const still = (sel: string, pseudo?: string) => page.locator(`[data-testid='duo-board'] ${sel}`).first().evaluate((e, p) => getComputedStyle(e, p).animationName, pseudo);
  expect(await still(".mk-track[data-flow='fwd']", "::after")).toBe("none");
  expect(await still(".mk-track-tag")).toBe("none");
  expect(await still(".mk-dot-on")).toBe("none");
  expect(await still(".duo-coin", "::after")).toBe("none");
  expect(await still(".duo-receipt li")).toBe("none");
  expect(await lit(page)).toBe(0);

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

test("duo: the speaker button and M turn the sound on and off, remembered; no console errors while audio is blocked", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/duo/honda-scoopy");
  const sound = page.getByTestId("duo-sound");
  // On by default; before any click, tap or key the browser blocks audio, so the bar says how to enable it.
  await expect(sound).toHaveAttribute("aria-pressed", "true");
  await expect(sound).toHaveAccessibleName("Sound (M)");
  await expect(page.getByTestId("duo-sound-tap")).toHaveText("Tap to enable sound"); // the dot on the speaker (its text for screen readers)
  await expect(sound).toHaveAttribute("title", "Sound (M) · Tap to enable sound");
  // A tap on the renter's phone (the framed /r) unlocks it too.
  const phone = phoneOf(page);
  await step(phone, "choose");
  await phone.getByRole("heading", { name: "Ready to rent" }).click();
  await expect(page.getByTestId("duo-sound-tap")).toHaveCount(0);
  await sound.click();
  await expect(sound).toHaveAttribute("aria-pressed", "false");
  // Remembered across a reload; then M turns it back on.
  await page.reload();
  await hydrated(sound);
  await expect(sound).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("duo-sound-tap")).toHaveCount(0); // muted: no hint
  await page.keyboard.press("m");
  await expect(sound).toHaveAttribute("aria-pressed", "true");
  await expect(sound).toHaveAttribute("title", "Sound (M)");
  await page.reload();
  await hydrated(sound);
  await expect(sound).toHaveAttribute("aria-pressed", "true");
  expect(problems).toEqual([]);
});

test("duo: the header's theme switch (the phone follows live), the QR overlay, no bottom bar, phones drawn as iPhones", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/duo/honda-scoopy");
  const phone = phoneOf(page);
  await step(phone, "choose");
  await expect(page.getByTestId("duo-view").locator("footer")).toHaveCount(0); // the presenter's buttons sit in the header
  const theme = (frame: Page | FrameLocator) => frame.locator("html").evaluate((e) => (e.classList.contains("dark") ? "dark" : "light"));
  const cycle = page.getByTestId("theme-cycle");
  await hydrated(cycle);
  for (const [pref, want] of [["light", "light"], ["dark", "dark"], ["system", "light"]] as const) {
    await cycle.click();
    await expect(cycle).toHaveAttribute("data-theme-pref", pref);
    await expect.poll(() => theme(page)).toBe(want);
    await expect.poll(() => theme(phone), `the phone follows ${pref}`).toBe(want);
  }
  // The QR button opens the big QR to /r/<slug>; Escape closes it.
  await page.getByTestId("stage-qr-card").click();
  await expect(page.getByTestId("stage-qr-big").getByTestId("stage-qr")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("stage-qr-big")).toHaveCount(0);
  // Both phones: the screen is clipped to its rounded corners and the renter's page fills it exactly, with no scrollbar.
  for (const id of ["duo-phone", "duo-owner-phone"]) {
    const screen = page.getByTestId(id).locator(".duo-screen");
    expect(await screen.evaluate((e) => [getComputedStyle(e).overflow, getComputedStyle(e).borderRadius])).toEqual(["hidden", "55px"]);
    await expect(page.getByTestId(id).locator(".duo-home")).toBeVisible();
  }
  const [frame, screen] = await Promise.all([page.getByTestId("duo-phone-frame").boundingBox(), page.getByTestId("duo-phone").locator(".duo-screen").boundingBox()]);
  for (const k of ["x", "y", "width", "height"] as const) expect(Math.abs(frame![k] - screen![k]), k).toBeLessThan(0.5);
  expect(await phone.locator("html").evaluate((e) => innerWidth - e.clientWidth), "scrollbar in the phone").toBe(0);
  expect(await phone.locator("html").evaluate((e) => e.scrollHeight > e.clientHeight), "the phone page still scrolls").toBe(true);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await expect.poll(() => theme(phone)).toBe(colorScheme);
    await page.waitForTimeout(400);
    const box = (await page.getByTestId("duo-phone").boundingBox())!;
    await page.screenshot({ path: path.join(SHOTS, `duo-phone-closeup-${colorScheme}.png`), clip: { x: box.x - 16, y: box.y - 16, width: box.width + 32, height: box.height + 32 } });
  }
});
