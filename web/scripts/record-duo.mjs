// Records the hero video docs/submission/duo.{mp4,webm}: one full rental on /duo, two phones and a vault: the renter's
// phone (left, drawn as the KeyScrow iPhone app), the shop owner's phone (right) and the escrow vault between them.
// Choose the Honda Click on the phone, test money, pay (the vault fills), pickup and return photos, AI split (the coins
// take its colours), the owner presses Accept on the owner's phone, settled (the vault drains to both sides, one coin
// to the fee).
//
// Against a local production build on anvil with the demo accounts on (`WORLD_KEEP=1 pnpm testnet:world rehearse`
// serves one on :3170; build web with the e2e env pointed at its anvil first). Never against a public chain.
//
//   node web/scripts/record-duo.mjs [outDir]   -> outDir/<video>.webm, settled.png (02-duo.png), board-*.png,
//                                                 settled-dark.png (02-duo-dark.png); prints
//                                                 {start, end}: the trim marks in seconds
//   ffmpeg -i in.webm -ss S -to E -an -c:v libx264 -preset slow -crf 30 -pix_fmt yuv420p -movflags +faststart duo.mp4
//   ffmpeg -i in.webm -ss S -to E -an -c:v libvpx-vp9 -crf 40 -b:v 0 -row-mt 1 -deadline good -cpu-used 4 duo.webm
//   GIF (720 px, 10 fps): palettegen=max_colors=64:stats_mode=diff, then paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium, expect } = require("@playwright/test");
const BASE = process.env.REC_BASE ?? "http://127.0.0.1:3170";
const W = 1470, H = 830;
const out = process.argv[2] ?? "/tmp/rec/duo";
const PHOTOS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/listings/photos");
// Real photos of the scooter (two sizes of the listing photo, so the two sets have different fingerprints).
const PHOTOS = { pickup: path.join(PHOTOS_DIR, "honda-click-125i-960.jpg"), return: path.join(PHOTOS_DIR, "honda-click-125i-1200.jpg") };
const FIRST = "mystery-box", HONDA = "honda-click-125i";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BOARD_HOLD = 1800; // each money moment stays still long enough to read the vault
const COINS = 2300; // the pile's fill or drain (and the fee coin) has played out (duo.css)

const CURSOR = `(() => { if (window.top !== window) return; addEventListener('DOMContentLoaded', () => {
  const c = document.createElement('div'); c.id = '__rec_cursor';
  c.style.cssText = 'position:fixed;left:-50px;top:-50px;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(240,185,11,.55);border:2px solid rgba(20,20,20,.75);z-index:2147483647;pointer-events:none;transition:left .45s ease,top .45s ease,transform .15s';
  document.documentElement.appendChild(c); }); })();`;

async function newContext(browser, video) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: "light", ...(video ? { recordVideo: { dir: out, size: { width: W, height: H } } } : {}) });
  await ctx.addCookies([{ name: "ke_lang", value: "en", url: BASE }]);
  await ctx.addInitScript(CURSOR);
  return ctx;
}
/** Glide the fake cursor to the locator's centre (page coordinates, also inside the phone's iframe) and pause. */
async function show(page, loc, pause = 500) {
  const b = await loc.boundingBox();
  if (!b) return;
  await page.evaluate(([x, y]) => { const c = document.getElementById("__rec_cursor"); if (c) { c.style.left = x + "px"; c.style.top = y + "px"; } }, [b.x + b.width / 2, b.y + b.height / 2]);
  await sleep(pause);
}
async function click(page, loc) {
  await show(page, loc);
  await page.evaluate(() => { const c = document.getElementById("__rec_cursor"); if (c) { c.style.transform = "scale(.7)"; setTimeout(() => (c.style.transform = ""), 160); } });
  await loc.click();
}
/** A caption pill, bottom right; empty text hides it. */
async function caption(page, text) {
  await page.evaluate((text) => {
    let c = document.getElementById("__rec_caption");
    if (!c) { c = document.createElement("div"); c.id = "__rec_caption"; document.documentElement.appendChild(c); }
    c.style.cssText = "position:fixed;right:32px;bottom:28px;max-width:560px;padding:10px 16px;border-radius:14px;background:rgba(17,17,17,.88);color:#fff;font:600 17px/1.35 system-ui,sans-serif;z-index:2147483646;pointer-events:none;box-shadow:0 6px 24px rgba(0,0,0,.25);transition:opacity .3s";
    c.style.opacity = text ? "1" : "0";
    if (text) c.textContent = text;
  }, text);
}
async function resetStage(page) {
  await page.getByTestId("stage-reset").click();
  await page.getByTestId("confirm-ok").click(); // in-page dialog
  await expect(page.getByTestId("duo-view")).toHaveAttribute("data-status", "none", { timeout: 30_000 });
}

const browser = await chromium.launch();
// Off camera: both stages back to no rental (a fresh browser, so the recorded phone has no guest wallet or pick).
{
  const ctx = await newContext(browser, false);
  const page = await ctx.newPage();
  for (const slug of [HONDA, FIRST]) {
    await page.goto(`${BASE}/duo/${slug}`);
    await expect(page.getByTestId("stage-qr")).toBeVisible({ timeout: 30_000 });
    await resetStage(page);
  }
  await ctx.close();
}

