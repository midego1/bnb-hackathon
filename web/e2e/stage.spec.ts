import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import path from "node:path";
import { E2E_WEB_PORT } from "./env";
import { noisyBmp } from "./photos";

/**
 * The live judge demo on a throwaway anvil: the big screen (/stage/mystery-box) and a judge's phone (/r/mystery-box)
 * with a guest wallet, side by side. Phone: guest wallet -> test money -> pay into escrow -> pickup photo -> (reload,
 * it resumes) -> return photo -> AI inspection -> propose. Big screen: accept -> settled, on both screens.
 */

const SHOTS = path.resolve(__dirname, "../test-results/screenshots");
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
const SLUG = "mystery-box";

async function judgePage(browser: Browser, mobile: boolean) {
  const ctx = await browser.newContext(mobile ? { ...devices["Pixel 7"] } : { viewport: { width: 1280, height: 900 } });
  return ctx.newPage();
}

async function resetStage(stage: Page) {
  stage.once("dialog", (d) => d.accept());
  await stage.getByTestId("stage-reset").click();
  await expect(stage.getByTestId("stage-view")).toHaveAttribute("data-status", "none");
}

/** Every screen the big-screen view is checked on: [width, height, touch]. Two columns on landscape >= 1024px. */
const SCREENS: [number, number, boolean][] = [
  [1920, 1080, false], // projector
  [2560, 1440, false],
  [1470, 830, false], // laptop
  [1280, 720, false],
  [1180, 820, true], // iPad landscape
  [1366, 1024, true],
  [820, 1180, true], // iPad portrait
  [1024, 1366, true],
  [390, 844, true], // phone
  [360, 780, true],
];
const STAGE_SHOTS = process.env.STAGE_SHOTS ?? path.resolve(__dirname, "../test-results/screenshots/stage");

type Box = { x: number; y: number; width: number; height: number };
const overlap = (a: Box, b: Box) => a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;

