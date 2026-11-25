import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import path from "node:path";

/**
 * The live judge demo on a throwaway anvil: the big screen (/stage/mystery-box) and a judge's phone (/r/mystery-box)
 * with a guest wallet, side by side. Phone: guest wallet -> test money -> pay into escrow -> pickup photo -> (reload,
 * it resumes) -> return photo -> AI inspection -> propose. Big screen: accept -> settled, on both screens.
 */

const SHOTS = path.resolve(__dirname, "../test-results/screenshots");
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
const SLUG = "mystery-box";

/** A big noisy 24-bit BMP (~5.8 MB): JPEG cannot squeeze noise, so the phone's compression loop really has to work. */
function noisyBmp(seed: number, w = 1600, h = 1200) {
  const row = Math.ceil((w * 3) / 4) * 4;
  const buf = Buffer.alloc(54 + row * h);
  buf.write("BM", 0);
  buf.writeUInt32LE(buf.length, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(w, 18);
  buf.writeInt32LE(h, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(row * h, 34);
  let x = seed;
  for (let i = 54; i < buf.length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    buf[i] = x >> 16;
  }
  return { name: `photo-${seed}.bmp`, mimeType: "image/bmp", buffer: buf };
}

async function judgePage(browser: Browser, mobile: boolean) {
  const ctx = await browser.newContext(mobile ? { ...devices["Pixel 7"] } : { viewport: { width: 1280, height: 900 } });
  return ctx.newPage();
}

async function resetStage(stage: Page) {
  stage.once("dialog", (d) => d.accept());
  await stage.getByTestId("stage-reset").click();
  await expect(stage.getByTestId("stage-view")).toHaveAttribute("data-status", "none");
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
    test.setTimeout(240_000);
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

    // One rental at a time: a second phone sees it is free again only because this one settled.
    const second = await judgePage(browser, true);
    await second.goto(`/r/${SLUG}`);
    await step(second, "wallet");
    await second.close();
    await phone.close();
    expect(problems).toEqual([]);
  });
}

test("the listing page shows the item and links to the phone flow", async ({ page }) => {
  await page.goto(`/app/listings/${SLUG}`);
  await expect(page.getByRole("heading", { name: "KeyEscrow Mystery Box" })).toBeVisible();
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