const ctx = await newContext(browser, true);
const page = await ctx.newPage();
const t0 = Date.now();
const t = () => ((Date.now() - t0) / 1000).toFixed(1);
const marks = {};
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
const board = page.getByTestId("duo-board");
try {
  await page.goto(`${BASE}/duo/${FIRST}`);
  await expect(page.getByTestId("stage-qr")).toBeVisible({ timeout: 30_000 });
  const phone = page.frameLocator("[data-testid='duo-phone-frame']");
  const step = (s) => expect(phone.getByTestId("judge-flow")).toHaveAttribute("data-step", s, { timeout: 60_000 });
  await step("choose");
  await sleep(1500);
  marks.start = t();
  await caption(page, "KeyScrow live: the renter's phone (left), the shop owner's phone (right), the escrow vault between");
  await sleep(4500);
  await caption(page, "1 · The renter picks a scooter on the phone");
  await sleep(2200);
  await click(page, phone.getByTestId(`judge-pick-${HONDA}`));
  await step("wallet");
  await expect(page.getByTestId("duo-view").locator("header")).toContainText("Honda Click 125i", { timeout: 30_000 });
  await expect(page.getByTestId("duo-legend")).toContainText(/฿6,80[01] deposit/, { timeout: 30_000 });
  await caption(page, "Both phones and the vault follow: Honda Click 125i, ฿250 for a day + ฿6,800 deposit");
  await sleep(BOARD_HOLD + 1500);
  await shot("board-1-choose");
  await caption(page, "2 · A guest wallet and test money, no real money");
  await sleep(1000);
  await click(page, phone.getByTestId("judge-guest"));
  await step("money");
  await sleep(1300);
  await click(page, phone.getByTestId("judge-drip"));
  await step("rent");
  await caption(page, "3 · Pay: deposit + rent go into this rental's own escrow contract");
  await sleep(2500);
  await click(page, phone.getByTestId("judge-rent"));
  await step("pickup");
  await expect(board).toHaveAttribute("data-phase", "funded", { timeout: 30_000 });
  await caption(page, "The vault fills: ฿7,050 locked in escrow. The passport stays in the renter's pocket");
  await sleep(COINS + BOARD_HOLD);
  await shot("board-2-escrow");
  await sleep(2200);
  await caption(page, "4 · Pickup photos: only their SHA-256 fingerprint goes on-chain");
  for (const kind of ["pickup", "return"]) {
    const input = phone.getByTestId(`judge-camera-${kind}`);
    await show(page, input.locator("xpath=..")).catch(() => {});
    await input.setInputFiles(PHOTOS[kind]);
    await expect(phone.getByAltText(`${kind} photo`)).toHaveCount(1, { timeout: 30_000 });
    await sleep(1500);
    await click(page, phone.getByTestId(`judge-save-${kind}`));
    await step(kind === "pickup" ? "return" : "inspect");
    await sleep(2500);
    if (kind === "pickup") await caption(page, "5 · At return: the same photos again");
  }
  await caption(page, "6 · The AI inspector compares them and drafts a deposit split with its reasons");
  await click(page, phone.getByTestId("judge-inspect"));
  await expect(phone.getByTestId("judge-split")).toBeVisible({ timeout: 60_000 });
  await sleep(6000);
  await caption(page, "7 · The renter proposes the split on-chain");
  await click(page, phone.getByTestId("judge-propose"));
  await step("waiting");
  await expect(page.getByTestId("duo-view")).toHaveAttribute("data-status", "MoveOut", { timeout: 30_000 });
  await expect(board).toHaveAttribute("data-phase", "split", { timeout: 30_000 });
  await caption(page, "The coins take the split's colours: back to the renter, to the owner, the rent");
  // The colours sweep the pile in ~1.4 s (duo.css); the vault then stays still through this and the next caption.
  await sleep(1000 + BOARD_HOLD);
  await shot("board-3-split");
  await sleep(1200);
  await caption(page, "8 · The owner presses Accept on their phone: one transaction pays everyone");
  await sleep(1500);
  await click(page, page.getByTestId("stage-accept"));
  await expect(page.getByTestId("duo-view")).toHaveAttribute("data-status", "Settled", { timeout: 30_000 });
  await expect(board).toHaveAttribute("data-phase", "settled", { timeout: 30_000 });
  await step("settled");
  await caption(page, "Settled: the vault drains back to the renter and to the owner. One coin is the KeyScrow fee, ฿25");
  await sleep(COINS + BOARD_HOLD);
  await shot("board-4-settled");
  await sleep(3500);
  await caption(page, "Neither side could move the deposit alone, and no passport was left at the shop.");
  await sleep(6000);
  await caption(page, "");
  await sleep(1500);
  marks.end = t();
  // The still for docs/submission/screenshots/02-duo.png, without the fake cursor (after the trim end).
  await page.evaluate(() => document.getElementById("__rec_cursor")?.remove());
  await shot("settled");
  // The dark still (02-duo-dark.png): the page's theme class and the colour scheme (the phone's iframe follows it).
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => { const c = document.documentElement.classList; c.remove("light"); c.add("dark"); });
  await sleep(1500);
  await shot("settled-dark");
  console.log(JSON.stringify({ ...marks, video: await page.video()?.path() }));
} catch (e) {
  await shot("fail");
  throw e;
} finally {
  await ctx.close();
  await browser.close();
}