/** The big screen at one size: no sideways scroll, QR and presenter buttons on screen, blocks apart, amounts on one line. */
async function checkScreen(browser: Browser, [width, height, touch]: [number, number, boolean], scheme: "light" | "dark", lang: "en" | "zh" | "both") {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, hasTouch: touch });
  await ctx.addCookies([{ name: "ke_lang", value: lang, url: `http://127.0.0.1:${E2E_WEB_PORT}` }]);
  const page = await ctx.newPage();
  const at = `${width}x${height} ${scheme} ${lang}`;
  await page.goto(`/stage/${SLUG}`);
  await expect(page.getByTestId("stage-qr")).toBeVisible();
  await expect(page.getByTestId("stage-timeline").locator("li").first()).toBeVisible({ visible: width >= 640 });
  const wide = width >= 1024 && width > height;
  const m = await page.evaluate(() => ({ sw: document.scrollingElement!.scrollWidth, sh: document.scrollingElement!.scrollHeight }));
  expect(m.sw, `sideways scroll at ${at}`).toBeLessThanOrEqual(width);
  // Landscape screens are one screen (only the timeline scrolls inside), like /demo.
  if (wide) expect(m.sh, `page scroll at ${at}`).toBeLessThanOrEqual(height);
  // The presenter's buttons are on screen without scrolling (sticky bar when stacked), big enough to tap.
  for (const id of ["stage-accept", "stage-reset"]) {
    await expect(page.getByTestId(id), `${id} at ${at}`).toBeInViewport({ ratio: 1 });
    if (touch) expect((await page.getByTestId(id).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  // Amounts never wrap or spill out of their card.
  for (const el of await page.getByTestId("stage-amount").all()) {
    expect(await el.evaluate((e) => e.scrollWidth <= e.clientWidth), `amount overflows at ${at}`).toBe(true);
  }
  const ids = ["stage-title", "stage-headline", "stage-money", "stage-qr-card", "stage-photos", "stage-timeline-box"].concat(wide ? ["stage-presenter"] : []);
  const boxes = await Promise.all(ids.map(async (id) => [id, await page.getByTestId(id).boundingBox()] as const));
  for (const [i, [a, ba]] of boxes.entries()) for (const [b, bb] of boxes.slice(i + 1)) if (ba && bb) expect(overlap(ba, bb), `${a} overlaps ${b} at ${at}`).toBe(false);
  await page.screenshot({ path: path.join(STAGE_SHOTS, `${width}x${height}-${scheme}${lang === "en" ? "" : `-${lang}`}.png`) });
  if (!wide) {
    // Stacked: the QR scrolls into view uncovered by the sticky bar; at the very end the bar covers nothing.
    if (touch) {
      await expect(page.getByTestId("stage-open-here")).toHaveAttribute("href", `/r/${SLUG}`);
      expect((await page.getByTestId("stage-open-here").boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await page.getByTestId("stage-qr").evaluate((e) => e.scrollIntoView({ block: "start" }));
    expect(overlap((await page.getByTestId("stage-qr").boundingBox())!, (await page.getByTestId("stage-presenter").boundingBox())!), `presenter bar covers the QR at ${at}`).toBe(false);
    await page.evaluate(() => window.scrollTo(0, document.scrollingElement!.scrollHeight));
    expect(overlap((await page.getByTestId("stage-timeline-box").boundingBox())!, (await page.getByTestId("stage-presenter").boundingBox())!), `presenter bar covers the timeline at ${at}`).toBe(false);
    await page.screenshot({ path: path.join(STAGE_SHOTS, `${width}x${height}-${scheme}${lang === "en" ? "" : `-${lang}`}-end.png`) });
  }
  await ctx.close();
}

async function step(phone: Page, name: string) {
  // Right after a reload the streamed page can briefly hold two copies of the flow; wait for the settled one.
  await expect(phone.getByTestId("judge-flow")).toHaveCount(1);
  await expect(phone.getByTestId("judge-flow")).toHaveAttribute("data-step", name, { timeout: 45_000 });
}

async function photos(phone: Page, kind: "pickup" | "return", seed: number) {
  const uploads: number[] = [];
  phone.on("request", (r) => {
    if (r.url().endsWith("/api/evidence") && r.method() === "POST") uploads.push(r.postDataBuffer()?.byteLength ?? 0);
  });
  await phone.getByTestId(`judge-camera-${kind}`).setInputFiles(noisyBmp(seed));
  await expect(phone.getByAltText(`${kind} photo`)).toHaveCount(1);
  await phone.getByTestId(`judge-save-${kind}`).click();
  await expect.poll(() => uploads.length).toBe(1);
  // The 5.8 MB photo left the phone as one compressed JPEG of <= 200 KB (plus a little multipart overhead).
  expect(uploads[0]).toBeLessThan(200_000 + 1_000);
}

for (const mobile of [true, false]) {
  test(`a judge rents the Mystery Box on stage (${mobile ? "phone" : "desktop"} viewport)`, async ({ page: stage, browser }) => {
    test.setTimeout(mobile ? 240_000 : 480_000);
    const problems: string[] = [];
    await stage.setViewportSize({ width: 1920, height: 1080 });
    await stage.goto(`/stage/${SLUG}`);
    await expect(stage.getByTestId("stage-qr")).toBeVisible();
    await expect(stage.getByTestId("stage-url")).toContainText(`/r/${SLUG}`);
    await resetStage(stage);

    const phone = await judgePage(browser, mobile);
    phone.on("response", (r) => r.status() >= 500 && problems.push(`${r.status()} ${r.url()}`));
    phone.on("console", (m) => m.type() === "error" && problems.push(`phone console: ${m.text()}`));
    stage.on("console", (m) => m.type() === "error" && problems.push(`stage console: ${m.text()}`));
    await phone.goto(`/r/${SLUG}`);
    await step(phone, "wallet");
    if (mobile) await shot(phone, "stage-phone-1-wallet");
    await phone.getByTestId("judge-guest").click();
    await expect(phone.getByText("Testnet guest wallet, no real money").first()).toBeVisible();

    await step(phone, "money");
    await phone.getByTestId("judge-drip").click();
    await step(phone, "rent");
    if (mobile) await shot(phone, "stage-phone-2-rent");
    await phone.getByTestId("judge-rent").click();
    await step(phone, "pickup");
    await expect(stage.getByTestId("stage-view")).toHaveAttribute("data-status", "Active");
    await expect(stage.getByTestId("stage-headline")).toContainText("locked in escrow");

    await photos(phone, "pickup", 1);
    await step(phone, "return");

    // Resumable: a reload (or a dead tab) picks up from chain state with the same guest wallet.
    await phone.reload();
    await step(phone, "return");

    await photos(phone, "return", 2);
    await step(phone, "inspect");
    await phone.getByTestId("judge-inspect").click();
    await expect(phone.getByTestId("judge-split")).toBeVisible();
    if (mobile) await shot(phone, "stage-phone-3-split");
    await phone.getByTestId("judge-propose").click();
    await step(phone, "waiting");

    await expect(stage.getByTestId("stage-view")).toHaveAttribute("data-status", "MoveOut");
    await expect(stage.getByTestId("stage-headline")).toContainText("AI split proposed");
    await expect(stage.locator("img[alt='Pickup photo']")).toHaveCount(1);
    if (mobile) await shot(stage, "stage-big-screen-proposed");
    await stage.getByTestId("stage-accept").click();

    await expect(stage.getByTestId("stage-view")).toHaveAttribute("data-status", "Settled", { timeout: 30_000 });
    await expect(stage.getByTestId("stage-timeline")).toContainText("Both agreed: money settled");
    await step(phone, "settled");
    await expect(phone.getByTestId("judge-settled")).toContainText(/Your ฿[\d,]+ are back/);
    if (mobile) {
      await shot(stage, "stage-big-screen-settled");
      await shot(phone, "stage-phone-4-settled");
    }

    // The settled stage (every block filled) on every screen size, light and dark; 中文 and EN+中文 on the tightest ones.
    if (!mobile) {
      for (const screen of SCREENS) for (const scheme of ["light", "dark"] as const) await checkScreen(browser, screen, scheme, "en");
      for (const screen of SCREENS.filter(([w, h]) => [360, 1180, 1280].includes(w) && h <= 820)) {
        for (const lang of ["zh", "both"] as const) await checkScreen(browser, screen, "light", lang);
      }
    }

    // One rental at a time: a second phone sees it is free again only because this one settled.
    const second = await judgePage(browser, true);
    await second.goto(`/r/${SLUG}`);
    await step(second, "wallet");
    await second.close();
    await phone.close();
    expect(problems).toEqual([]);
  });
}

test("the listing page shows the item in the app shell and links to the phone flow", async ({ page }) => {
  await page.goto(`/app/listings/${SLUG}`);
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await expect(page.getByRole("heading", { name: "KeyScrow Mystery Box" })).toBeVisible();
  await expect(page.getByTestId("listing-terms")).toContainText("฿200");
  await expect(page.getByTestId("listing-terms")).toContainText("฿1,000");
  await page.getByTestId("listing-rent").click();
  await expect(page).toHaveURL(new RegExp(`/r/${SLUG}$`));
});

test("a second renter is refused while someone rents the item", async ({ page, request }) => {
  await page.goto(`/stage/${SLUG}`);
  await resetStage(page);
  const a = "0x000000000000000000000000000000000000a11c";
  const b = "0x000000000000000000000000000000000000b0b0";
  const post = (body: object) => request.post(`/api/stage/${SLUG}`, { data: body });
  const first = await post({ action: "lease", address: a });
  expect(first.status()).toBe(200);
  // Idempotent: the same renter gets the same rental back.
  const again = await post({ action: "lease", address: a });
  expect((await again.json()).lease).toBe((await first.json()).lease);
  const other = await post({ action: "lease", address: b });
  expect(other.status()).toBe(409);
  expect((await other.json()).error).toMatch(/Someone else is renting/);
  // The presenter cannot accept before there is a proposal.
  expect((await post({ action: "accept" })).status()).toBe(409);
  await resetStage(page);
});
